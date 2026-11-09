import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { loadReferral } from "../scripts/lib/load-referral.mjs";

const { normalizeReferralSubmission: normalize } = await loadReferral();
const lor = "261498369429070";
const mor = "261526295444158";
const fixture = (name) => JSON.parse(readFileSync(new URL(`../lib/jotform/sample-data/${name}-referral-submission.json`, import.meta.url), "utf8"));
const raw = (values = {}, formId = lor, extra = {}) => ({
  id: "900000000000000003", form_id: formId, created_at: "2026-07-01 12:00:00",
  answers: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { answer: value }])),
  ...extra,
});
const activities = (data, options) => normalize(data.form_id, data, options).inventoryActivities;
const activity = (itemCode, quantity = 1) => ({ itemCode, quantity, direction: "OUT" });
const sorted = (rows) => rows.toSorted((a, b) => a.itemCode.localeCompare(b.itemCode));

test("LOR made-up API sample preserves the KAN-16 contract and combines top requests", () => {
  const result = normalize(lor, fixture("lor"));
  assert.deepEqual(Object.keys(result).sort(), ["inventoryActivities", "submission"]);
  assert.deepEqual(result.submission, {
    jotformFormId: lor, jotformSubmissionId: "900000000000000001",
    location: "LOWCOUNTRY", sourceType: "REFERRAL", submissionDate: new Date("2026-07-15T14:30:00Z"),
  });
  assert.deepEqual(sorted(result.inventoryActivities), sorted([
    activity("CHILDRENS_TOPS", 2), activity("MENS_BOTTOMS"), activity("CHILDRENS_SOCKS"),
    activity("WIPES"), activity("TOILETRY_KIT_6_11_YRS"), activity("ELEMENTARY_SCHOOL_BOOKBAG_SUPPLIES"),
  ]));
});

test("MOR made-up API sample uses Midlands, winter time and its own supply mapping", () => {
  const result = normalize(mor, fixture("mor"));
  assert.equal(result.submission.location, "MIDLANDS");
  assert.equal(result.submission.submissionDate.toISOString(), "2026-01-15T15:30:00.000Z");
  assert.deepEqual(sorted(result.inventoryActivities), sorted([
    activity("WOMENS_TOPS"), activity("CHILDRENS_DRESSES"), activity("CHILDRENS_BOTTOMS"),
    activity("PULL_UPS"), activity("TOILETRY_KIT_12_18_YRS"), activity("MIDDLE_HIGH_SCHOOL_BOOKBAG_SUPPLIES"),
  ]));
});

const clothing = [
  ["88", "90", "93", "TOPS"], ["103", "104", "105", "BOTTOMS"],
  ["110", "111", "112", "JACKETS_HOODIES"], ["126", "127", "128", "PAJAMAS"],
  ["133", "134", "135", "UNDERWEAR"], ["140", "141", "142", "SHOES"],
];
for (const formId of [lor, mor]) {
  for (const [fieldId, maleId, femaleId, category] of clothing) {
    for (const [sex, typeId, prefix] of [["Male", maleId, "MENS"], ["Female", femaleId, "WOMENS"]]) {
      for (const type of ["Adult", "Child/Baby"]) {
        test(`${formId}: ${sex} ${type} ${category} uses the correct seeded item code`, () => {
          // Opposite/hidden branch and sizes deliberately conflict with the active branch.
          const oppositeId = sex === "Male" ? femaleId : maleId;
          const data = raw({ "17": sex, [fieldId]: "Yes", [typeId]: type, [oppositeId]: "Adult", "59": "XL" }, formId);
          assert.deepEqual(activities(data), [activity(`${type === "Adult" ? prefix : "CHILDRENS"}_${category}`)]);
        });
      }
    }
  }
  for (const [type, prefix] of [["Adult", "WOMENS"], ["Child/Baby", "CHILDRENS"]]) {
    test(`${formId}: dresses ${type} uses its single type selector`, () => {
      assert.deepEqual(activities(raw({ "117": "Yes", "119": type }, formId)), [activity(`${prefix}_DRESSES`)]);
    });
  }
  for (const [choice, code] of [["Diapers", "DIAPERS"], ["Pull Ups", "PULL_UPS"]]) {
    test(`${formId}: ${choice} counts one pack without inferring quantity from size`, () => {
      assert.deepEqual(activities(raw({ "159": choice, "78": "Size 6", "80": "4T/5T" }, formId)), [activity(code)]);
    });
  }
}

