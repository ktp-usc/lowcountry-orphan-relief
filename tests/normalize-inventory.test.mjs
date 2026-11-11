import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

async function loadNormalizer() {
  const sourcePath = resolve(projectRoot, "lib/jotform/normalize-inventory.ts");

  if (process.features.typescript) {
    return import(`file://${sourcePath.replace(/\\/g, "/")}`);
  }

  const source = await readFile(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

async function readFixture(name) {
  const fixturePath = resolve(projectRoot, "lib/jotform/sample-data", name);
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

const { normalizeInventorySubmission, Location } = await loadNormalizer();

const LOWCOUNTRY_FORM_ID = "241895593214161";
const MIDLANDS_FORM_ID = "250054265404145";

test("normalizes valid submissions for both locations", async () => {
  const lowFixture = await readFixture("lor-inventory-submission.json");
  const midFixture = await readFixture("mor-inventory-submission.json");

  const lowSubmission = {
    ...lowFixture,
    id: "low-valid-1",
    created_at: "2026-11-02 16:03:42",
    answers: {
      "8": { answer: "5" },
      "49": { answer: "0" },
      "50": { answer: "" },
      "51": { answer: "2" },
    },
  };

  const low = normalizeInventorySubmission(LOWCOUNTRY_FORM_ID, lowSubmission);
  const mid = normalizeInventorySubmission(MIDLANDS_FORM_ID, midFixture);

  assert.equal(low.submission.location, Location.LOWCOUNTRY);
  assert.equal(mid.submission.location, Location.MIDLANDS);

  assert.deepEqual(
    low.inventoryActivities,
    [
      { itemCode: "MENS_TOPS", quantity: 5, direction: "IN" },
      { itemCode: "WIPES", quantity: 2, direction: "IN" },
    ],
  );

  assert.deepEqual(
    mid.inventoryActivities,
    [
      { itemCode: "MENS_TOPS", quantity: 51, direction: "IN" },
      { itemCode: "STUFFED_ANIMALS", quantity: 16, direction: "IN" },
      { itemCode: "TOILETRY_KIT_6_11_YRS", quantity: 9, direction: "IN" },
      { itemCode: "MENS_JACKETS_HOODIES", quantity: 3, direction: "IN" },
      { itemCode: "WOMENS_TOPS", quantity: 38, direction: "IN" },
      { itemCode: "WOMENS_DRESSES", quantity: 13, direction: "IN" },
      { itemCode: "WOMENS_JACKETS_HOODIES", quantity: 3, direction: "IN" },
      { itemCode: "CHILDRENS_TOPS", quantity: 51, direction: "IN" },
      { itemCode: "CHILDRENS_DRESSES", quantity: 3, direction: "IN" },
      { itemCode: "CHILDRENS_JACKETS_HOODIES", quantity: 10, direction: "IN" },
    ],
  );
});

test("treats missing answer values as blanks", async () => {
  const fixture = await readFixture("mor-inventory-submission.json");
  const result = normalizeInventorySubmission(MIDLANDS_FORM_ID, {
    ...fixture,
    id: "missing-answer-values",
    answers: {
      "8": { name: "mensTops", text: "Men's Tops", type: "control_number" },
      "49": { answer: "" },
      "50": { answer: "0" },
    },
  });

  assert.deepEqual(result.inventoryActivities, []);
});

test("rejects invalid quantities such as text and fractions", async () => {
  const fixture = await readFixture("mor-inventory-submission.json");

  assert.throws(
    () =>
      normalizeInventorySubmission(MIDLANDS_FORM_ID, {
        ...fixture,
        id: "bad-text",
        answers: { ...fixture.answers, "8": { answer: "abc" } },
      }),
    /Invalid quantity for field 8/i,
  );

  assert.throws(
    () =>
      normalizeInventorySubmission(MIDLANDS_FORM_ID, {
        ...fixture,
        id: "bad-fraction",
        answers: { ...fixture.answers, "8": { answer: "1.5" } },
      }),
    /Invalid quantity for field 8/i,
  );
});

test("rejects missing or invalid submission id and timestamps", async () => {
  const fixture = await readFixture("mor-inventory-submission.json");

  assert.throws(
    () => normalizeInventorySubmission(MIDLANDS_FORM_ID, { ...fixture, id: "" }),
    /Missing required submission id/i,
  );

  assert.throws(
    () => normalizeInventorySubmission(MIDLANDS_FORM_ID, { ...fixture, created_at: null, updated_at: null }),
    /Missing required submission timestamp/i,
  );

  assert.throws(
    () => normalizeInventorySubmission(MIDLANDS_FORM_ID, { ...fixture, created_at: "not-a-date" }),
    /Invalid submission timestamp/i,
  );
});

