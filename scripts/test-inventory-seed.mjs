import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { snapshotInventory } from "./lib/inventory-snapshot.mjs";

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

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
  if (!connectionString) throw new Error("Configure a migrated development/test database in .env first.");

  run([require.resolve("typescript/lib/tsc.js"), "--project", "prisma/tsconfig.seed.json"], "Seed compilation");
  const { PrismaClient } = await import("../.seed-build/generated/prisma/client.js");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 }),
  });
  const command = (name, ...args) => run([npmCli, "run", name, ...args], `npm run ${name}`);
  const seed = (demo = false) => command(demo ? "db:seed:demo" : "db:seed");

  try {
    const before = await snapshotInventory(prisma);
    seed();
    command("db:check:seed");
    const catalogueSnapshot = await snapshotInventory(prisma);
    for (const model of ["startingInventory", "sourceSubmission", "inventoryActivity"]) {
      assert.deepEqual(catalogueSnapshot[model], before[model], `Default seeding changed ${model}.`);
    }
    seed();
    assert.deepEqual(await snapshotInventory(prisma), catalogueSnapshot,
      "Default rerun changed persisted rows or created duplicates.");

    seed(true);
    command("db:check:seed", "--", "--demo");
    const demoSnapshot = await snapshotInventory(prisma);
    seed(true);
    assert.deepEqual(await snapshotInventory(prisma), demoSnapshot,
      "Demo rerun changed persisted rows or duplicated movements.");
    seed();
    assert.deepEqual(await snapshotInventory(prisma), demoSnapshot,
      "Default seeding changed existing demo records.");
    console.log("PASS: both seed commands, all 35 valuations, both locations and repeatability checks.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Seed database checks failed.");
  process.exitCode = 1;
});
