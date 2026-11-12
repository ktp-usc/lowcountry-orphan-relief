import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSheetRow, SheetValidationError } from "../lib/sheets/normalize-row.ts";
import { SHEET_MAPPINGS } from "../lib/sheets/mappings.ts";

const row = (mapping, overrides = {}, { cancelled = false, date = "2026-07-01 9:15:00" } = {}) => ({
  rowNumber: 2,
  cancelled,
  values: {
    ...Object.fromEntries(Object.values(mapping.answerHeaders).map((header) => [header, ""])),
    [mapping.submissionDateHeader]: date,
    [mapping.submissionIdHeader]: "0009876543210987654321",
    "Childs Age": "",
    "Child's Sex": "",
    ...overrides,
  },
});
const referralMappings = SHEET_MAPPINGS.filter((mapping) => mapping.sourceType === "REFERRAL");
const inventoryMappings = SHEET_MAPPINGS.filter((mapping) => mapping.sourceType === "INVENTORY");
const activity = (result, code) => result.input.inventoryActivities.find((item) => item.itemCode === code);

for (const mapping of SHEET_MAPPINGS) {
  test(`${mapping.key} normalizes a header-keyed KAN-30 row`, () => {
    const data = row(mapping, mapping.sourceType === "INVENTORY"
      ? { "Men's Tops": "5", "Women's Tops": "-3", Books: "0" }
      : { "Tops?": "Yes", "Child's Sex": "Female", "Female Tops Type": "Adult" });
    const result = normalizeSheetRow(mapping, data);
    assert.equal(result.kind, "active");
    assert.equal(result.input.submission.jotformFormId, mapping.jotformFormId);
    assert.equal(result.input.submission.jotformSubmissionId, "0009876543210987654321");
    assert.equal(result.input.submission.location, mapping.location);
    assert.equal(result.input.submission.sourceType, mapping.sourceType);
    assert.ok(result.input.submission.submissionDate instanceof Date);
    assert.equal(result.input.submission.submissionDate.toISOString(), "2026-07-01T13:15:00.000Z");
    if (mapping.sourceType === "INVENTORY") {
      assert.deepEqual(activity(result, "MENS_TOPS"), { itemCode: "MENS_TOPS", quantity: 5, direction: "IN" });
      assert.deepEqual(activity(result, "WOMENS_TOPS"), { itemCode: "WOMENS_TOPS", quantity: 3, direction: "OUT" });
      assert.equal(activity(result, "BOOKS"), undefined);
    } else {
      assert.equal(activity(result, "WOMENS_TOPS").quantity, 5);
      assert.equal(activity(result, "BOOKS").quantity, 2);
      assert.equal(activity(result, "STUFFED_ANIMALS").quantity, 2);
    }
  });
}

for (const mapping of referralMappings) {
  test(`${mapping.key} reads values by exact header regardless of property order`, () => {
    const standard = row(mapping, {
      "Tops?": "Yes", "Child's Sex": "Female", "Female Tops Type": "Adult",
    });
    const reordered = {
      rowNumber: standard.rowNumber,
      cancelled: false,
      values: Object.fromEntries(Object.entries(standard.values).reverse()),
    };
    assert.deepEqual(normalizeSheetRow(mapping, reordered), normalizeSheetRow(mapping, standard));
  });

  test(`${mapping.key} uses exact age and sex headers for referral classifications`, () => {
    const female = normalizeSheetRow(mapping, row(mapping, {
      "Tops?": "Yes", "Child's Sex": "Female", "Female Tops Type": "Adult",
    }));
    const male = normalizeSheetRow(mapping, row(mapping, {
      "Tops?": "Yes", "Child's Sex": "Male", "Male Tops Type": "Adult",
    }));
    assert.equal(activity(female, "WOMENS_TOPS").quantity, 5);
    assert.equal(activity(male, "MENS_TOPS").quantity, 5);
    const wrongSexHeader = row(mapping, {
      "Tops?": "Yes", "Male Tops Type": "Adult",
    });
    delete wrongSexHeader.values["Child's Sex"];
    wrongSexHeader.values["Child's Sex "] = "Male";
    assert.throws(() => normalizeSheetRow(mapping, wrongSexHeader),
      (error) => error instanceof SheetValidationError && error.code === "COLUMN");
  });

  test(`${mapping.key} evaluates toiletries and infant pajamas from Childs Age`, () => {
    const toiletry = normalizeSheetRow(mapping, row(mapping, {
      Toiletries: "Yes", "Childs Age": "6 years",
    }));
    assert.equal(activity(toiletry, "TOILETRY_KIT_6_11_YRS").quantity, 1);

    for (const age of ["0-3 months", "3-6 months", "6-9 months"]) {
      const infant = normalizeSheetRow(mapping, row(mapping, {
        "Pajamas?": "Yes", "Child's Sex": "Male", "Male Pajamas Type": "Child/Baby", "Childs Age": age,
      }));
      assert.equal(activity(infant, "CHILDRENS_PAJAMAS").quantity, 4);
    }
    const olderChild = normalizeSheetRow(mapping, row(mapping, {
      "Pajamas?": "Yes", "Child's Sex": "Female", "Female Pajamas Type": "Child/Baby", "Childs Age": "1 year",
    }));
    assert.equal(activity(olderChild, "CHILDRENS_PAJAMAS").quantity, 1);
    for (const overrides of [
      { Toiletries: "Yes" },
      { "Pajamas?": "Yes", "Child's Sex": "Female", "Female Pajamas Type": "Child/Baby" },
      { Toiletries: "Yes", "Childs Age": "PRIVATE-ANSWER" },
    ]) {
      assert.throws(() => normalizeSheetRow(mapping, row(mapping, overrides)), (error) => {
        assert.ok(error instanceof SheetValidationError);
        assert.equal(error.message.includes("PRIVATE-ANSWER"), false);
        return true;
      });
    }
  });

  test(`${mapping.key} uses requested base classifications independently`, () => {
    const result = normalizeSheetRow(mapping, row(mapping, {
      "Child's Sex": "Female",
      "Socks?": "Yes", "Female Shoes Type": "Adult",
      "School Uniform Tops": "Yes", "Female Tops Type": "Child/Baby",
      "School Uniform Bottoms": "Yes", "Female Bottoms Type": "Adult",
      "Underwear?": "Yes", "Female Underwear Type": "Adult",
    }));
    assert.equal(activity(result, "WOMENS_SOCKS").quantity, 1);
    assert.equal(activity(result, "CHILDRENS_TOPS").quantity, 2);
    assert.equal(activity(result, "WOMENS_BOTTOMS").quantity, 2);
    assert.equal(activity(result, "WOMENS_UNDERWEAR").quantity, 1);
    assert.equal(activity(result, "WOMENS_SHOES"), undefined);
  });
}

