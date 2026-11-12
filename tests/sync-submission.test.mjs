import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

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

function createMockPrismaClient(seedItems) {
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
    _state: {
      nextSourceId: 1,
      nextActivityId: 1,
      items: seedItems.map((row) => ({ ...row })),
      sourceSubmissions: [],
      inventoryActivities: [],
    },
    _failOn: null,
    _snapshot() {
      return cloneState(client._state);
    },
    async $transaction(callback) {
      // Work on a copy; only commit it if the whole callback succeeds.
      const working = cloneState(client._state);
      const keyMatches = (row, key) =>
        row.jotformFormId === key.jotformFormId &&
        row.jotformSubmissionId === key.jotformSubmissionId;

      const tx = {
        item: {
          async findMany({ where: { code: { in: codes } } }) {
            return working.items
              .filter((item) => codes.includes(item.code))
              .map((item) => ({ id: item.id, code: item.code }));
          },
        },
        sourceSubmission: {
          async findUnique({ where: { jotformFormId_jotformSubmissionId: key } }) {
            const found = working.sourceSubmissions.find((row) => keyMatches(row, key));
            if (!found) return null;
            return {
              id: found.id,
              location: found.location,
              sourceType: found.sourceType,
              submissionDate: new Date(found.submissionDate),
              inventoryActivities: working.inventoryActivities
                .filter((activity) => keyMatches(activity, key))
                .map((activity) => ({
                  quantity: activity.quantity,
                  direction: activity.direction,
                  item: { code: working.items.find((item) => item.id === activity.itemId).code },
                })),
            };
          },
          async create({ data }) {
            const created = {
              id: working.nextSourceId++,
              jotformFormId: data.jotformFormId,
              jotformSubmissionId: data.jotformSubmissionId,
              location: data.location,
              sourceType: data.sourceType,
              submissionDate: data.submissionDate,
            };
            working.sourceSubmissions.push(created);

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
            return { id: created.id };
          },
          async update({ where: { jotformFormId_jotformSubmissionId: key }, data }) {
            const found = working.sourceSubmissions.find((row) => keyMatches(row, key));
            found.location = data.location;
            found.sourceType = data.sourceType;
            found.submissionDate = data.submissionDate;
            return { id: found.id };
          },
        },
        inventoryActivity: {
          async deleteMany({ where }) {
            const before = working.inventoryActivities.length;
            working.inventoryActivities = working.inventoryActivities.filter(
              (activity) => !keyMatches(activity, where),
            );
            return { count: before - working.inventoryActivities.length };
          },
          async createMany({ data }) {
            if (client._failOn === "createMany") {
              throw new Error("simulated database failure");
            }
            for (const row of data) {
              working.inventoryActivities.push({ id: working.nextActivityId++, ...row });
            }
            return { count: data.length };
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

const { syncSubmission } = await loadSyncSubmission();

const items = [
  { id: 1, code: "MENS_TOPS" },
  { id: 2, code: "WIPES" },
  { id: 3, code: "DIAPERS" },
];

const FORM = "KAN33-FORM";

function active(activities, submissionId = "sync-1", overrides = {}) {
  return {
    kind: "active",
    input: {
      submission: {
        jotformFormId: FORM,
        jotformSubmissionId: submissionId,
        location: "LOWCOUNTRY",
        sourceType: "INVENTORY",
        submissionDate: new Date("2026-11-07T10:00:00.000Z"),
        ...overrides,
      },
      inventoryActivities: activities,
    },
  };
}

function cancelled(submissionId = "sync-1") {
  return { kind: "cancelled", jotformFormId: FORM, jotformSubmissionId: submissionId };
}

function activitiesOf(prisma, submissionId = "sync-1") {
  const snapshot = prisma._snapshot();
  return snapshot.inventoryActivities
    .filter((activity) => activity.jotformSubmissionId === submissionId)
    .map((activity) => {
      const code = snapshot.items.find((item) => item.id === activity.itemId).code;
      return `${code}:${activity.quantity}:${activity.direction}`;
    })
    .sort();
}

const baseActivities = [
  { itemCode: "MENS_TOPS", quantity: 4, direction: "IN" },
  { itemCode: "WIPES", quantity: 2, direction: "OUT" },
];

test("creates a new active submission and its activities", async () => {
  const prisma = createMockPrismaClient(items);

  const result = await syncSubmission(prisma, active(baseActivities));

  assert.deepEqual(result, { status: "created" });
  const snapshot = prisma._snapshot();
  assert.equal(snapshot.sourceSubmissions.length, 1);
  assert.deepEqual(activitiesOf(prisma), ["MENS_TOPS:4:IN", "WIPES:2:OUT"]);
});

test("updates an edited quantity and replaces the old activities", async () => {
  const prisma = createMockPrismaClient(items);
  await syncSubmission(prisma, active(baseActivities));

  const edited = [
    { itemCode: "MENS_TOPS", quantity: 7, direction: "IN" },
    { itemCode: "WIPES", quantity: 2, direction: "OUT" },
  ];
  const result = await syncSubmission(prisma, active(edited));

  assert.deepEqual(result, { status: "updated" });
  const snapshot = prisma._snapshot();
  assert.equal(snapshot.sourceSubmissions.length, 1);
  assert.equal(snapshot.inventoryActivities.length, 2);
  assert.deepEqual(activitiesOf(prisma), ["MENS_TOPS:7:IN", "WIPES:2:OUT"]);
});

test("updates when the submission metadata changes", async () => {
  const prisma = createMockPrismaClient(items);
  await syncSubmission(prisma, active(baseActivities));

  const result = await syncSubmission(
    prisma,
    active(baseActivities, "sync-1", { location: "MIDLANDS" }),
  );

  assert.deepEqual(result, { status: "updated" });
  assert.equal(prisma._snapshot().sourceSubmissions[0].location, "MIDLANDS");
  assert.deepEqual(activitiesOf(prisma), ["MENS_TOPS:4:IN", "WIPES:2:OUT"]);
});

test("saving the same data again leaves the database unchanged", async () => {
  const prisma = createMockPrismaClient(items);
  await syncSubmission(prisma, active(baseActivities));
  const before = prisma._snapshot();

  const result = await syncSubmission(prisma, active(baseActivities));

  assert.deepEqual(result, { status: "unchanged" });
  assert.deepEqual(prisma._snapshot(), before);
});

test("a different activity order is not treated as a change", async () => {
  const prisma = createMockPrismaClient(items);
  await syncSubmission(prisma, active(baseActivities));
  const before = prisma._snapshot();

  const result = await syncSubmission(prisma, active([...baseActivities].reverse()));

  assert.deepEqual(result, { status: "unchanged" });
  assert.deepEqual(prisma._snapshot(), before);
});

test("cancelling deletes the activities but keeps the SourceSubmission", async () => {
  const prisma = createMockPrismaClient(items);
  await syncSubmission(prisma, active(baseActivities));

  const result = await syncSubmission(prisma, cancelled());

  assert.deepEqual(result, { status: "cancelled" });
  const snapshot = prisma._snapshot();
  assert.equal(snapshot.sourceSubmissions.length, 1);
  assert.equal(snapshot.inventoryActivities.length, 0);
});

test("cancelling again changes nothing", async () => {
  const prisma = createMockPrismaClient(items);
  await syncSubmission(prisma, active(baseActivities));
  await syncSubmission(prisma, cancelled());
  const before = prisma._snapshot();

  const result = await syncSubmission(prisma, cancelled());

  assert.deepEqual(result, { status: "cancelled" });
  assert.deepEqual(prisma._snapshot(), before);
});

test("a cancelled submission that was never imported creates nothing", async () => {
  const prisma = createMockPrismaClient(items);

  const result = await syncSubmission(prisma, cancelled("never-imported"));

  assert.deepEqual(result, { status: "cancelled" });
  const snapshot = prisma._snapshot();
  assert.equal(snapshot.sourceSubmissions.length, 0);
  assert.equal(snapshot.inventoryActivities.length, 0);
});

test("a cancelled submission that becomes active again is restored", async () => {
  const prisma = createMockPrismaClient(items);
  await syncSubmission(prisma, active(baseActivities));
  await syncSubmission(prisma, cancelled());

  const result = await syncSubmission(prisma, active(baseActivities));

  assert.deepEqual(result, { status: "updated" });
  const snapshot = prisma._snapshot();
  assert.equal(snapshot.sourceSubmissions.length, 1);
  assert.deepEqual(activitiesOf(prisma), ["MENS_TOPS:4:IN", "WIPES:2:OUT"]);
});

test("invalid updates keep the previous data and save nothing partially", async () => {
  const prisma = createMockPrismaClient(items);
  await syncSubmission(prisma, active(baseActivities));
  const before = prisma._snapshot();

  const unknownCode = [
    { itemCode: "MENS_TOPS", quantity: 9, direction: "IN" },
    { itemCode: "NOT_IN_DB", quantity: 1, direction: "IN" },
  ];
  await assert.rejects(
    syncSubmission(prisma, active(unknownCode)),
    /No Item rows found for codes: NOT_IN_DB/i,
  );
  assert.deepEqual(prisma._snapshot(), before);

  await assert.rejects(
    syncSubmission(prisma, active([{ itemCode: "MENS_TOPS", quantity: 0, direction: "IN" }])),
    /Invalid quantity/i,
  );
  assert.deepEqual(prisma._snapshot(), before);

  await assert.rejects(
    syncSubmission(prisma, active([{ itemCode: "MENS_TOPS", quantity: 2.5, direction: "IN" }])),
    /Invalid quantity/i,
  );
  assert.deepEqual(prisma._snapshot(), before);

  await assert.rejects(
    syncSubmission(
      prisma,
      active([{ itemCode: "DIAPERS", quantity: 1, direction: "IN" }], "sync-1", {
        sourceType: "REFERRAL",
      }),
    ),
    /does not match source type REFERRAL/i,
  );
  assert.deepEqual(prisma._snapshot(), before);

  await assert.rejects(
    syncSubmission(prisma, active(baseActivities, "sync-1", { location: "NOWHERE" })),
    /Invalid location/i,
  );
  assert.deepEqual(prisma._snapshot(), before);
});

test("a failure in the middle of an update rolls everything back", async () => {
  const prisma = createMockPrismaClient(items);
  await syncSubmission(prisma, active(baseActivities));
  const before = prisma._snapshot();

  prisma._failOn = "createMany";
  await assert.rejects(
    syncSubmission(prisma, active([{ itemCode: "MENS_TOPS", quantity: 9, direction: "IN" }])),
    /simulated database failure/i,
  );
  prisma._failOn = null;

  // The old activities were deleted inside the transaction, but must be back.
  assert.deepEqual(prisma._snapshot(), before);
});

test("an invalid brand-new submission saves nothing", async () => {
  const prisma = createMockPrismaClient(items);

  await assert.rejects(
    syncSubmission(prisma, active([{ itemCode: "NOT_IN_DB", quantity: 1, direction: "IN" }])),
    /No Item rows found/i,
  );

  const snapshot = prisma._snapshot();
  assert.equal(snapshot.sourceSubmissions.length, 0);
  assert.equal(snapshot.inventoryActivities.length, 0);
});