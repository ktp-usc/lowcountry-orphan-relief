import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, beforeEach, test } from "node:test";
import { loadImportModules } from "../scripts/lib/load-import-modules.mjs";
import { createImportDatabase } from "./helpers/import-database.mjs";

const modules = await loadImportModules();
after(() => modules.close());
const { importSubmissions } = modules.importer;
const { JOTFORM_FORMS: forms } = modules.forms;
const seedSource = readFileSync(new URL("../prisma/seed-data.ts", import.meta.url), "utf8");
const items = [...seedSource.matchAll(/code: "([A-Z0-9_]+)"/g)].map((match, index) => ({ id: index + 1, code: match[1] }));
const raw = (form, id, answer = form.sourceType === "INVENTORY" ? "3" : "Yes") => ({
  id: String(id), form_id: form.id, created_at: "2026-07-01 12:00:00",
  answers: { [form.sourceType === "INVENTORY" ? "51" : "81"]: { answer } },
});
const samples = () => new Map(forms.map((form, index) => [form.id, [raw(form, `90000000000000000${index}`)]]));
const fetchFrom = (data) => async (id) => data.get(id) ?? [];
const wipeId = items.find((item) => item.code === "WIPES").id;
let previousKey;
beforeEach(() => { previousKey = process.env.JOTFORM_API_KEY; process.env.JOTFORM_API_KEY = "fictional-test-key"; });
afterEach(() => { if (previousKey === undefined) delete process.env.JOTFORM_API_KEY; else process.env.JOTFORM_API_KEY = previousKey; });

test("configuration contains exactly the four approved form/location/source combinations", () => {
  assert.deepEqual(forms, [
    { id: "241895593214161", location: "LOWCOUNTRY", sourceType: "INVENTORY" },
    { id: "250054265404145", location: "MIDLANDS", sourceType: "INVENTORY" },
    { id: "261498369429070", location: "LOWCOUNTRY", sourceType: "REFERRAL" },
    { id: "261526295444158", location: "MIDLANDS", sourceType: "REFERRAL" },
  ]);
});

test("all four forms use real normalizers and the KAN-18 saver; second import is unchanged", async () => {
  const client = createImportDatabase(items), data = samples();
  const first = await importSubmissions(client, { limitPerForm: 1 }, { fetchSubmissions: fetchFrom(data) });
  assert.deepEqual(first, { saved: 4, skipped: 0, failed: 0, formErrors: [], submissionErrors: [] });
  const state = client.snapshot();
  for (const form of forms) {
    const source = state.sources.find((row) => row.jotformFormId === form.id);
    assert.equal(source.location, form.location);
    assert.equal(source.sourceType, form.sourceType);
    assert.equal(source.submissionDate.toISOString(), "2026-07-01T16:00:00.000Z");
    const movements = state.activities.filter((row) => row.jotformFormId === form.id);
    const expected = [{ itemId: wipeId, quantity: form.sourceType === "INVENTORY" ? 3 : 1,
      direction: form.sourceType === "INVENTORY" ? "IN" : "OUT", jotformFormId: form.id, jotformSubmissionId: source.jotformSubmissionId }];
    if (form.sourceType === "REFERRAL") {
      for (const code of ["BOOKS", "STUFFED_ANIMALS"]) expected.push({
        itemId: items.find((item) => item.code === code).id, quantity: 2, direction: "OUT",
        jotformFormId: form.id, jotformSubmissionId: source.jotformSubmissionId,
      });
    }
    assert.deepEqual(movements, expected);
  }
  const second = await importSubmissions(client, { limitPerForm: 1 }, { fetchSubmissions: fetchFrom(data) });
  assert.deepEqual(second, { saved: 0, skipped: 4, failed: 0, formErrors: [], submissionErrors: [] });
  assert.deepEqual(client.snapshot(), state);
});

test("negative inventory quantities import as OUT activities while positive quantities import as IN", async () => {
  const form = forms[0], client = createImportDatabase(items);
  const data = new Map([[form.id, [raw(form, "1001", "-2"), raw(form, "1002", "7")]]]);
  const summary = await importSubmissions(client, {}, { fetchSubmissions: fetchFrom(data) });
  assert.equal(summary.saved, 2); assert.equal(summary.failed, 0); assert.equal(summary.skipped, 0);
  assert.deepEqual(summary.submissionErrors, []);
  assert.deepEqual(client.snapshot().sources.map((row) => row.sourceType), ["INVENTORY", "INVENTORY"]);
  assert.deepEqual(client.snapshot().activities.map((row) => [row.quantity, row.direction]), [[2, "OUT"], [7, "IN"]]);
});

