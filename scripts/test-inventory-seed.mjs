import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const models = ["item", "itemValuation", "startingInventory", "sourceSubmission", "inventoryActivity"];

function run(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) throw new Error(`${label} failed.`);
}

async function main() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Start this check with npm run db:test:seed.");
  const connectionString = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Configure a migrated, empty test database in .env first.");

  run([require.resolve("typescript/lib/tsc.js"), "--project", "prisma/tsconfig.seed.json"], "Seed compilation");
  const [{ PrismaClient }, { itemValuations }] = await Promise.all([
    import("../.seed-build/generated/prisma/client.js"),
    import("../.seed-build/prisma/seed-data.js"),
  ]);
  assert.equal(itemValuations.length, 35, "Expected all 35 rows from the supplied reference table.");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 }),
  });
  const counts = () => Promise.all(models.map((model) => prisma[model].count()));
  const snapshot = async () => JSON.stringify(await Promise.all(
    models.map((model) => prisma[model].findMany({ orderBy: { id: "asc" } })),
  ));
  const seed = (demo = false) => run([
    npmCli, "run", demo ? "db:seed:demo" : "db:seed",
  ], demo ? "npm run db:seed:demo" : "npm run db:seed");

  try {
    assert.deepEqual(await counts(), [0, 0, 0, 0, 0],
      "Use an empty disposable test database. This check will not reset or delete existing data.");

    seed();
    assert.deepEqual(await counts(), [35, 35, 0, 0, 0]);
    const actualCatalogue = await prisma.item.findMany({
      orderBy: { code: "asc" },
      include: { valuations: true },
    });
    const expectedCatalogue = [...itemValuations].sort((a, b) => a.code.localeCompare(b.code));
    assert.deepEqual(actualCatalogue.map((item) => ({
      code: item.code,
      displayName: item.displayName,
      year: item.valuations[0]?.year,
      price: item.valuations[0]?.valuePerUnit.toFixed(2),
      valuations: item.valuations.length,
    })).sort((a, b) => a.code.localeCompare(b.code)), expectedCatalogue.map((item) => ({
      code: item.code, displayName: item.displayName, year: 2026,
      price: item.valuePerUnit, valuations: 1,
    })));
    const catalogueSnapshot = await snapshot();
    seed();
    assert.equal(await snapshot(), catalogueSnapshot, "Default rerun changed IDs or duplicated data.");

    seed(true);
    assert.deepEqual(await counts(), [35, 35, 4, 4, 8]);
    const fixtures = {
      LOWCOUNTRY: { initial: [100, 80], IN: [20, 10], OUT: [5, 3] },
      MIDLANDS: { initial: [60, 40], IN: [12, 8], OUT: [4, 2] },
    };
    const demoCodes = ["MENS_TOPS", "CHILDRENS_TOPS"];
    const openingCounts = await prisma.startingInventory.findMany({ include: { item: true } });
    for (const row of openingCounts) {
      const index = demoCodes.indexOf(row.item.code);
      assert.ok(index >= 0);
      assert.equal(row.year, 2026);
      assert.equal(row.startingQuantity, fixtures[row.location].initial[index]);
    }
    const sources = await prisma.sourceSubmission.findMany({
      include: { inventoryActivities: { include: { item: true } } },
    });
    for (const source of sources) {
      assert.ok(source.jotformSubmissionId.startsWith("SEED_DEMO_IRS_2026_"));
      assert.equal(source.inventoryActivities.length, 2);
      const direction = source.sourceType === "INVENTORY" ? "IN" : "OUT";
      for (const activity of source.inventoryActivities) {
        const index = demoCodes.indexOf(activity.item.code);
        assert.ok(index >= 0);
        assert.equal(activity.direction, direction);
        assert.equal(activity.quantity, fixtures[source.location][direction][index]);
      }
    }
    const demoSnapshot = await snapshot();
    seed(true);
    assert.equal(await snapshot(), demoSnapshot, "Demo rerun changed IDs or duplicated movements.");
    seed();
    assert.equal(await snapshot(), demoSnapshot, "Default seeding changed existing demo records.");
    console.log("PASS: both seed commands, all 35 valuations, both locations and repeatability checks.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Seed database checks failed.");
  process.exitCode = 1;
});
