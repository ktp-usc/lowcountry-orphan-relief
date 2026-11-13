import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { createDatabaseCronStore } from "../lib/sheets/cron-store.ts";
import { createSyncSheets } from "../lib/sheets/sync-sheets.ts";
import { SHEET_MAPPINGS } from "../lib/sheets/mappings.ts";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const connectionString = process.env.INTEGRATION_DATABASE_URL?.trim();

test("database leases, history, batched reconciliation and rollback in an isolated schema", { skip: !connectionString }, async () => {
  // Never migrate or modify the application's tables. Test DDL and inventory
  // exist only in a uniquely named schema, dropped in finally.
  const schema = `sheet_sync_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10000 }) });
  const client = () => new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10000 }, { schema }) });
  const one = client(), two = client();
  try {
    await admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      for (const migration of ["20261030000000_init_inventory", "20261112000000_sheet_sync_jobs"]) {
        const sql = await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8");
        for (const statement of sql.split(";").filter((part) => part.trim())) await tx.$executeRawUnsafe(statement);
      }
    }, { timeout: 30000 });
    // Neon pooled connections disallow search_path startup parameters. Keep
    // raw SQL scoped with SET LOCAL inside each test transaction instead.
    const scopedStore = (db) => createDatabaseCronStore({
      $transaction: (callback) => db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        return callback(tx);
      }),
    });
    const storeA = scopedStore(one), storeB = scopedStore(two);
    const job = (owner) => ({ sourceKey: "lor-inventory", bucket: 0, bucketCount: 1, owner });
    const first = job(randomUUID()), second = job(randomUUID());
    const winners = await Promise.all([storeA.acquire(first), storeB.acquire(second)]);
    assert.equal(winners.filter(Boolean).length, 1);
    const winner = winners[0] ? first : second, loser = winners[0] ? second : first;
    const completion = { success: true, durationMs: 100, processedRows: 10 };
    assert.equal(await storeB.finish(loser, completion), false);
    assert.equal((await one.sheetSyncJob.findFirst()).leaseOwner, winner.owner);
    assert.equal(await storeA.finish(winner, completion), true);
    const lastSuccess = await one.sheetSyncJob.findFirst();
    assert.equal(lastSuccess.lastSuccessDurationMs, 100);
    assert.equal(lastSuccess.lastSuccessProcessedRows, 10);
    assert.equal(lastSuccess.lastSuccessBucketCount, 1);

    const failed = job(randomUUID());
    assert.equal(await storeA.acquire(failed), true);
    assert.equal(await storeA.finish(failed, { success: false, durationMs: 200, processedRows: 9, error: "Partial failure" }), true);
    assert.equal((await one.sheetSyncAttempt.findUnique({ where: { id: failed.owner } })).status, "FAILED");
    assert.deepEqual((await one.sheetSyncJob.findFirst()).lastSuccessfulAt, lastSuccess.lastSuccessfulAt);

    const interrupted = job(randomUUID()), replacement = job(randomUUID());
    assert.equal(await storeA.acquire(interrupted), true);
    await one.$executeRawUnsafe(`UPDATE "${schema}"."SheetSyncJob" SET "leaseExpiresAt" = clock_timestamp() - interval '1 second'`);
    assert.equal(await storeB.acquire(replacement), true);
    assert.equal((await one.sheetSyncAttempt.findUnique({ where: { id: interrupted.owner } })).status, "INTERRUPTED");
    assert.equal(await storeA.finish(interrupted, completion), false);
    assert.equal((await one.sheetSyncJob.findFirst()).leaseOwner, replacement.owner);
    assert.equal(await storeB.finish(replacement, completion), true);

    const expired = job(randomUUID());
    await storeA.acquire(expired);
    await one.$executeRawUnsafe(`UPDATE "${schema}"."SheetSyncJob" SET "leaseExpiresAt" = clock_timestamp() - interval '1 second'`);
    assert.equal(await storeA.finish(expired, completion), false);
    assert.equal((await one.sheetSyncAttempt.findUnique({ where: { id: expired.owner } })).status, "INTERRUPTED");

    await one.item.create({ data: { code: "MENS_TOPS", displayName: "Test tops" } });
    const mapping = SHEET_MAPPINGS.find(({ key }) => key === "lor-inventory");
    const row = { rowNumber: 2, cancelled: false, values: {
      ...Object.fromEntries(Object.values(mapping.answerHeaders).map((header) => [header, ""])),
      "Submission ID": "9007199254740993", "Submission Date": "2026-07-01 9:15:00", "Men's Tops": "5",
    } };
    let transactions = 0, lookups = 0;
    const counted = {
      $transaction: (...args) => { transactions++; return one.$transaction(...args); },
      sourceSubmission: { findMany: (...args) => { lookups++; return one.sourceSubmission.findMany(...args); } },
    };
    const sync = createSyncSheets({ sources: [mapping], read: async () => ({ sourceKey: mapping.key, rows: [row] }) });
    assert.equal((await sync(counted)).created, 1);
    transactions = 0; lookups = 0;
    assert.equal((await sync(counted)).unchanged, 1);
    assert.equal(transactions, 0);
    assert.equal(lookups, 1);
    row.values["Men's Tops"] = "7";
    assert.equal((await sync(counted)).updated, 1);
    assert.equal((await one.inventoryActivity.findFirst()).quantity, 7);
    row.cancelled = true;
    assert.equal((await sync(counted)).cancelled, 1);
    assert.equal(await one.inventoryActivity.count(), 0);
    assert.equal(await one.sourceSubmission.count(), 1);
    transactions = 0;
    assert.equal((await sync(counted)).cancelled, 1);
    assert.equal(transactions, 0);
    row.cancelled = false;
    assert.equal((await sync(counted)).updated, 1);
    // A missing catalogue item must leave previous activities intact.
    row.values["Men's Tops"] = "9";
    row.values["Men's Bottoms"] = "1";
    assert.equal((await sync(counted)).failed, 1);
    assert.equal((await one.inventoryActivity.findFirst()).quantity, 7);
    assert.equal(await one.inventoryActivity.count(), 1);
    const failingClient = { ...counted, sourceSubmission: { findMany: async () => { throw new Error("lookup failed"); } } };
    transactions = 0;
    assert.equal((await sync(failingClient)).failed, 1);
    assert.equal(transactions, 0);
    assert.equal((await one.inventoryActivity.findFirst()).quantity, 7);
  } finally {
    await Promise.all([one.$disconnect(), two.$disconnect()]);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
});