test("merged KAN-18 rejects object/array quantities and continues to a valid submission", async () => {
  const form = forms[1], client = createImportDatabase(items);
  const data = new Map([[form.id, [raw(form, "1101", ["2"]), raw(form, "1102", { value: 2 }), raw(form, "1103", "4")]]]);
  const summary = await importSubmissions(client, {}, { fetchSubmissions: fetchFrom(data) });
  assert.equal(summary.failed, 2); assert.equal(summary.saved, 1);
  assert.deepEqual(summary.submissionErrors.map((row) => row.submissionId), ["1101", "1102"]);
  assert.deepEqual(client.snapshot().sources.map((row) => row.jotformSubmissionId), ["1103"]);
  assert.deepEqual(client.snapshot().activities.map((row) => row.quantity), [4]);
});

test("a failed form is recorded separately and later forms still import", async () => {
  const data = samples(), client = createImportDatabase(items);
  const summary = await importSubmissions(client, {}, { fetchSubmissions: async (id) => {
    if (id === forms[0].id) throw new Error(`Jotform form ${id}, offset 0: HTTP 403. PRIVATE ANSWER`);
    return data.get(id);
  } });
  assert.equal(summary.saved, 3); assert.equal(summary.failed, 0);
  assert.deepEqual(summary.formErrors, [{ formId: forms[0].id, message: "Fetching failed at offset 0: Jotform returned status 403." }]);
  assert.deepEqual(summary.submissionErrors, []);
  assert.equal(client.snapshot().sources.length, 3);
});

test("a save failure persists nothing for that submission and later submissions continue", async () => {
  const form = forms[0], client = createImportDatabase(items.filter((item) => item.code !== "MENS_TOPS"));
  const invalid = raw(form, "2001"); invalid.answers["8"] = { answer: "2" };
  const data = new Map([[form.id, [invalid, raw(form, "2002")]]]);
  const summary = await importSubmissions(client, {}, { fetchSubmissions: fetchFrom(data) });
  assert.equal(summary.failed, 1); assert.equal(summary.saved, 1);
  assert.match(summary.submissionErrors[0].message, /missing from the catalogue: MENS_TOPS/);
  assert.deepEqual(client.snapshot().sources.map((row) => row.jotformSubmissionId), ["2002"]);
  assert.equal(client.snapshot().activities.length, 1);
});

test("equal IDs in different forms are separate source submissions", async () => {
  const client = createImportDatabase(items);
  const data = new Map(forms.map((form) => [form.id, [raw(form, "3001")]]));
  const summary = await importSubmissions(client, {}, { fetchSubmissions: fetchFrom(data) });
  assert.equal(summary.saved, 4); assert.equal(client.snapshot().sources.length, 4);
});

test("an empty activity list still imports a source once; empty forms do not fail", async () => {
  const client = createImportDatabase(items), form = forms[0];
  const data = new Map([[form.id, [raw(form, "4001", "0")]]]);
  assert.equal((await importSubmissions(client, {}, { fetchSubmissions: fetchFrom(data) })).saved, 1);
  assert.equal((await importSubmissions(client, {}, { fetchSubmissions: fetchFrom(data) })).skipped, 1);
  assert.equal(client.snapshot().activities.length, 0);
});

test("missing IDs and wrong-form submissions fail without blocking subsequent submissions", async () => {
  const form = forms[0], client = createImportDatabase(items);
  const badId = { ...raw(form, "5001"), id: undefined };
  const wrongForm = { ...raw(form, "5002"), form_id: forms[1].id };
  const data = new Map([[form.id, [badId, wrongForm, raw(form, "5003")]]]);
  const result = await importSubmissions(client, {}, { fetchSubmissions: fetchFrom(data) });
  assert.equal(result.failed, 2); assert.equal(result.saved, 1);
  assert.deepEqual(result.submissionErrors.map((row) => row.submissionId), ["unknown", "5002"]);
});

test("form configuration is checked against normalized metadata and directions before saving", async () => {
  const form = forms[0], data = new Map([[form.id, [raw(form, "6001")]]]);
  const valid = { submission: { jotformFormId: form.id, jotformSubmissionId: "6001", location: form.location,
    sourceType: "INVENTORY", submissionDate: new Date("2026-01-01T00:00:00Z") }, inventoryActivities: [] };
  for (const input of [
    { ...valid, submission: { ...valid.submission, location: "MIDLANDS" } },
    { ...valid, submission: { ...valid.submission, sourceType: "REFERRAL" } },
    { ...valid, submission: { ...valid.submission, jotformSubmissionId: "other" } },
    { ...valid, submission: { ...valid.submission, submissionDate: new Date(NaN) } },
    { ...valid, inventoryActivities: [{ itemCode: "WIPES", direction: "INVALID", quantity: 1 }] },
  ]) {
    const client = createImportDatabase(items);
    const result = await importSubmissions(client, {}, { fetchSubmissions: fetchFrom(data), normalizeInventory: () => input });
    assert.equal(result.failed, 1); assert.equal(client.snapshot().sources.length, 0);
  }
});