for (const [age, code] of [
  ["0-3 Months", "0_5"], ["3-6 Months", "0_5"], ["6-9 Months", "0_5"],
  ["1 year", "0_5"], ["5 years", "0_5"], ["6 years", "6_11"],
  ["11 years", "6_11"], ["12 years", "12_18"], ["18 years", "12_18"],
]) {
  test(`toiletry age band: ${age}`, () => {
    for (const formId of [lor, mor]) {
      assert.deepEqual(activities(raw({ "85": "Yes", "158": age }, formId)), [activity(`TOILETRY_KIT_${code}_YRS`)]);
    }
  });
}

test("blank, no, none and unselected requests skip stale hidden selectors and sizes", () => {
  const data = raw({
    "88": "No", "90": "Adult", "93": "Child/Baby", "59": "XL",
    "103": "", "104": "Adult", "81": "No", "85": "No", "158": "not an age",
    "159": "None", "78": "Size 1", "80": "4T/5T", "83": "None",
    "177": ["Navy", "White"], "183": ["Navy", "White"], "184": ["Khaki"],
  });
  assert.deepEqual(activities(data), []);
  assert.deepEqual(activities(raw()), []);
  assert.deepEqual(activities(raw({}, mor, { answers: undefined })), []);
  for (const value of [undefined, null, "", "No", "Maybe", 1, -1, true, false, ["Yes"], { value: "Yes" }]) {
    assert.deepEqual(activities(raw({ "81": value })), []);
  }
});

test("normalizes case and whitespace only for recognized choices", () => {
  assert.deepEqual(activities(raw({ "81": " YES ", "159": " pull UPS " })), [activity("WIPES"), activity("PULL_UPS")]);
  assert.deepEqual(activities(raw({ "159": "Both", "83": "Unknown school" })), []);
});

test("quantity overrides are per request and merged categories are summed", () => {
  const result = activities(fixture("lor"), { quantities: { TOPS: 3, UNIFORM_TOPS: 2, SOCKS: 4 } });
  assert.deepEqual(result.find((row) => row.itemCode === "CHILDRENS_TOPS"), activity("CHILDRENS_TOPS", 5));
  assert.deepEqual(result.find((row) => row.itemCode === "CHILDRENS_SOCKS"), activity("CHILDRENS_SOCKS", 4));
  assert.ok(result.every((row) => row.quantity > 0 && Number.isInteger(row.quantity) && row.direction === "OUT"));
  for (const quantity of [undefined, null, 0, -1, 1.5, NaN, Infinity, "2", 2_147_483_648]) {
    assert.throws(() => activities(raw(), { quantities: { WIPES: quantity } }), /quantities/);
  }
  assert.throws(() => activities(raw(), { quantities: { TYPO: 2 } }), /quantities/);
  assert.throws(() => activities(raw(), { quantities: [] }), /configuration/);
  assert.throws(() => activities(raw(), null), /configuration/);
  assert.throws(() => activities(fixture("lor"), { quantities: { TOPS: 2_147_483_647 } }), /integer limit/);
});

