import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Optional embedded PostgreSQL stays outside app dependencies. See README for
// the temporary install and PGLITE_TEST_MODULE setup. No network or shared DB.
const { PGlite } = await import(process.env.PGLITE_TEST_MODULE ?? "@electric-sql/pglite");
const sql = (name) => readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");

test("scheduling migration executes locally and preserves existing application records", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(await sql("20261030000000_init_inventory"));
    await db.exec(await sql("20261109044241_add_better_auth"));
    await db.exec(`
      INSERT INTO "Item" ("code", "displayName") VALUES ('LOCAL_TEST', 'Local migration fixture');
      INSERT INTO "SourceSubmission" ("jotformFormId", "jotformSubmissionId", "location", "sourceType", "submissionDate")
        VALUES ('1', '9007199254740993', 'LOWCOUNTRY', 'INVENTORY', '2026-11-12T12:00:00Z');
      INSERT INTO "InventoryActivity" ("jotformFormId", "jotformSubmissionId", "itemId", "quantity", "direction")
        VALUES ('1', '9007199254740993', 1, 3, 'IN');
      INSERT INTO "StartingInventory" ("itemId", "year", "location", "startingQuantity") VALUES (1, 2026, 'LOWCOUNTRY', 10);
      INSERT INTO "ItemValuation" ("itemId", "year", "valuePerUnit") VALUES (1, 2026, 5.00);
      INSERT INTO "user" ("id", "name", "email", "updatedAt") VALUES ('test-user', 'Local Test', 'local@example.invalid', now());
      INSERT INTO "session" ("id", "expiresAt", "token", "updatedAt", "userId") VALUES ('test-session', now() + interval '1 day', 'local-only', now(), 'test-user');
      INSERT INTO "account" ("id", "accountId", "providerId", "userId", "updatedAt") VALUES ('test-account', 'local', 'google', 'test-user', now());
      INSERT INTO "verification" ("id", "identifier", "value", "expiresAt", "updatedAt") VALUES ('test-verification', 'local', 'local-only', now() + interval '1 day', now());
    `);
    const protectedTables = ["Item", "SourceSubmission", "InventoryActivity", "StartingInventory", "ItemValuation", "user", "session", "account", "verification"];
    const snapshot = async () => Object.fromEntries(await Promise.all(protectedTables.map(async (table) => [table,
      (await db.query(`SELECT to_jsonb(t) AS record FROM "${table}" t ORDER BY "id"`)).rows,
    ])));
    const before = await snapshot();
    await db.exec(await sql("20261112000000_sheet_sync_jobs"));

    await t.test("existing inventory, counts, valuations, and authentication records are unchanged", async () => {
      assert.deepEqual(await snapshot(), before);
      assert.ok(Object.values(before).every((rows) => rows.length === 1));
    });
    await t.test("new tables have the expected defaults and indexes", async () => {
      await db.query('INSERT INTO "SheetSyncJob" ("sourceKey", "bucket") VALUES ($1, $2)', ['lor-inventory', 0]);
      const job = (await db.query('SELECT * FROM "SheetSyncJob"')).rows[0];
      assert.equal(job.lastSuccessfulAt, null);
      assert.equal(job.leaseOwner, null);
      await db.query('INSERT INTO "SheetSyncAttempt" ("id", "sourceKey", "bucket", "bucketCount") VALUES ($1, $2, $3, $4)', ['local-attempt', 'lor-inventory', 0, 1]);
      const attempt = (await db.query('SELECT * FROM "SheetSyncAttempt"')).rows[0];
      assert.equal(attempt.status, 'RUNNING');
      assert.ok(attempt.startedAt);
      const indexes = (await db.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('SheetSyncJob', 'SheetSyncAttempt')")).rows;
      assert.equal(indexes.length, 4);
    });
    await t.test("database constraints reject invalid partitions, lease pairs, statuses, and duplicate keys", async () => {
      const check = (query) => assert.rejects(db.query(query), (error) => error.code === '23514');
      await check(`INSERT INTO "SheetSyncJob" ("sourceKey", "bucket") VALUES ('bad', -1)`);
      await check(`INSERT INTO "SheetSyncJob" ("sourceKey", "bucket", "leaseOwner") VALUES ('bad', 0, 'owner-without-expiry')`);
      await check(`INSERT INTO "SheetSyncAttempt" ("id", "sourceKey", "bucket", "bucketCount") VALUES ('bad-partition', 'bad', 1, 1)`);
      await check(`INSERT INTO "SheetSyncAttempt" ("id", "sourceKey", "bucket", "bucketCount", "status") VALUES ('bad-status', 'bad', 0, 1, 'UNKNOWN')`);
      await assert.rejects(db.query(`INSERT INTO "SheetSyncJob" ("sourceKey", "bucket") VALUES ('lor-inventory', 0)`), (error) => error.code === '23505');
    });
  } finally {
    await db.close();
  }
});