test("limit bounds fetching and attempts even when a supplied fetcher returns too many", async () => {
  const client = createImportDatabase(items), calls = [];
  const result = await importSubmissions(client, { limitPerForm: 1 }, { fetchSubmissions: async (id, options) => {
    calls.push({ id, options }); const form = forms.find((row) => row.id === id);
    return [raw(form, "7001"), raw(form, "7002")];
  } });
  assert.equal(result.saved, 4);
  assert.deepEqual(calls.map(({ id, options }) => ({ id, maxSubmissions: options.maxSubmissions })), forms.map((form) => ({ id: form.id, maxSubmissions: 1 })));
  assert.ok(calls.every(({ options }) => typeof options.onInvalidSubmission === "function"));
});

test("actual fetch path requests only two submissions per form and reruns skip all eight", async (t) => {
  const client = createImportDatabase(items), requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(url); requests.push(parsed);
    const form = forms.find((row) => parsed.pathname.includes(row.id));
    return new Response(JSON.stringify({ responseCode: 200, content: [raw(form, "8001"), raw(form, "8002"), raw(form, "8003")] }));
  });
  const first = await importSubmissions(client, { limitPerForm: 2 });
  const before = client.snapshot();
  const second = await importSubmissions(client, { limitPerForm: 2 });
  assert.equal(first.saved, 8); assert.equal(second.skipped, 8); assert.deepEqual(client.snapshot(), before);
  assert.equal(requests.length, 8);
  for (const request of requests) { assert.equal(request.searchParams.get("limit"), "2"); assert.equal(request.searchParams.get("offset"), "0"); }
});

test("production fetch path reports malformed entries individually and saves the following valid entry", async (t) => {
  const cases = [
    ["non-object", () => null, "unknown"],
    ["numeric ID", (row) => ({ ...row, id: 123 }), "unknown"],
    ["wrong form", (row) => ({ ...row, form_id: forms[1].id }), "8101"],
    ["created_at object", (row) => ({ ...row, created_at: { private: "PRIVATE ANSWER" } }), "8101"],
    ["updated_at array", (row) => ({ ...row, updated_at: ["PRIVATE ANSWER"] }), "8101"],
    ["answers array", (row) => ({ ...row, answers: [] }), "8101"],
    ["invalid string ID", (row) => ({ ...row, id: "PRIVATE-ID" }), "unknown"],
  ];
  for (const [name, malformed, expectedId] of cases) {
    await t.test(name, async (t) => {
      const form = forms[0], client = createImportDatabase(items), calls = [];
      t.mock.method(globalThis, "fetch", async (url) => {
        const parsed = new URL(url); calls.push(parsed);
        const content = parsed.pathname.includes(form.id) ? [malformed(raw(form, "8101")), raw(form, "8102", "6")] : [];
        return new Response(JSON.stringify({ responseCode: 200, content }));
      });
      const result = await importSubmissions(client, { limitPerForm: 2 });
      assert.deepEqual([result.saved, result.skipped, result.failed], [1, 0, 1]);
      assert.deepEqual(result.formErrors, []);
      assert.equal(result.submissionErrors[0].formId, form.id);
      assert.equal(result.submissionErrors[0].submissionId, expectedId);
      assert.match(result.submissionErrors[0].message, /^Fetch validation failed at record 1:/);
      assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
      assert.deepEqual(client.snapshot().sources.map((row) => row.jotformSubmissionId), ["8102"]);
      assert.deepEqual(client.snapshot().activities.map((row) => row.quantity), [6]);
      assert.equal(calls.filter((url) => url.pathname.includes(form.id)).length, 1);
    });
  }
});

test("production fetch path continues from an all-malformed page to a valid later page and later forms", async (t) => {
  const firstForm = forms[0], client = createImportDatabase(items), requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(url), form = forms.find((row) => parsed.pathname.includes(row.id));
    const offset = Number(parsed.searchParams.get("offset")); requests.push(parsed);
    let content;
    if (form.id === firstForm.id) {
      content = offset === 0 ? [{ ...raw(form, "8201"), created_at: 123 }] : [raw(form, "8202", "9")];
    } else content = offset === 0 ? [raw(form, "8203")] : [];
    return new Response(JSON.stringify({ responseCode: 200, content }));
  });
  const summary = await importSubmissions(client, { limitPerForm: 2 });
  assert.deepEqual([summary.saved, summary.failed, summary.skipped], [4, 1, 0]);
  assert.deepEqual(summary.formErrors, []);
  assert.equal(summary.submissionErrors[0].submissionId, "8201");
  assert.equal(client.snapshot().sources.length, 4);
  const firstRequests = requests.filter((url) => url.pathname.includes(firstForm.id));
  assert.deepEqual(firstRequests.map((url) => url.searchParams.get("offset")), ["0", "1"]);
  assert.deepEqual(firstRequests.map((url) => url.searchParams.get("limit")), ["2", "1"]);
});