test("every producible item code exists in the real IRS seed catalogue", () => {
  const source = readFileSync(new URL("../prisma/seed-data.ts", import.meta.url), "utf8");
  const catalogue = new Set([...source.matchAll(/code: "([A-Z_0-9]+)"/g)].map((match) => match[1]));
  assert.equal(catalogue.size, 35);
  const emitted = new Set();
  for (const formId of [lor, mor]) {
    for (const sex of ["Male", "Female"]) {
      for (const type of ["Adult", "Child/Baby"]) {
        for (const age of ["1 year", "6 years", "12 years"]) {
          for (const diapers of ["Diapers", "Pull Ups"]) {
            for (const school of ["Elementary School Bookbag & Supplies", "Middle/High School Bookbag & Supplies"]) {
              const values = { "17": sex, "158": age, "159": diapers, "83": school };
              for (const [id, male, female] of clothing) { values[id] = "Yes"; values[male] = type; values[female] = type; }
              Object.assign(values, { "117": "Yes", "119": type, "147": "Yes", "81": "Yes", "85": "Yes", "169": "Yes", "171": "Yes" });
              for (const row of activities(raw(values, formId))) {
                assert.ok(catalogue.has(row.itemCode), `Unknown seeded item code: ${row.itemCode}`);
                emitted.add(row.itemCode);
              }
            }
          }
        }
      }
    }
  }
  assert.equal(emitted.size, 29);
});

test("selected requests without classification reject without revealing answers", () => {
  assert.throws(() => activities(raw({ "88": "Yes" })), /clothing selection/);
  assert.throws(() => activities(raw({ "88": "Yes", "17": "Male", "90": "PRIVATE" })), (error) => {
    assert.equal(error.message.includes("PRIVATE"), false);
    return /adult or child\/baby/.test(error.message);
  });
  assert.throws(() => activities(raw({ "85": "Yes" })), /valid age/);
  assert.throws(() => activities(raw({ "85": "Yes", "158": "19 years" })), /valid age/);
});

test("only allowlisted answer payloads are read, and personal information never leaves the function", () => {
  for (const formId of [lor, mor]) {
    const data = raw({ "81": "Yes" }, formId, { ip: "PRIVATE-IP", username: "PRIVATE-USER" });
    for (const id of ["6", "7", "9", "47", "55", "157", "174", "175", "176", "178", "179", "181", "182"]) {
      data.answers[id] = { answer: "PRIVATE-ANSWER" };
    }
    data.answers["9999"] = { text: "Wipes", name: "wipes", answer: "Yes" };
    const result = normalize(formId, data);
    assert.deepEqual(activities(data), [activity("WIPES")]);
    assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
    assert.deepEqual(Object.keys(result.submission).sort(), ["jotformFormId", "jotformSubmissionId", "location", "sourceType", "submissionDate"]);
    assert.deepEqual(Object.keys(result.inventoryActivities[0]).sort(), ["direction", "itemCode", "quantity"]);
  }
  assert.deepEqual(activities(raw({}, lor, { answers: { "81": { text: "Yes", name: "Yes" } } })), []);
});

function deepFreeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

test("normalization is repeatable without mutating either input or quantity options", (t) => {
  const data = deepFreeze(fixture("lor"));
  const options = deepFreeze({ quantities: { TOPS: 3 } });
  const previous = JSON.stringify(data);
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected API request"); });
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    t.mock.method(console, method, () => { throw new Error("Unexpected logging"); });
  }
  assert.deepEqual(normalize(lor, data, options), normalize(lor, data, options));
  assert.equal(JSON.stringify(data), previous);
  assert.deepEqual(options, { quantities: { TOPS: 3 } });
});

test("validates form and submission identifiers as strings without precision loss", () => {
  const data = raw();
  assert.equal(normalize(` ${lor} `, data).submission.jotformFormId, lor);
  for (const id of ["", "unknown", "__proto__", "constructor", "241895593214161", 261498369429070]) {
    assert.throws(() => normalize(id, data), /Unsupported referral form/);
  }
  assert.throws(() => normalize(lor, raw({}, mor)), /matching form_id/);
  for (const id of [undefined, null, 123, "", "fake-id"]) {
    assert.throws(() => normalize(lor, { ...data, id }), /submission ID/);
  }
  for (const answers of [[], 42, "PRIVATE"]) {
    assert.throws(() => normalize(lor, { ...data, answers }), /answers must/);
  }
});