for (const mapping of inventoryMappings) {
  test(`${mapping.key} rejects invalid inventory quantities safely`, () => {
    assert.throws(() => normalizeSheetRow(mapping, row(mapping, { "Men's Tops": "PRIVATE-ANSWER" })), (error) =>
      error instanceof SheetValidationError && error.code === "QUANTITY" && !error.message.includes("PRIVATE-ANSWER"));
  });
}

for (const mapping of SHEET_MAPPINGS) {
  test(`${mapping.key} handles cancellation before dates and item answers`, () => {
    const cancelled = row(mapping, {
      "Men's Tops": "PRIVATE-ANSWER", "Pajamas?": "Yes",
      "Male Pajamas Type": "INVALID", "Childs Age": "INVALID",
    }, { cancelled: true, date: "not-a-date" });
    assert.deepEqual(normalizeSheetRow(mapping, cancelled), {
      kind: "cancelled",
      jotformFormId: mapping.jotformFormId,
      jotformSubmissionId: "0009876543210987654321",
    });
    assert.equal(normalizeSheetRow(mapping, row(mapping, {}, { cancelled: false })).kind, "active");
    const missingId = row(mapping, { "Submission ID": "" }, { cancelled: true, date: "not-a-date" });
    assert.throws(() => normalizeSheetRow(mapping, missingId), (error) => error.code === "SUBMISSION_ID");
  });
}

const mor = SHEET_MAPPINGS.find((mapping) => mapping.key === "mor-referral");
test("MOR referral requires exact Submission Date and keeps the Eastern timezone convention", () => {
  const valid = normalizeSheetRow(mor, row(mor));
  assert.equal(valid.input.submission.submissionDate.toISOString(), "2026-07-01T13:15:00.000Z");
  for (const values of [
    { "Childs Age": "", " ": "2026-07-01 09:15:00" },
    { "Childs Age": "", "Submission Date ": "2026-07-01 09:15:00" },
  ]) {
    const noDate = row(mor, values);
    delete noDate.values["Submission Date"];
    assert.throws(() => normalizeSheetRow(mor, noDate), (error) => error.code === "COLUMN");
  }
  assert.throws(() => normalizeSheetRow(mor, row(mor, {}, { date: "2026-02-30 10:00:00" })), /date/i);
  assert.throws(() => normalizeSheetRow(mor, row(mor, {}, { date: "2026-11-01 01:30:00" })), /date/i);
  const missing = row(mor);
  delete missing.values["Submission Date"];
  assert.throws(() => normalizeSheetRow(mor, missing), (error) => error.code === "COLUMN");
});

test("validates source and submission IDs without leaking values", () => {
  const mapping = SHEET_MAPPINGS[0];
  for (const value of ["", "1.23E+20", "PRIVATE-ANSWER"]) {
    assert.throws(() => normalizeSheetRow(mapping, row(mapping, { "Submission ID": value })), (error) =>
      error.code === "SUBMISSION_ID" && !error.message.includes("PRIVATE"));
  }
  assert.throws(() => normalizeSheetRow({ ...mapping, jotformFormId: "" }, row(mapping)), /source/i);
});