test("production import stays within its limit when every sampled record is malformed", async (t) => {
  const form = forms[0], client = createImportDatabase(items), requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(url); requests.push(parsed);
    return new Response(JSON.stringify({ responseCode: 200, content: parsed.pathname.includes(form.id)
      ? [null, { ...raw(form, "8301"), created_at: false }, raw(form, "8302")] : [] }));
  });
  const result = await importSubmissions(client, { limitPerForm: 2 });
  assert.deepEqual([result.saved, result.failed], [0, 2]); assert.deepEqual(result.formErrors, []);
  assert.equal(client.snapshot().sources.length, 0);
  assert.equal(requests.filter((url) => url.pathname.includes(form.id)).length, 1);
  assert.deepEqual(result.submissionErrors.map((row) => row.submissionId), ["unknown", "8301"]);
});

test("production fetch classifies malformed timestamp strings per submission during normalization", async (t) => {
  const form = forms[0], client = createImportDatabase(items);
  t.mock.method(globalThis, "fetch", async (url) => new Response(JSON.stringify({ responseCode: 200,
    content: new URL(url).pathname.includes(form.id) ? [{ ...raw(form, "8401"), created_at: "not-a-date" }, raw(form, "8402")] : [],
  })));
  const result = await importSubmissions(client, { limitPerForm: 2 });
  assert.equal(result.saved, 1); assert.equal(result.failed, 1); assert.deepEqual(result.formErrors, []);
  assert.match(result.submissionErrors[0].message, /Normalization failed:.*timestamp/);
  assert.deepEqual(client.snapshot().sources.map((row) => row.jotformSubmissionId), ["8402"]);
});

test("HTTP failures remain form errors and other forms still import through the real fetcher", async (t) => {
  const client = createImportDatabase(items);
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(url), form = forms.find((row) => parsed.pathname.includes(row.id));
    if (form.id === forms[0].id) return new Response("PRIVATE BODY", { status: 503 });
    return new Response(JSON.stringify({ responseCode: 200, content: [raw(form, "8501")] }));
  });
  const result = await importSubmissions(client, { limitPerForm: 1 });
  assert.equal(result.saved, 3); assert.equal(result.failed, 0);
  assert.deepEqual(result.formErrors, [{ formId: forms[0].id, message: "Fetching failed at offset 0: Jotform returned status 503." }]);
  assert.deepEqual(result.submissionErrors, []);
  assert.equal(client.snapshot().sources.length, 3);
});

test("live sample replay retains malformed-entry errors, duplicate skips and correct known-ID queries", async (t) => {
  const form = forms[0], client = createImportDatabase(items), captured = new Map(), issues = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(url);
    const content = parsed.pathname.includes(form.id) ? [null, { ...raw(form, "8601"), created_at: {} }, raw(form, "8602")] : [];
    return new Response(JSON.stringify({ responseCode: 200, content }));
  });
  const first = await importSubmissions(client, { limitPerForm: 3 }, { fetchSubmissions: async (id, options) => {
    const rows = await modules.fetcher.fetchSubmissions(id, { ...options, onInvalidSubmission: (issue) => {
      issues.push(issue); options.onInvalidSubmission(issue);
    } });
    captured.set(id, rows); return rows;
  } });
  const before = storedRows(client);
  t.mock.method(globalThis, "fetch", () => assert.fail("Replay made an API request"));
  const second = await importSubmissions(client, { limitPerForm: 3 }, { fetchSubmissions: modules.checker.replayCapturedSample(captured, issues) });
  assert.deepEqual([first.saved, first.failed, second.skipped, second.failed], [1, 2, 1, 2]);
  assert.deepEqual(second.submissionErrors, first.submissionErrors);
  assert.deepEqual(client.snapshot().sources.map((row) => row.jotformSubmissionId), ["8602"]);
  assert.deepEqual(modules.checker.capturedSampleKeys(captured, issues).map((row) => row.jotformSubmissionId).sort(), ["8601", "8602"]);
  assert.deepEqual(modules.checker.verifyCapturedRows(captured, first, second, before, storedRows(client), issues), {
    verifiedSubmissions: 1, rejectedSubmissions: 2, repeatUnchanged: true,
  });
});