test("creation time takes precedence; update time is used only when creation is absent", () => {
  const date = (extra) => normalize(lor, raw({}, lor, extra)).submission.submissionDate.toISOString();
  assert.equal(date({ updated_at: "2027-01-01 00:00:00" }), "2026-07-01T16:00:00.000Z");
  assert.equal(date({ created_at: null, updated_at: "2026-01-01 00:00:00" }), "2026-01-01T05:00:00.000Z");
  assert.throws(() => date({ created_at: undefined, updated_at: undefined }), /timestamp/);
  assert.throws(() => date({ created_at: "bad", updated_at: "2026-01-01 00:00:00" }), /timestamp/);
});

test("New York dates respect DST, leap days, milliseconds and UTC year boundaries", () => {
  for (const [input, expected] of [
    ["2026-01-01 00:00:00", "2026-01-01T05:00:00.000Z"],
    ["2026-07-01 00:00:00", "2026-07-01T04:00:00.000Z"],
    ["2026-12-31 23:59:59.999", "2027-01-01T04:59:59.999Z"],
    ["2024-02-29 12:00:00.1", "2024-02-29T17:00:00.100Z"],
    ["2026-03-08 01:59:59", "2026-03-08T06:59:59.000Z"],
    ["2026-03-08 03:00:00", "2026-03-08T07:00:00.000Z"],
    ["2026-11-01 00:59:59", "2026-11-01T04:59:59.000Z"],
    ["2026-11-01 02:00:00", "2026-11-01T07:00:00.000Z"],
  ]) {
    assert.equal(normalize(lor, raw({}, lor, { created_at: input })).submission.submissionDate.toISOString(), expected);
  }
});

test("explicit timezone offsets disambiguate repeated hours and override account timezone", () => {
  for (const [input, expected] of [
    ["2026-11-01T01:30:00-04:00", "2026-11-01T05:30:00.000Z"],
    ["2026-11-01T01:30:00-05:00", "2026-11-01T06:30:00.000Z"],
    ["2026-07-01T12:00:00Z", "2026-07-01T12:00:00.000Z"],
    ["2026-07-01T12:00:00+05:30", "2026-07-01T06:30:00.000Z"],
  ]) {
    assert.equal(normalize(lor, raw({}, lor, { created_at: input })).submission.submissionDate.toISOString(), expected);
  }
});

test("invalid calendar dates and local DST gaps/overlaps reject instead of drifting", () => {
  for (const created_at of [
    "", "not-a-date", "2026-02-30 10:00:00", "2026-02-29 10:00:00", "2026-13-01 10:00:00",
    "2026-00-01 10:00:00", "2026-01-00 10:00:00", "2026-01-01 24:00:00", "2026-01-01 12:60:00",
    "2026-01-01T12:00:00+24:00", "2026-01-01T12:00:00+05:99", "2026-01-01T12:00:60Z",
    "2026-03-08 02:30:00", "2026-11-01 01:30:00",
  ]) {
    assert.throws(() => normalize(lor, raw({}, lor, { created_at })), /timestamp|America\/New_York/);
  }
});

test("host timezone does not change parsed account timestamps", () => {
  const loader = new URL("../scripts/lib/load-referral.mjs", import.meta.url).href;
  const source = `const {loadReferral}=await import(${JSON.stringify(loader)}); const {normalizeReferralSubmission:n}=await loadReferral(); process.stdout.write(n(${JSON.stringify(lor)},${JSON.stringify(raw())}).submission.submissionDate.toISOString());`;
  for (const TZ of ["UTC", "America/Los_Angeles", "Asia/Kolkata"]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "2026-07-01T16:00:00.000Z");
  }
});
