import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSheetRow, SheetValidationError } from "../lib/sheets/normalize-row.ts";
import { SHEET_SOURCES } from "../lib/sheets/sources.ts";

const inventoryHeaders = [
  "Submission Date", "Men's Tops", "Men's Bottoms", "Men's Jackets", "Men's Pajamas", "Men's Socks",
  "Men's Underwear", "Men's Shoes", "Women's Tops", "Women's Bottoms", "Women's Dresses", "Women's Jackets",
  "Women's Pajamas", "Women's Socks", "Women's Underwear", "Women's Shoes", "Children's Tops",
  "Children's Bottoms", "Children's Dresses", "Children's Jackets", "Children's Pajamas", "Children's Socks",
  "Children's Underwear", "Children's Shoes", "Diapers", "Pull-Ups", "Wipes", "Stuffed Animals", "Books",
  "Blanket", "0-5", "6-11", "12-18", "Elementary School Bookbag & Supplies",
  "Middle/High School Bookbag & Supplies", "Submission URL", "Submission Edit URL", "Submission ID",
];
const referralBeforeSocks = [
  "Date", "Are you a Foster Parent?", "", "Case Worker Name", "Agency", "OTHER", "", "", "", "",
  "Referral Type", "", "", "", "", "Tops?", "Male Tops Type", "Female Tops Type", "Adult Male Tops Size",
  "Child Male Tops Size", "Adult Female Tops Size", "Child Female Tops Size", "Bottoms?", "Male Bottoms Type",
  "Female Bottoms Type", "Adult Male Bottoms Size", "Child Male Bottoms Size", "Adult Female Bottoms Size",
  "Child Female Bottoms Size", "Jackets?", "Male Jackets Type", "Female Jackets Type", "Adult Male Jackets Size",
  "Child Male Jackets Size", "Adult Female Jackets Size", "Child Female Jackets Size", "Dresses?",
  "Female Dresses Type", "Adult Female Dresses Size", "Child Female Dresses Size", "Pajamas?", "Male Pajamas Type",
  "Female Pajamas Type", "Adult Male Pajamas Size", "Child Male Pajamas Size", "Adult Female Pajamas Size",
  "Child Female Pajamas Size", "Underwear?", "Male Underwear Type", "Female Underwear Type",
  "Adult Male Underwear Size", "Child Male Underwear Size", "Adult Female Underwear Size", "Child Female Underwear Size",
];
const shoes = ["Shoes?", "Male Shoes Type", "Female Shoes Type", "Adult Male Shoes Size", "Child Male Shoes Size",
  "Adult Female Shoes Size", "Child Female Shoes Size"];
const rest = ["Diapers or Pullups?", "Diapers Size", "Pull Ups Size", "Wipes", "Toiletries", "School",
  "School Uniform Tops", "School Uniform Top Color (Select all options)", "School Uniform Bottoms"];
function headers(source) {
  if (source.sourceType === "INVENTORY") return [...inventoryHeaders];
  const isLow = source.location === "LOWCOUNTRY";
  const middle = [...referralBeforeSocks]; middle[5] = isLow ? " " : "Other Agency";
  const socks = ["Socks?", "Male Socks Type", "Female Socks Type", "Adult Male Socks Size", "Child Male Socks Size",
    "Adult Female Socks Size", "Child Female Socks Size"];
  return [isLow ? "Submission Date" : " ", ...middle,
    ...(isLow ? [...socks, ...shoes] : [...shoes, "Socks?"]), ...rest,
    isLow ? "School Uniform Bottoms Color (Select all options)" : "School Uniform Bottom Color (Select all options)",
    "", ...(isLow ? [] : ["Submission URL", "Submission Edit URL"]), "Submission ID"];
}
function row(source, values = {}, date = "2026-07-01 9:15:00") {
  const names = headers(source);
  return { headers: names, values: names.map((name, i) => i === 0 ? date : name === "Submission ID" ? "0009876543210987654321" : values[name] ?? "") };
}
const activity = (result, code) => result.input.inventoryActivities.find((item) => item.itemCode === code);