test("wrong-form entries do not suppress valid same-ID entries or corrupt live verification", async (t) => {
  const form = forms[0], client = createImportDatabase(items), captured = new Map(), issues = [];
  t.mock.method(globalThis, "fetch", async (url) => new Response(JSON.stringify({ responseCode: 200,
    content: new URL(url).pathname.includes(form.id) ? [{ ...raw(form, "8701"), form_id: forms[1].id }, raw(form, "8701")] : [],
  })));
  const first = await importSubmissions(client, { limitPerForm: 2 }, { fetchSubmissions: async (id, options) => {
    const rows = await modules.fetcher.fetchSubmissions(id, { ...options, onInvalidSubmission: (issue) => {
      issues.push(issue); options.onInvalidSubmission(issue);
    } });
    captured.set(id, rows); return rows;
  } });
  const before = storedRows(client);
  const second = await importSubmissions(client, { limitPerForm: 2 }, { fetchSubmissions: modules.checker.replayCapturedSample(captured, issues) });
  assert.equal(first.saved, 1); assert.equal(first.failed, 1); assert.equal(second.skipped, 1);
  assert.deepEqual(modules.checker.verifyCapturedRows(captured, first, second, before, storedRows(client), issues), {
    verifiedSubmissions: 1, rejectedSubmissions: 1, repeatUnchanged: true,
  });
  assert.equal(modules.checker.capturedSampleKeys(captured, issues).length, 1);
});

test("private answers, credentials and raw database messages are not reported or logged", async (t) => {
  for (const method of ["log", "warn", "error", "info"]) t.mock.method(console, method, () => assert.fail("Unexpected log"));
  const data = samples(), client = createImportDatabase(items);
  data.get(forms[0].id)[0].answers["51"].answer = "PRIVATE-ANSWER";
  const result = await importSubmissions(client, {}, { fetchSubmissions: async (id) => {
    if (id === forms[1].id) throw new Error("PRIVATE-KEY postgresql://PRIVATE-PASSWORD@host/db");
    return data.get(id);
  }, saveSubmission: async () => { throw new Error("PRIVATE-ANSWER in Prisma query"); } });
  assert.equal(result.failed, 3); assert.equal(result.formErrors.length, 1);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});

test("invalid limits reject before any form is fetched", async () => {
  for (const limitPerForm of [0, -1, 1.5, NaN, Infinity, "2", null, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(importSubmissions(createImportDatabase(items), { limitPerForm }, { fetchSubmissions: () => assert.fail("Unexpected fetch") }), /positive safe integer/);
  }
});

test("seeded randomized mixed batches preserve totals, persistence and duplicate behavior (seed 0x18c021)", async (t) => {
  let seed = 0x18c021, submissionsChecked = 0;
  const random = (max) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let iteration = 0; iteration < 200; iteration++) {
    const data = new Map(), validKeys = new Set();
    let saved = 0, skipped = 0, failed = 0;
    for (const form of forms) {
      const rows = [];
      for (let n = 0, count = random(5); n < count; n++) {
        const id = String(9000 + random(4)), invalid = random(4) === 0;
        const row = raw(form, id, form.sourceType === "INVENTORY" ? String(1 + random(20)) : "Yes");
        if (invalid) {
          if (form.sourceType === "INVENTORY") row.answers["51"].answer = "1.5";
          else row.answers["88"] = { answer: "Yes" };
          failed++;
        } else {
          const key = `${form.id}/${id}`;
          if (validKeys.has(key)) skipped++; else { saved++; validKeys.add(key); }
        }
        rows.push(row); submissionsChecked++;
      }
      data.set(form.id, rows);
    }
    const client = createImportDatabase(items);
    const first = await importSubmissions(client, {}, { fetchSubmissions: fetchFrom(data) });
    assert.deepEqual([first.saved, first.skipped, first.failed], [saved, skipped, failed], `iteration ${iteration}`);
    const before = client.snapshot();
    assert.equal(before.sources.length, validKeys.size);
    const second = await importSubmissions(client, {}, { fetchSubmissions: fetchFrom(data) });
    assert.deepEqual([second.saved, second.skipped, second.failed], [0, saved + skipped, failed]);
    assert.deepEqual(client.snapshot(), before);
  }
  t.diagnostic(`200 batches, ${submissionsChecked} submissions, each imported twice; seed 0x18c021.`);
});

test("manual command requires an explicit limit or all; live checks cap the sample", () => {
  const { parseImportArgs } = modules.args;
  assert.deepEqual(parseImportArgs(["--limit", "2"]), { help: false, limitPerForm: 2 });
  assert.deepEqual(parseImportArgs(["--all"]), { help: false });
  assert.deepEqual(parseImportArgs(["--help"]), { help: true });
  for (const args of [[], ["--limit", "0"], ["--limit", "1.2"], ["--all", "--limit", "2"], ["--unknown"]]) assert.throws(() => parseImportArgs(args));
  assert.throws(() => parseImportArgs(["--limit", "6"], true), /between 1 and 5/);
  assert.throws(() => parseImportArgs(["--all"], true), /Usage/);
});

