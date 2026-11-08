import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { snapshotInventory } from "./lib/inventory-snapshot.mjs";

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

/** Compile before loading emitted JavaScript on every supported Node version. */
function run(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: projectRoot, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`${label} failed.`);
}

/** Exercise filter boundaries using temporary rows rolled back on completion. */
async function verifyTransactionalFixtures(prisma, queryInventoryRows) {
  const before = await snapshotInventory(prisma);
  const rollback = new Error("Roll back query-test fixtures");
  const prefix = `QUERY_TEST_${randomUUID()}`;
  try {
    await prisma.$transaction(async (tx) => {
      const active = await tx.item.create({
        data: {
          code: `${prefix}_ACTIVE`, displayName: `${prefix} active`,
          valuations: { create: [{ year: 2026, valuePerUnit: "2.50" }, { year: 2025, valuePerUnit: "99.00" }] },
          startingInventories: { create: [
            { year: 2026, location: "LOWCOUNTRY", startingQuantity: 10 },
            { year: 2026, location: "MIDLANDS", startingQuantity: 20 },
            { year: 2025, location: "LOWCOUNTRY", startingQuantity: 999 },
          ] },
        },
      });
      const zero = await tx.item.create({
        data: {
          code: `${prefix}_ZERO`, displayName: `${prefix} zero`,
          valuations: { create: { year: 2026, valuePerUnit: "0.00" } },
          startingInventories: { create: { year: 2026, location: "LOWCOUNTRY", startingQuantity: 0 } },
        },
      });
      const movements = [
        ["LOWCOUNTRY", "2026-01-01T00:00:00.000Z", "IN", 2],
        ["LOWCOUNTRY", "2026-07-01T12:00:00.000Z", "IN", 3],
        ["LOWCOUNTRY", "2026-12-31T23:59:59.999Z", "OUT", 4],
        ["LOWCOUNTRY", "2025-12-31T23:59:59.999Z", "IN", 999],
        ["LOWCOUNTRY", "2027-01-01T00:00:00.000Z", "OUT", 999],
        ["MIDLANDS", "2026-07-01T12:00:00.000Z", "IN", 7],
        ["MIDLANDS", "2026-07-02T12:00:00.000Z", "OUT", 1],
      ];
      for (const [index, [location, date, direction, quantity]] of movements.entries()) {
        await tx.sourceSubmission.create({
          data: {
            jotformFormId: prefix, jotformSubmissionId: `${prefix}_${index}`,
            location, submissionDate: new Date(date),
            sourceType: direction === "IN" ? "INVENTORY" : "REFERRAL",
            inventoryActivities: { create: { item: { connect: { id: active.id } }, direction, quantity } },
          },
        });
      }
      const lowcountry = await queryInventoryRows(tx, 2026, "LOWCOUNTRY");
      const midlands = await queryInventoryRows(tx, 2026, "MIDLANDS");
      const count = await tx.item.count();
      assert.equal(lowcountry.length, count);
      assert.equal(midlands.length, count);
      assert.deepEqual(lowcountry.find((row) => row.itemName === active.displayName), {
        itemName: active.displayName, initialCount: 10, valuePerUnit: 2.5, itemsAdded: 5, itemsSubtracted: 4,
      });
      assert.deepEqual(midlands.find((row) => row.itemName === active.displayName), {
        itemName: active.displayName, initialCount: 20, valuePerUnit: 2.5, itemsAdded: 7, itemsSubtracted: 1,
      });
      for (const rows of [lowcountry, midlands]) {
        assert.deepEqual(rows.find((row) => row.itemName === zero.displayName), {
          itemName: zero.displayName, initialCount: 0, valuePerUnit: 0, itemsAdded: 0, itemsSubtracted: 0,
        });
      }
      await tx.item.create({ data: { code: `${prefix}_UNVALUED`, displayName: `${prefix} unvalued` } });
      await assert.rejects(queryInventoryRows(tx, 2026, "LOWCOUNTRY"), /Missing 2026 valuation/);
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.deepEqual(await snapshotInventory(prisma), before, "Query test fixtures were not fully rolled back.");
}

async function main() {
  const { values } = parseArgs({ options: { unit: { type: "boolean", default: false } } });
  run([require.resolve("typescript/lib/tsc.js"), "--project", "prisma/tsconfig.seed.json"], "Inventory query compilation");
  if (values.unit) {
    run(["--test", "tests/inventory-query.test.mjs"], "Inventory query unit tests");
    return;
  }
  const connectionString = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Set DIRECT_URL or DATABASE_URL for the seeded development/test database.");
  const [{ PrismaClient }, { PrismaPg }, { queryInventoryRows }] = await Promise.all([
    import("../.seed-build/generated/prisma/client.js"),
    import("@prisma/adapter-pg"),
    import("../.seed-build/lib/inventory/get-inventory-query.js"),
  ]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 }) });
  try {
    const lowcountry = await queryInventoryRows(prisma, 2026, "LOWCOUNTRY");
    const midlands = await queryInventoryRows(prisma, 2026, "MIDLANDS");
    const itemCount = await prisma.item.count();
    assert.ok(itemCount >= 35, "Seed the catalogue and demo records first.");
    assert.equal(lowcountry.length, itemCount);
    assert.equal(midlands.length, itemCount);
    const mensName = "Men's Tops (Shirts, Sweaters & Sweatshirts)";
    assert.deepEqual(lowcountry.find((row) => row.itemName === mensName), {
      itemName: mensName, initialCount: 100, valuePerUnit: 10.12, itemsSubtracted: 5, itemsAdded: 20,
    });
    assert.deepEqual(midlands.find((row) => row.itemName === mensName), {
      itemName: mensName, initialCount: 60, valuePerUnit: 10.12, itemsSubtracted: 4, itemsAdded: 12,
    });
    await verifyTransactionalFixtures(prisma, queryInventoryRows);
    console.log("PASS: seeded query totals, year/location boundaries, all items, zero/missing openings, valuations and fixture rollback.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Inventory query test failed.");
  process.exitCode = 1;
});
