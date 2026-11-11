import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

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

function createMockPrismaClient(seedItems) {
  const state = {
    nextSourceId: 1,
    nextActivityId: 1,
    items: seedItems.map((row) => ({ ...row })),
    sourceSubmissions: [],
    inventoryActivities: [],
  };

  function cloneState(current) {
    return {
      nextSourceId: current.nextSourceId,
      nextActivityId: current.nextActivityId,
      items: current.items.map((row) => ({ ...row })),
      sourceSubmissions: current.sourceSubmissions.map((row) => ({ ...row })),
      inventoryActivities: current.inventoryActivities.map((row) => ({ ...row })),
    };
  }

  const client = {
    _state: state,
    _snapshot() {
      return cloneState(client._state);
    },
    async $transaction(callback) {
      const working = cloneState(client._state);
      const tx = {
        item: {
          async findMany({ where: { code: { in: codes } } }) {
            return working.items.filter((item) => codes.includes(item.code)).map((item) => ({ id: item.id, code: item.code }));
          },
        },
        sourceSubmission: {
          async findUnique({ where: { jotformFormId_jotformSubmissionId: key } }) {
            const found = working.sourceSubmissions.find(
              (row) => row.jotformFormId === key.jotformFormId && row.jotformSubmissionId === key.jotformSubmissionId,
            );
            return found ? { id: found.id } : null;
          },
          async create({ data }) {
            const createdSubmission = {
              id: working.nextSourceId++,
              jotformFormId: data.jotformFormId,
              jotformSubmissionId: data.jotformSubmissionId,
              location: data.location,
              sourceType: data.sourceType,
              submissionDate: data.submissionDate,
            };
            working.sourceSubmissions.push(createdSubmission);

            for (const activity of data.inventoryActivities.create) {
              working.inventoryActivities.push({
                id: working.nextActivityId++,
                jotformFormId: data.jotformFormId,
                jotformSubmissionId: data.jotformSubmissionId,
                itemId: activity.itemId,
                quantity: activity.quantity,
                direction: activity.direction,
              });
            }

            return { id: createdSubmission.id };
          },
        },
      };

      const result = await callback(tx);
      client._state = working;
      return result;
    },
  };

  return client;
}

const { saveSubmission } = await loadSaveSubmission();

const items = [
  { id: 1, code: "MENS_TOPS" },
  { id: 2, code: "WIPES" },
  { id: 3, code: "DIAPERS" },
];

test("saves inventory IN and OUT activities and referral OUT activities", async () => {
  const prisma = createMockPrismaClient(items);

  const inventoryInput = {
    submission: {
      jotformFormId: "241895593214161",
      jotformSubmissionId: "inv-1001",
      location: "LOWCOUNTRY",
      sourceType: "INVENTORY",
      submissionDate: new Date("2026-11-07T10:00:00.000Z"),
    },
    inventoryActivities: [
      { itemCode: "MENS_TOPS", quantity: 4, direction: "IN" },
      { itemCode: "WIPES", quantity: 2, direction: "IN" },
      { itemCode: "DIAPERS", quantity: 1, direction: "OUT" },
    ],
  };

  const referralInput = {
    submission: {
      jotformFormId: "REFERRAL_FORM_1",
      jotformSubmissionId: "ref-2001",
      location: "MIDLANDS",
      sourceType: "REFERRAL",
      submissionDate: new Date("2026-11-07T11:00:00.000Z"),
    },
    inventoryActivities: [
      { itemCode: "DIAPERS", quantity: 3, direction: "OUT" },
    ],
  };

  const inventoryResult = await saveSubmission(prisma, inventoryInput);
  const referralResult = await saveSubmission(prisma, referralInput);

  assert.deepEqual(inventoryResult, {
    status: "saved",
    sourceSubmissionId: 1,
    savedActivityCount: 3,
  });

  assert.deepEqual(referralResult, {
    status: "saved",
    sourceSubmissionId: 2,
    savedActivityCount: 1,
  });

  const snapshot = prisma._snapshot();
  assert.equal(snapshot.sourceSubmissions.length, 2);
  assert.equal(snapshot.inventoryActivities.length, 4);
  assert.deepEqual(snapshot.inventoryActivities.map((row) => row.direction), ["IN", "IN", "OUT", "OUT"]);
});

test("skips an existing jotform form and submission combination", async () => {
  const prisma = createMockPrismaClient(items);

  const input = {
    submission: {
      jotformFormId: "241895593214161",
      jotformSubmissionId: "inv-duplicate-1",
      location: "LOWCOUNTRY",
      sourceType: "INVENTORY",
      submissionDate: new Date("2026-11-07T10:00:00.000Z"),
    },
    inventoryActivities: [{ itemCode: "MENS_TOPS", quantity: 5, direction: "IN" }],
  };

  const first = await saveSubmission(prisma, input);
  const second = await saveSubmission(prisma, input);

  assert.deepEqual(first, {
    status: "saved",
    sourceSubmissionId: 1,
    savedActivityCount: 1,
  });
  assert.deepEqual(second, {
    status: "skipped",
    reason: "existing-submission",
  });

  const snapshot = prisma._snapshot();
  assert.equal(snapshot.sourceSubmissions.length, 1);
  assert.equal(snapshot.inventoryActivities.length, 1);
});

test("throws on missing item code matches and does not persist partial rows", async () => {
  const prisma = createMockPrismaClient(items);

  const before = prisma._snapshot();

  const badInput = {
    submission: {
      jotformFormId: "241895593214161",
      jotformSubmissionId: "inv-bad-code-1",
      location: "LOWCOUNTRY",
      sourceType: "INVENTORY",
      submissionDate: new Date("2026-11-07T10:00:00.000Z"),
    },
    inventoryActivities: [
      { itemCode: "MENS_TOPS", quantity: 2, direction: "IN" },
      { itemCode: "NOT_IN_DB", quantity: 1, direction: "IN" },
    ],
  };

  await assert.rejects(
    saveSubmission(prisma, badInput),
    /No Item rows found for codes: NOT_IN_DB/i,
  );

  const after = prisma._snapshot();
  assert.deepEqual(after, before);
});

test("throws when source type and activity direction do not match", async () => {
  const prisma = createMockPrismaClient(items);

  await assert.rejects(
    saveSubmission(prisma, {
      submission: {
        jotformFormId: "REFERRAL_FORM_2",
        jotformSubmissionId: "ref-bad-direction",
        location: "MIDLANDS",
        sourceType: "REFERRAL",
        submissionDate: new Date("2026-11-07T12:00:00.000Z"),
      },
      inventoryActivities: [{ itemCode: "DIAPERS", quantity: 1, direction: "IN" }],
    }),
    /does not match source type REFERRAL/i,
  );

  const snapshot = prisma._snapshot();
  assert.equal(snapshot.sourceSubmissions.length, 0);
  assert.equal(snapshot.inventoryActivities.length, 0);
});