test("CLI prints both error lists and totals, returns failure status, and disconnects", async () => {
  let disconnected = 0; const lines = [];
  const summary = { saved: 2, skipped: 1, failed: 1,
    formErrors: [{ formId: forms[1].id, message: "Fetching failed." }],
    submissionErrors: [{ formId: forms[0].id, submissionId: "1", message: "Saving failed." }] };
  const status = await modules.cli.runImportCli(["--limit", "2"], {
    createClient: async () => ({ $disconnect: async () => { disconnected++; } }),
    runImport: async (_client, options) => { assert.equal(options.limitPerForm, 2); return summary; },
    print: (line) => lines.push(line),
  });
  assert.equal(status, 1); assert.equal(disconnected, 1); assert.deepEqual(JSON.parse(lines[0]), summary);
});

test("CLI returns zero for a clean import and disconnects after an unexpected failure", async () => {
  let disconnected = 0;
  const hooks = { createClient: async () => ({ $disconnect: async () => { disconnected++; } }), print: () => {} };
  assert.equal(await modules.cli.runImportCli(["--limit", "1"], { ...hooks, runImport: async () => ({ saved: 1, skipped: 0, failed: 0, formErrors: [], submissionErrors: [] }) }), 0);
  await assert.rejects(modules.cli.runImportCli(["--limit", "1"], { ...hooks, runImport: async () => { throw new Error("failure"); } }), /failure/);
  assert.equal(disconnected, 2);
  assert.equal(await modules.cli.runImportCli(["--help"], { createClient: () => assert.fail("Help opened DB"), print: () => {} }), 0);
});

test("live checker module loads and help needs neither API nor database access", async (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  t.mock.method(globalThis, "fetch", () => assert.fail("Help made an API request"));
  await modules.checker.checkJotformImport(["--help"]);
  assert.match(lines[0], /check:jotform:import/);
});

test("quantity diagnostics distinguish numeric problems without returning the submitted values", () => {
  const form = forms[1];
  const cases = [
    ["-12", "negative"], ["1,234", "comma-grouped-integer"], ["1 234", "space-grouped-integer"],
    ["1.25", "fractional"], ["PRIVATE-ANSWER", "non-numeric-or-non-finite"],
    [true, "unsupported-answer-type"], [{ private: "PRIVATE-ANSWER" }, "unsupported-answer-type"],
    ["2147483648", "outside-database-integer-range"], [undefined, "missing"], ["", "empty"], ["0", "zero"],
  ];
  const rows = cases.map(([value], index) => {
    const row = raw(form, String(20000 + index), value);
    row.answers["51"].answer = value;
    row.answers["51"].type = "control_number";
    return row;
  });
  const errors = rows.map((row) => ({ formId: form.id, submissionId: row.id,
    message: "Normalization failed: invalid quantity in field 51; expected a positive whole number or zero to omit." }));
  const diagnostics = modules.diagnostics.collectImportDiagnostics(new Map([[form.id, rows]]), errors);
  assert.deepEqual(diagnostics.map((row) => row.quantityCategory), cases.map(([, category]) => category));
  assert.ok(diagnostics.every((row) => row.field.questionType === "control_number"));
  for (const diagnostic of diagnostics) {
    assert.equal("answer" in diagnostic, false); assert.equal("value" in diagnostic.field, false);
  }
  assert.equal(JSON.stringify(diagnostics).includes("PRIVATE"), false);
});

test("clothing diagnostics reveal missing/unsupported selections without exposing personal attributes", () => {
  const form = forms[3], data = raw(form, "30001");
  data.answers["88"] = { type: "control_radio", answer: "Yes" };
  data.answers["17"] = { type: "control_radio", answer: "PRIVATE-ANSWER" };
  data.answers["90"] = { type: "control_radio", answer: "Adult" };
  const errors = [{ formId: form.id, submissionId: data.id,
    message: "Normalization failed: missing clothing classification for field 88." }];
  const [diagnostic] = modules.diagnostics.collectImportDiagnostics(new Map([[form.id, [data]]]), errors);
  assert.equal(diagnostic.kind, "referral-classification");
  assert.deepEqual(diagnostic.classificationFields.map(({ fieldId, hasAnswer, recognizedChoice }) => ({ fieldId, hasAnswer, recognizedChoice })), [
    { fieldId: "17", hasAnswer: true, recognizedChoice: false },
    { fieldId: "90", hasAnswer: true, recognizedChoice: true },
    { fieldId: "93", hasAnswer: false, recognizedChoice: false },
  ]);
  for (const value of ["PRIVATE-ANSWER", "Adult", "Male", "Female"]) assert.equal(JSON.stringify(diagnostic).includes(value), false);
  data.answers["17"].answer = "Female";
  const [withRecognizedSelection] = modules.diagnostics.collectImportDiagnostics(new Map([[form.id, [data]]]), errors);
  assert.equal(withRecognizedSelection.classificationFields[0].recognizedChoice, true);
});

