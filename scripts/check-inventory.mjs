import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { snapshotInventory } from "./lib/inventory-snapshot.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const checks = [
  ["db:validate"],
  ["db:generate"],
  ["db:deploy"],
  ["db:test:seed"],
  ["db:test:inventory"],
  ["db:check:seed"],
  ["db:check:seed", "--", "--demo"],
  ["db:test"],
  ["lint"],
  ["build"],
];

async function snapshotDatabase(connectionString) {
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
    import("../.seed-build/generated/prisma/client.js"),
    import("@prisma/adapter-pg"),
  ]);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 }),
  });
  try {
    return await snapshotInventory(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run this check with npm run check:inventory.");
  const connectionString = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Set DIRECT_URL or DATABASE_URL for a development/test database first.");

  let firstSnapshot;
  for (let pass = 1; pass <= 2; pass++) {
    console.log(`Inventory validation pass ${pass}/2`);
    for (const [name, ...args] of checks) {
      const result = spawnSync(process.execPath, [npmCli, "run", name, ...args], {
        cwd: projectRoot,
        stdio: "inherit",
      });
      if (result.error || result.status !== 0) {
        throw new Error(`Pass ${pass}: npm run ${name} failed.`);
      }
    }
    const snapshot = await snapshotDatabase(connectionString);
    console.log("Persisted inventory rows:", Object.entries(snapshot)
      .map(([model, value]) => `${model}=${value.count}`).join(", "));
    if (pass === 1) firstSnapshot = snapshot;
    else assert.deepEqual(snapshot, firstSnapshot,
      "Inventory row counts or contents changed during the second validation pass.");
  }
  console.log("PASS: migrations, both seed modes, valuation checks, constraints, lint and build passed twice; no inventory rows changed on the second pass.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Inventory validation failed.");
  process.exitCode = 1;
});
