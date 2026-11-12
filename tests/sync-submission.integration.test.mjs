import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { PrismaPg } from "@prisma/adapter-pg";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

function runNodeScript(file, args, label) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed.`);
  }
}

function compileSeedBuild() {
  const compilerPath = require.resolve("typescript/lib/tsc.js");
  runNodeScript(compilerPath, ["--project", "prisma/tsconfig.seed.json"], "TypeScript compile");
}

async function loadSyncSubmission() {
  const sourcePath = resolve(projectRoot, "lib/inventory/sync-submission.ts");

  if (process.features.typescript) {
    return import(pathToFileURL(sourcePath).href);
  }

  const source = await readFile(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

function getIntegrationDatabaseUrl() {
  const connectionString = process.env.INTEGRATION_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "Set INTEGRATION_DATABASE_URL to a non-production PostgreSQL URL before running this test.",
    );
  }

  return connectionString;
}

test("syncSubmission creates, updates, cancels and restores with real Prisma", async () => {
  const connectionString = getIntegrationDatabaseUrl();
  compileSeedBuild();

  const [{ PrismaClient }, { syncSubmission }] = await Promise.all([
    import("../.seed-build/generated/prisma/client.js"),
    loadSyncSubmission(),
  ]);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 }),
  });

  // Fake form ID so these rows can never be mistaken for real data.
  const formId = "KAN33-TEST-FORM";
  const submissionId = `KAN33-TEST-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const key = { jotformFormId: formId, jotformSubmissionId: submissionId };

  const record = (activities, overrides = {}) => ({
    kind: "active",
    input: {
      submission: {
        ...key,
        location: "LOWCOUNTRY",
        sourceType: "INVENTORY",
        submissionDate: new Date("2026-11-08T12:00:00.000Z"),
        ...overrides,
      },
      inventoryActivities: activities,
    },
  });
  const cancelledRecord = { kind: "cancelled", ...key };

  const load = () =>
    prisma.sourceSubmission.findUnique({
      where: { jotformFormId_jotformSubmissionId: key },
      include: { inventoryActivities: { include: { item: true } } },
    });
  const shape = (row) =>
    row.inventoryActivities
      .map((activity) => `${activity.item.code}:${activity.quantity}:${activity.direction}`)
      .sort();

  const original = [
    { itemCode: "MENS_TOPS", quantity: 3, direction: "IN" },
    { itemCode: "MENS_TOPS", quantity: 1, direction: "OUT" },
  ];

  try {
    const item = await prisma.item.findUnique({ where: { code: "MENS_TOPS" } });
    if (!item) {
      throw new Error("Required item code MENS_TOPS not found. Run npm run db:seed first.");
    }
    const itemCountBefore = await prisma.item.count();

    // Cancelled and never imported: nothing is created.
    assert.deepEqual(await syncSubmission(prisma, cancelledRecord), { status: "cancelled" });
    assert.equal(await load(), null);

    // New and active: created.
    assert.deepEqual(await syncSubmission(prisma, record(original)), { status: "created" });
    let row = await load();
    assert.ok(row);
    assert.deepEqual(shape(row), ["MENS_TOPS:1:OUT", "MENS_TOPS:3:IN"]);

    // Edited quantity: updated.
    const edited = [
      { itemCode: "MENS_TOPS", quantity: 8, direction: "IN" },
      { itemCode: "MENS_TOPS", quantity: 1, direction: "OUT" },
    ];
    assert.deepEqual(await syncSubmission(prisma, record(edited)), { status: "updated" });
    row = await load();
    assert.equal(row.inventoryActivities.length, 2);
    assert.deepEqual(shape(row), ["MENS_TOPS:1:OUT", "MENS_TOPS:8:IN"]);

    // Same data again: unchanged, and the activity IDs are not regenerated.
    const idsBefore = row.inventoryActivities.map((activity) => activity.id).sort((a, b) => a - b);
    assert.deepEqual(await syncSubmission(prisma, record(edited)), { status: "unchanged" });
    row = await load();
    const idsAfter = row.inventoryActivities.map((activity) => activity.id).sort((a, b) => a - b);
    assert.deepEqual(idsAfter, idsBefore);

    // Cancel: activities removed, SourceSubmission kept. Repeat: no change.
    assert.deepEqual(await syncSubmission(prisma, cancelledRecord), { status: "cancelled" });
    row = await load();
    assert.ok(row);
    assert.equal(row.inventoryActivities.length, 0);
    assert.deepEqual(await syncSubmission(prisma, cancelledRecord), { status: "cancelled" });
    row = await load();
    assert.ok(row);
    assert.equal(row.inventoryActivities.length, 0);

    // Restore: activities come back.
    assert.deepEqual(await syncSubmission(prisma, record(edited)), { status: "updated" });
    row = await load();
    assert.deepEqual(shape(row), ["MENS_TOPS:1:OUT", "MENS_TOPS:8:IN"]);

    // Invalid updates keep the previous data.
    const invalidInputs = [
      [{ itemCode: "NOT_A_REAL_ITEM", quantity: 1, direction: "IN" }],
      [{ itemCode: "MENS_TOPS", quantity: 0, direction: "IN" }],
      [{ itemCode: "MENS_TOPS", quantity: 2, direction: "SIDEWAYS" }],
    ];
    for (const bad of invalidInputs) {
      await assert.rejects(syncSubmission(prisma, record(bad)));
      row = await load();
      assert.deepEqual(shape(row), ["MENS_TOPS:1:OUT", "MENS_TOPS:8:IN"]);
    }

    // Item rows were never modified.
    assert.equal(await prisma.item.count(), itemCountBefore);
  } finally {
    await prisma.inventoryActivity.deleteMany({ where: key });
    await prisma.sourceSubmission.deleteMany({ where: key });
    await prisma.$disconnect();
  }
});