test("shared classification diagnostics identify the requested item and its selector fields", async () => {
  const form = forms[3];
  for (const [requestId, expectedTypes] of [
    ["147", ["141", "142"]], ["169", ["90", "93"]], ["171", ["104", "105"]],
  ]) {
    const data = raw(form, `3000${requestId}`);
    data.answers[requestId] = { type: "control_radio", answer: "Yes" };
    data.answers["17"] = { type: "control_radio", answer: "Female" };
    const result = await importSubmissions(createImportDatabase(items), {}, {
      fetchSubmissions: fetchFrom(new Map([[form.id, [data]]])),
    });
    assert.equal(result.failed, 1);
    assert.match(result.submissionErrors[0].message, new RegExp(`field ${requestId}`));
    const [diagnostic] = modules.diagnostics.collectImportDiagnostics(new Map([[form.id, [data]]]), result.submissionErrors);
    assert.equal(diagnostic.kind, "referral-classification");
    assert.deepEqual(diagnostic.classificationFields.map(({ fieldId }) => fieldId), ["17", ...expectedTypes]);
    assert.equal(modules.diagnostics.isConfirmedSourceIssue(data, result.submissionErrors[0]), true);
  }
});

test("diagnostics handle uncaptured failures and unknown stages safely", () => {
  const data = samples();
  const errors = [
    { formId: forms[0].id, submissionId: "missing", message: "PRIVATE-ANSWER" },
    { formId: forms[0].id, submissionId: data.get(forms[0].id)[0].id, message: "PRIVATE-ANSWER" },
  ];
  const diagnostics = modules.diagnostics.collectImportDiagnostics(data, errors);
  assert.deepEqual(diagnostics.map((row) => row.kind), ["not-captured", "other-import-error"]);
  assert.equal(JSON.stringify(diagnostics).includes("PRIVATE"), false);
});

function storedRows(client) {
  const state = client.snapshot();
  return state.sources.map((source) => ({ ...source, inventoryActivities: state.activities
    .filter((row) => row.jotformFormId === source.jotformFormId && row.jotformSubmissionId === source.jotformSubmissionId)
    .map((row) => ({ ...row, item: { code: items.find((item) => item.id === row.itemId).code } })) }));
}

async function partialSample() {
  const data = new Map(forms.map((form, index) => [form.id, [raw(form, `4000${index}1`), raw(form, `4000${index}2`)]]));
  data.get(forms[1].id)[0].answers["124"] = { type: "control_number", answer: "1.5" };
  data.get(forms[1].id)[1].answers["70"] = { type: "control_number", answer: "2.5" };
  data.get(forms[3].id)[0].answers["88"] = { type: "control_radio", answer: "Yes" };
  data.get(forms[3].id)[0].answers["17"] = { type: "control_radio", answer: "Female" };
  const client = createImportDatabase(items);
  const first = await importSubmissions(client, { limitPerForm: 2 }, { fetchSubmissions: fetchFrom(data) });
  const before = storedRows(client);
  const second = await importSubmissions(client, { limitPerForm: 2 }, { fetchSubmissions: fetchFrom(data) });
  return { data, first, second, before, after: storedRows(client) };
}

test("live verification checks five saved rows and three rejected rows", async () => {
  const sample = await partialSample();
  assert.deepEqual([sample.first.saved, sample.first.failed, sample.second.skipped], [5, 3, 5]);
  assert.deepEqual(modules.checker.verifyCapturedRows(sample.data, sample.first, sample.second, sample.before, sample.after), {
    verifiedSubmissions: 5, rejectedSubmissions: 3, repeatUnchanged: true,
  });
  assert.deepEqual(modules.diagnostics.collectImportDiagnostics(sample.data, sample.first.submissionErrors).map((row) => row.kind),
    ["inventory-quantity", "inventory-quantity", "referral-classification"]);
});

test("live verification detects wrong persisted quantities, rejected source rows and repeat changes", async () => {
  const sample = await partialSample();
  const corrupted = structuredClone(sample.after);
  corrupted[0].inventoryActivities[0].quantity = 999;
  assert.throws(() => modules.checker.verifyCapturedRows(sample.data, sample.first, sample.second, corrupted, corrupted));
  const withRejected = [...sample.after, { ...sample.after[0], jotformFormId: forms[1].id,
    jotformSubmissionId: sample.data.get(forms[1].id)[0].id, inventoryActivities: [] }];
  assert.throws(() => modules.checker.verifyCapturedRows(sample.data, sample.first, sample.second, withRejected, withRejected));
  assert.throws(() => modules.checker.verifyCapturedRows(sample.data, sample.first, sample.second, sample.before, corrupted), /repeat import changed/);
});