for (const source of SHEET_SOURCES) {
  test(`${source.key} normalizes its exact fictional layout`, (t) => {
    t.mock.method(globalThis, "fetch", () => { throw new Error("Network access forbidden"); });
    const data = row(source, source.sourceType === "INVENTORY"
      ? { "Men's Tops": "5", "Women's Tops": "-3", "Books": "0", "Wipes": "" }
      : { "Tops?": "Yes", "Female Tops Type": "Adult" });
    const before = structuredClone(data), sourceBefore = structuredClone(source);
    const result = normalizeSheetRow(source, data);
    assert.equal(result.kind, "active");
    assert.equal(result.input.submission.jotformFormId, source.jotformFormId);
    assert.equal(result.input.submission.jotformSubmissionId, "0009876543210987654321");
    assert.equal(result.input.submission.location, source.location);
    assert.equal(result.input.submission.sourceType, source.sourceType);
    assert.ok(result.input.submission.submissionDate instanceof Date);
    assert.equal(result.input.submission.submissionDate.toISOString(), "2026-07-01T13:15:00.000Z");
    if (source.sourceType === "INVENTORY") {
      assert.deepEqual(activity(result, "MENS_TOPS"), { itemCode: "MENS_TOPS", quantity: 5, direction: "IN" });
      assert.deepEqual(activity(result, "WOMENS_TOPS"), { itemCode: "WOMENS_TOPS", quantity: 3, direction: "OUT" });
      assert.equal(activity(result, "BOOKS"), undefined);
    } else {
      assert.equal(activity(result, "WOMENS_TOPS").quantity, 5);
      assert.equal(activity(result, "BOOKS").quantity, 2);
      assert.equal(activity(result, "STUFFED_ANIMALS").quantity, 2);
    }
    assert.deepEqual(data, before); assert.deepEqual(source, sourceBefore);
  });
}

for (const source of SHEET_SOURCES.filter((s) => s.sourceType === "REFERRAL")) {
  for (const [sex, type, prefix] of [
    ["Female", "Adult", "WOMENS"], ["Male", "Adult", "MENS"],
    ["Female", "Child/Baby", "CHILDRENS"], ["Male", "Child/Baby", "CHILDRENS"],
  ]) {
    test(`${source.key} ${sex} ${type} classifies independent shared requests`, () => {
      const result = normalizeSheetRow(source, row(source, {
        "Socks?": "Yes", [`${sex} Shoes Type`]: type,
        "School Uniform Tops": "Yes", [`${sex} Tops Type`]: type,
        "School Uniform Bottoms": "Yes", [`${sex} Bottoms Type`]: type,
        "Underwear?": "Yes", [`${sex} Underwear Type`]: type,
      }));
      assert.equal(activity(result, `${prefix}_SOCKS`).quantity, 1);
      assert.equal(activity(result, `${prefix}_UNDERWEAR`).quantity, 1);
      assert.equal(activity(result, `${prefix}_TOPS`).quantity, 2);
      assert.equal(activity(result, `${prefix}_BOTTOMS`).quantity, 2);
      assert.equal(activity(result, `${prefix}_SHOES`), undefined);
    });
  }
  test(`${source.key} rejects missing age and missing classification safely`, () => {
    for (const values of [
      { "Socks?": "Yes" }, { "Toiletries": "Yes" },
      { "Pajamas?": "Yes", "Female Pajamas Type": "Child/Baby" },
      { "Socks?": "Yes", "Male Shoes Type": "PRIVATE-ANSWER" },
    ]) {
      assert.throws(() => normalizeSheetRow(source, row(source, values)), (error) => {
        assert.ok(error instanceof SheetValidationError);
        assert.equal(error.message.includes("PRIVATE-ANSWER"), false);
        return true;
      });
    }
    assert.equal(normalizeSheetRow(source, row(source)).kind, "active");
  });
  test(`${source.key} fictional age source allows infant sleeper rule`, () => {
    const withAge = { ...source, answers: { ...source.answers, "158": { header: "Fictional Age" } } };
    const data = row(source, { "Pajamas?": "Yes", "Male Pajamas Type": "Child/Baby" });
    data.headers.push("Fictional Age"); data.values.push("6-9 Months");
    assert.equal(activity(normalizeSheetRow(withAge, data), "CHILDRENS_PAJAMAS").quantity, 4);
  });
}

