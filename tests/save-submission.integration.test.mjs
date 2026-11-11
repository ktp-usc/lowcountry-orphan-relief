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

async function loadSaveSubmission() {
  const sourcePath = resolve(projectRoot, "lib/inventory/save-submission.ts");

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

test("saveSubmission persists and skips duplicate submissions with real Prisma", async () => {
  const connectionString = getIntegrationDatabaseUrl();
  compileSeedBuild();

  const [{ PrismaClient }, { saveSubmission }] = await Promise.all([
    import("../.seed-build/generated/prisma/client.js"),
    loadSaveSubmission(),
  ]);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 }),
  });

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const submissionId = `int-save-${uniqueSuffix}`;
  const invalidSubmissionId = `int-save-invalid-${uniqueSuffix}`;
  const formId = "241895593214161";

  try {
    const item = await prisma.item.findUnique({ where: { code: "MENS_TOPS" } });
    if (!item) {
      throw new Error("Required item code MENS_TOPS not found. Run npm run db:seed first.");
    }

    const saved = await saveSubmission(prisma, {
      submission: {
        jotformFormId: formId,
        jotformSubmissionId: submissionId,
        location: "LOWCOUNTRY",
        sourceType: "INVENTORY",
        submissionDate: new Date("2026-11-08T12:00:00.000Z"),
      },
      inventoryActivities: [{ itemCode: "MENS_TOPS", quantity: 3, direction: "IN" }],
    });

    assert.equal(saved.status, "saved");

    const persisted = await prisma.sourceSubmission.findUnique({
      where: {
        jotformFormId_jotformSubmissionId: {
          jotformFormId: formId,
          jotformSubmissionId: submissionId,
        },
      },
      include: { inventoryActivities: true },
    });

    assert.ok(persisted);
    assert.equal(persisted.location, "LOWCOUNTRY");
    assert.equal(persisted.sourceType, "INVENTORY");
    assert.equal(persisted.inventoryActivities.length, 1);
    assert.equal(persisted.inventoryActivities[0].quantity, 3);
    assert.equal(persisted.inventoryActivities[0].direction, "IN");

    const duplicate = await saveSubmission(prisma, {
      submission: {
        jotformFormId: formId,
        jotformSubmissionId: submissionId,
        location: "LOWCOUNTRY",
        sourceType: "INVENTORY",
        submissionDate: new Date("2026-11-08T12:00:00.000Z"),
      },
      inventoryActivities: [{ itemCode: "MENS_TOPS", quantity: 3, direction: "IN" }],
    });

    assert.deepEqual(duplicate, { status: "skipped", reason: "existing-submission" });

    await assert.rejects(
      saveSubmission(prisma, {
        submission: {
          jotformFormId: formId,
          jotformSubmissionId: invalidSubmissionId,
          location: "LOWCOUNTRY",
          sourceType: "INVENTORY",
          submissionDate: new Date("2026-11-08T12:05:00.000Z"),
        },
        inventoryActivities: [{ itemCode: "NOT_A_REAL_ITEM", quantity: 1, direction: "IN" }],
      }),
      /No Item rows found for codes: NOT_A_REAL_ITEM/i,
    );

    const invalidPersisted = await prisma.sourceSubmission.findUnique({
      where: {
        jotformFormId_jotformSubmissionId: {
          jotformFormId: formId,
          jotformSubmissionId: invalidSubmissionId,
        },
      },
      select: { id: true },
    });

    assert.equal(invalidPersisted, null);
  } finally {
    await prisma.inventoryActivity.deleteMany({
      where: { jotformFormId: formId, jotformSubmissionId: submissionId },
    });
    await prisma.sourceSubmission.deleteMany({
      where: { jotformFormId: formId, jotformSubmissionId: submissionId },
    });
    await prisma.$disconnect();
  }
});