test("live verification still accepts an entirely successful repeated sample", async () => {
  const client = createImportDatabase(items), data = samples();
  const first = await importSubmissions(client, {}, { fetchSubmissions: fetchFrom(data) });
  const before = storedRows(client);
  const second = await importSubmissions(client, {}, { fetchSubmissions: fetchFrom(data) });
  assert.deepEqual(modules.checker.verifyCapturedRows(data, first, second, before, storedRows(client)), {
    verifiedSubmissions: 4, rejectedSubmissions: 0, repeatUnchanged: true,
  });
  assert.deepEqual(modules.checker.assessSampleOutcome(data, first, storedRows(client)), {
    status: "passed", verifiedSubmissions: 4, rejectedSubmissions: 0, sourceReviewRequired: false,
  });
});

test("live check accepts verified source rejections while preserving failed totals and review status", async () => {
  const sample = await partialSample();
  const verified = modules.checker.verifyCapturedRows(sample.data, sample.first, sample.second, sample.before, sample.after);
  assert.equal(verified.verifiedSubmissions, 5); assert.equal(verified.rejectedSubmissions, 3);
  assert.deepEqual(modules.checker.assessSampleOutcome(sample.data, sample.first, sample.after), {
    status: "passed-with-source-data-issues", verifiedSubmissions: 5, rejectedSubmissions: 3, sourceReviewRequired: true,
  });
  assert.equal(sample.first.failed, 3); assert.equal(sample.first.submissionErrors.length, 3);
});

test("known source issue classification verifies the actual field and required active selection", () => {
  const { isConfirmedSourceIssue: confirmed } = modules.diagnostics;
  const inventory = raw(forms[1], "50001");
  const quantityError = { formId: inventory.form_id, submissionId: inventory.id,
    message: "Normalization failed: invalid quantity in field 124; expected a positive whole number or zero to omit." };
  inventory.answers["124"] = { type: "control_number", answer: "-2" };
  assert.equal(confirmed(inventory, quantityError), false);
  inventory.answers["124"].answer = "1.5"; assert.equal(confirmed(inventory, quantityError), true);
  for (const value of ["2", "0", "", "1,234", "PRIVATE-ANSWER", true, ["-2"]]) {
    inventory.answers["124"].answer = value; assert.equal(confirmed(inventory, quantityError), false);
  }
  inventory.answers["124"] = { type: "control_textbox", answer: "-2" };
  assert.equal(confirmed(inventory, quantityError), false);

  const referral = raw(forms[3], "50002");
  referral.answers["88"] = { type: "control_radio", answer: "Yes" };
  referral.answers["17"] = { type: "control_radio", answer: "Female" };
  const clothingError = { formId: referral.form_id, submissionId: referral.id,
    message: "Normalization failed: missing clothing classification for field 88." };
  assert.equal(confirmed(referral, clothingError), true);
  referral.answers["90"] = { answer: "Adult" }; // Inactive branch does not complete the selected branch.
  assert.equal(confirmed(referral, clothingError), true);
  referral.answers["93"] = { answer: "Child/Baby" };
  assert.equal(confirmed(referral, clothingError), false);
  referral.answers["93"].answer = "unexpected-option";
  assert.equal(confirmed(referral, clothingError), false);
  delete referral.answers["17"];
  assert.equal(confirmed(referral, clothingError), true);
  referral.answers["88"].answer = "No";
  assert.equal(confirmed(referral, clothingError), false);
  assert.equal(confirmed(inventory, { ...quantityError, submissionId: "different" }), false);
});

test("live check still fails unexpected normalization/save errors and failed forms", async () => {
  const sample = await partialSample();
  for (const message of [
    "Saving failed: item codes are missing from the catalogue: WIPES.",
    "Saving failed: database error P1001; the submission was not imported.",
    "Normalization failed: the submission could not be converted to inventory activities.",
  ]) {
    const summary = structuredClone(sample.first); summary.submissionErrors[0].message = message;
    assert.throws(() => modules.checker.assessSampleOutcome(sample.data, summary, sample.after), /Unexpected import failures/);
  }
  const summary = structuredClone(sample.first);
  summary.formErrors.push({ formId: forms[0].id, message: "Fetching failed." });
  assert.throws(() => modules.checker.assessSampleOutcome(sample.data, summary, sample.after), /could not be fetched/);
});

test("live check cannot pass without real saves for both source kinds and all four forms sampled", async () => {
  const sample = await partialSample();
  assert.throws(() => modules.checker.assessSampleOutcome(sample.data, sample.first, []), /successfully persisted/);
  const inventoryOnly = sample.after.filter((row) => row.sourceType === "INVENTORY");
  const summary = { ...sample.first, saved: inventoryOnly.length, skipped: 0 };
  assert.throws(() => modules.checker.assessSampleOutcome(sample.data, summary, inventoryOnly), /persisted REFERRAL/);
  const missingForm = new Map(sample.data); missingForm.set(forms[1].id, []);
  assert.throws(() => modules.checker.assessSampleOutcome(missingForm, sample.first, sample.after), /No real sample/);
});