test("validates IDs and dates without leaking data or inventing defaults", () => {
  const source = SHEET_SOURCES[0], data = row(source);
  for (const invalid of ["", "1.23E+20", "PRIVATE-ANSWER"]) {
    const copy = structuredClone(data); copy.values[copy.headers.indexOf("Submission ID")] = invalid;
    assert.throws(() => normalizeSheetRow(source, copy), (error) => error.code === "SUBMISSION_ID" && !error.message.includes(invalid || "PRIVATE"));
  }
  assert.throws(() => normalizeSheetRow({ ...source, jotformFormId: "" }, data), /source form/);
  for (const date of ["", "2026-02-30 10:00:00", "2026-11-01 01:30:00"]) {
    assert.throws(() => normalizeSheetRow(source, row(source, {}, date)), /date/);
  }
  assert.equal(normalizeSheetRow(source, row(source, {}, "2026-01-01 12:00:00")).input.submission.submissionDate.toISOString(), "2026-01-01T17:00:00.000Z");
  assert.throws(() => normalizeSheetRow(source, row(source, { "Men's Tops": "PRIVATE-ANSWER" })), (error) =>
    error.code === "QUANTITY" && !error.message.includes("PRIVATE-ANSWER"));
  const wrong = row(SHEET_SOURCES[3]); wrong.headers[0] = "";
  assert.throws(() => normalizeSheetRow(SHEET_SOURCES[3], wrong), /indexed column/);
});

for (const base of SHEET_SOURCES) test(`${base.key}: configured cancellation returns identifiers before examining dates and answers`, () => {
  const source = { ...base, cancellation: { column: { header: "Status" }, cancelledValues: ["Cancelled"], activeValues: ["Active"] } };
  const cancelled = row(base, { "Men's Tops": "PRIVATE-ANSWER" }, "not-a-date");
  cancelled.headers.push("Status"); cancelled.values.push("  CANCELLED ");
  const noAnswerAccess = { ...source, get answers() { throw new Error("Answers must not be read"); } };
  assert.deepEqual(normalizeSheetRow(noAnswerAccess, cancelled), {
    kind: "cancelled", jotformFormId: base.jotformFormId, jotformSubmissionId: "0009876543210987654321",
  });
  cancelled.values[cancelled.headers.indexOf("Submission ID")] = "";
  assert.throws(() => normalizeSheetRow(source, cancelled), /submission ID/);
  const active = row(base); active.headers.push("Status"); active.values.push("Active");
  assert.equal(normalizeSheetRow(source, active).kind, "active");
});

test("referral groups can use different classifications without requesting their base items", () => {
  const source = SHEET_SOURCES[2];
  const result = normalizeSheetRow(source, row(source, {
    "Socks?": "Yes", "Female Shoes Type": "Adult",
    "School Uniform Tops": "Yes", "Female Tops Type": "Child/Baby",
    "School Uniform Bottoms": "Yes", "Female Bottoms Type": "Adult",
  }));
  assert.equal(activity(result, "WOMENS_SOCKS").quantity, 1);
  assert.equal(activity(result, "CHILDRENS_TOPS").quantity, 2);
  assert.equal(activity(result, "WOMENS_BOTTOMS").quantity, 2);
});
