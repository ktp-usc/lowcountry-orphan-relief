import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSheetRow, SheetValidationError } from "../lib/sheets/normalize-row.ts";
import { SHEET_MAPPINGS, REFERRAL_CLASSIFICATIONS } from "../lib/sheets/mappings.ts";

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

for (const mapping of referralMappings) {
  test(`${mapping.key} infers child types from sizes and agreement, including socks and uniforms`, (t) => {
    const warnings = [];
    t.mock.method(console, "warn", (message) => warnings.push(message));
    const data = row(mapping, {
      "Child's Sex": "Male",
      "Tops?": "Yes", "Bottoms?": "Yes", "Jackets?": "Yes", "Underwear?": "Yes",
      "Shoes?": "Yes", "Socks?": "Yes", "School Uniform Tops": "Yes", "School Uniform Bottoms": "Yes",
      "Child Female Bottoms Size": "6", "Child Male Jackets Size": "6",
      "Child Female Underwear Size": "6", "Adult Male Tops Size": "S", "Child Male Tops Size": "6",
    });
    const original = structuredClone(data);
    const result = normalizeSheetRow(mapping, data);
    for (const category of ["TOPS", "BOTTOMS", "JACKETS_HOODIES", "UNDERWEAR", "SHOES", "SOCKS"]) {
      assert.ok(activity(result, `CHILDRENS_${category}`));
    }
    assert.deepEqual(data, original);
    assert.deepEqual(warnings, [
      `${mapping.key}: submission 0009876543210987654321, row 2: inferred classifications for Tops, Bottoms, Jackets, Underwear, Shoes.`,
    ]);
  });

  test(`${mapping.key} infers adult dresses from an optional size column`, (t) => {
    t.mock.method(console, "warn", () => {});
    const result = normalizeSheetRow(mapping, row(mapping, {
      "Child's Sex": "Female", "Dresses?": "Yes", " adult female dresses size ": " M ",
    }));
    assert.ok(activity(result, "WOMENS_DRESSES"));
  });

  test(`${mapping.key} fills classifications for socks and uniforms without base requests`, (t) => {
    t.mock.method(console, "warn", () => {});
    const result = normalizeSheetRow(mapping, row(mapping, {
      "Child's Sex": "Female", "Socks?": "Yes", "School Uniform Tops": "Yes", "School Uniform Bottoms": "Yes",
      "Adult Female Shoes Size": "7", "Child Male Tops Size": "6", "Adult Female Bottoms Size": "M",
    }));
    for (const code of ["WOMENS_SOCKS", "CHILDRENS_TOPS", "WOMENS_BOTTOMS"]) {
      assert.ok(activity(result, code));
    }
    assert.equal(activity(result, "WOMENS_SHOES"), undefined);
  });

  test(`${mapping.key} keeps unresolved and explicit invalid classifications as errors`, (t) => {
    t.mock.method(console, "warn", () => assert.fail("Failed rows must not log successful inference"));
    for (const overrides of [
      {},
      { "Adult Female Tops Size": "M" },
      { "Child Male Tops Size": "6", "Adult Male Tops Size": "S" },
      { "Child Male Tops Size": " N/A " },
      { "Child Male Tops Size": "none" },
      { "Child Male Tops Size": "no" },
      { "Male Tops Type": "PRIVATE-INVALID", "Child Male Tops Size": "6" },
      { "Bottoms?": "Yes", "Male Bottoms Type": "Adult", "Jackets?": "Yes", "Male Jackets Type": "Child/Baby" },
      { "Male Bottoms Type": "Adult" },
      { "Child's Sex": "", "Child Male Tops Size": "6" },
    ]) {
      assert.throws(() => normalizeSheetRow(mapping, row(mapping, {
        "Child's Sex": "Male", "Tops?": "Yes", ...overrides,
      })), (error) => error instanceof SheetValidationError
        && error.code === "REFERRAL" && !error.message.includes("PRIVATE-INVALID"));
    }
  });

  test(`${mapping.key} preserves explicit classifications over size hints`, (t) => {
    t.mock.method(console, "warn", () => assert.fail("Explicit types must not be inferred"));
    const result = normalizeSheetRow(mapping, row(mapping, {
      "Child's Sex": "Female", "Tops?": "Yes", "Female Tops Type": "Adult", "Child Female Tops Size": "6",
    }));
    assert.ok(activity(result, "WOMENS_TOPS"));
    assert.equal(activity(result, "CHILDRENS_TOPS"), undefined);
  });
}


for (const mapping of referralMappings) {
  test(`${mapping.key} borrows agreed types from socks and uniforms for every clothing category`, (t) => {
    t.mock.method(console, "warn", () => {});
    const donors = [
      ["Socks?", "Female Shoes Type"],
      ["School Uniform Tops", "Female Tops Type"],
      ["School Uniform Bottoms", "Female Bottoms Type"],
    ];
    for (const [item, requestId, , typeId] of REFERRAL_CLASSIFICATIONS) {
      for (const [requestHeader, typeHeader] of donors) {
        if (mapping.answerHeaders[typeId] === typeHeader) continue;
        for (const type of ["Adult", "Child/Baby"]) {
          const overrides = {
            "Child's Sex": "Female", "Childs Age": "6 years",
            [mapping.answerHeaders[requestId]]: "Yes",
            [requestHeader]: "Yes", [typeHeader]: type,
          };
          const inferred = normalizeSheetRow(mapping, row(mapping, overrides));
          const explicit = normalizeSheetRow(mapping, row(mapping, {
            ...overrides, [mapping.answerHeaders[typeId]]: type,
          }));
          assert.deepEqual(inferred, explicit, `${item} should borrow ${type} from ${requestHeader}`);
        }
      }
    }
  });

  test(`${mapping.key} refuses to choose between conflicting socks and uniform types`, () => {
    assert.throws(() => normalizeSheetRow(mapping, row(mapping, {
      "Child's Sex": "Female", "Childs Age": "6 years", "Pajamas?": "Yes",
      "Socks?": "Yes", "Female Shoes Type": "Adult",
      "School Uniform Tops": "Yes", "Female Tops Type": "Child/Baby",
    })), (error) => error instanceof SheetValidationError && error.code === "REFERRAL"
      && error.message.includes("PAJAMAS"));
  });
}
