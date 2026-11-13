import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { NextRequest } from "next/server.js";
import { proxy } from "../proxy.ts";
import { belongsToBucket, configuredSheetJob, SHEET_SYNC_BUCKET_COUNTS } from "../lib/sheets/cron-config.ts";
import { createSheetCronHandler } from "../lib/sheets/cron-handler.ts";
import { unchangedSubmissionResult } from "../lib/inventory/sync-submission.ts";
import { loadExistingSubmissions } from "../lib/sheets/load-existing.ts";
import { requestJson } from "../lib/sheets/errors.ts";

const summary = (overrides = {}) => ({ created: 0, updated: 0, unchanged: 10, cancelled: 1, failed: 0,
  sourceErrors: [], rowErrors: [], ...overrides });
const request = (token = "test-secret") => new Request("https://example.test/api/cron/sync-sheets/lor-inventory/0", {
  headers: { authorization: `Bearer ${token}` },
});
function harness(overrides = {}) {
  const completions = [], acquisitions = [], options = [];
  const handler = createSheetCronHandler({
    secret: () => "test-secret",
    enabled: () => "true",
    store: {
      acquire: async (job) => { acquisitions.push(job); return true; },
      finish: async (job, completion) => { completions.push({ job, completion }); return true; },
    },
    sync: async (value) => { options.push(value); return summary(); },
    ...overrides,
  });
  return { handler, completions, acquisitions, options };
}

test("partition counts assign every exact ID once, including future rows and repartitioning", () => {
  const ids = ["0", "0001", "9007199254740992", "9007199254740993", "99999999999999999999999999999999999999999999999",
    ...Array.from({ length: 500 }, (_, i) => (10n ** 30n + BigInt(i)).toString())];
  for (const count of [1, 2, 3, 7, 16, 24]) {
    for (const id of ids) {
      const buckets = Array.from({ length: count }, (_, index) => index).filter((index) => belongsToBucket(id, { index, count }));
      assert.deepEqual(buckets, [Number(BigInt(id) % BigInt(count))]);
    }
  }
  assert.equal(belongsToBucket("9007199254740992", { index: 0, count: 2 }), true);
  assert.equal(belongsToBucket("9007199254740993", { index: 1, count: 2 }), true);
});

test("every configured bucket has exactly one daily schedule, staggered across hours", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const expected = Object.entries(SHEET_SYNC_BUCKET_COUNTS).flatMap(([key, count]) =>
    Array.from({ length: count }, (_, index) => `/api/cron/sync-sheets/${key}/${index}`));
  assert.deepEqual(config.crons.map(({ path }) => path).sort(), expected.sort());
  assert.equal(new Set(config.crons.map(({ path }) => path)).size, expected.length);
  const hours = new Set();
  for (const { path, schedule } of config.crons) {
    assert.match(schedule, /^0 (?:[0-9]|1[0-9]|2[0-3]) \* \* \*$/);
    hours.add(schedule.split(" ")[1]);
    const [, , , , sourceKey, bucket] = path.split("/");
    assert.ok(configuredSheetJob(sourceKey, bucket));
  }
  assert.equal(hours.size, config.crons.length);
});

test("missing and invalid secrets cannot acquire a lease or start syncing", async () => {
  for (const secret of [undefined, "", "   ", "test-secret"]) {
    const h = harness({ secret: () => secret });
    const result = await h.handler(request("wrong"), "lor-inventory", "0");
    assert.equal(result.status, secret?.trim() ? 401 : 503);
    assert.deepEqual(h.acquisitions, []);
    assert.deepEqual(h.options, []);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
});

test("invalid source and bucket parameters cannot start work", async () => {
  for (const [key, bucket] of [["unknown", "0"], ["toString", "0"], ["lor-inventory", "1"],
    ["lor-inventory", "-1"], ["lor-inventory", "00"], ["lor-inventory", "1e0"], ["lor-inventory", "9007199254740993"]]) {
    const h = harness();
    assert.equal((await h.handler(request(), key, bucket)).status, 404);
    assert.equal(h.acquisitions.length, 0);
  }
});

test("successful handler awaits reconciliation and owned completion before responding", async () => {
  const h = harness({ now: (() => { let n = 0; return () => n++ * 1000; })() });
  const response = await h.handler(request(), "lor-inventory", "0");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.elapsedMs, 1000);
  assert.equal(body.processedRows, 11);
  assert.deepEqual(h.options, [{ sourceKey: "lor-inventory", bucket: { index: 0, count: 1 }, deadlineMs: 270000 }]);
  assert.equal(h.completions[0].completion.success, true);
  assert.equal(h.completions[0].job.owner, h.acquisitions[0].owner);
});

test("overlapping requests return 409 without syncing or releasing the other lease", async () => {
  const h = harness({ store: { acquire: async () => false, finish: () => assert.fail("Must not release another owner's lease") } });
  assert.equal((await h.handler(request(), "lor-inventory", "0")).status, 409);
  assert.equal(h.options.length, 0);
});

test("partial row failures and source failures are unsuccessful persisted attempts", async () => {
  for (const result of [summary({ failed: 1 }), summary({ sourceErrors: [{ sourceKey: "lor-inventory", message: "read failure" }] })]) {
    const h = harness({ sync: async () => result });
    const response = await h.handler(request(), "lor-inventory", "0");
    assert.equal(response.status, 500);
    assert.equal(h.completions[0].completion.success, false);
    assert.deepEqual((await response.json()).summary, result);
  }
});

test("unexpected failures are persisted without exposing raw errors", async () => {
  const h = harness({ sync: async () => { throw new Error("PRIVATE CREDENTIAL"); } });
  const response = await h.handler(request(), "lor-inventory", "0");
  assert.equal(response.status, 500);
  assert.equal(h.completions[0].completion.success, false);
  assert.equal(JSON.stringify(h.completions).includes("PRIVATE"), false);
  assert.equal((await response.text()).includes("PRIVATE"), false);
});

test("lost leases and unavailable database cannot produce success", async () => {
  for (const store of [
    { acquire: async () => true, finish: async () => false },
    { acquire: async () => { throw new Error("PRIVATE"); }, finish: () => assert.fail() },
    { acquire: async () => true, finish: async () => { throw new Error("PRIVATE"); } },
  ]) {
    const response = await harness({ store }).handler(request(), "lor-inventory", "0");
    assert.equal(response.status, 500);
    assert.equal((await response.text()).includes("PRIVATE"), false);
  }
});

test("slow runs warn and deadline overruns cannot record successful completion", async () => {
  for (const duration of [180000, 270000]) {
    const warnings = [];
    let calls = 0;
    const h = harness({ now: () => calls++ ? duration : 0, warn: (message) => warnings.push(message) });
    const response = await h.handler(request(), "lor-inventory", "0");
    assert.equal(response.status, duration < 270000 ? 200 : 500);
    assert.match(warnings[0], /CAPACITY WARNING/);
    assert.equal(h.completions[0].completion.success, duration < 270000);
  }
});

test("proxy permits cron bearer auth while protecting other APIs and dashboard", () => {
  assert.equal(proxy(new NextRequest("https://example.test/api/cron/sync-sheets/lor-inventory/0")).headers.get("x-middleware-next"), "1");
  assert.equal(proxy(new NextRequest("https://example.test/api/inventory")).status, 401);
  assert.equal(proxy(new NextRequest("https://example.test/api/cron/other")).status, 401);
  assert.equal(proxy(new NextRequest("https://example.test/")).status, 307);
});

test("fast comparison validates input and preserves activity direction, multiplicity, metadata", () => {
  const record = { kind: "active", input: { submission: { jotformFormId: "1", jotformSubmissionId: "2", location: "LOWCOUNTRY",
    sourceType: "INVENTORY", submissionDate: new Date("2026-01-01T00:00:00Z") },
    inventoryActivities: [{ itemCode: " TOPS ", quantity: 2, direction: "IN" }] } };
  const existing = { ...record.input.submission, id: 1, inventoryActivities: [{ item: { code: "TOPS" }, quantity: 2, direction: "IN" }] };
  assert.deepEqual(unchangedSubmissionResult(record, existing), { status: "unchanged" });
  assert.equal(unchangedSubmissionResult(record, { ...existing, submissionDate: new Date("2026-01-02T00:00:00Z") }), undefined);
  assert.equal(unchangedSubmissionResult(record, { ...existing, inventoryActivities: [...existing.inventoryActivities, ...existing.inventoryActivities] }), undefined);
  existing.inventoryActivities[0].direction = "OUT";
  assert.equal(unchangedSubmissionResult(record, existing), undefined);
  record.input.inventoryActivities[0].quantity = 0;
  assert.throws(() => unchangedSubmissionResult(record, existing), /Invalid quantity/);
});

test("batch loader scopes exact IDs to a single form and includes activity values", async () => {
  const rows = [{ jotformSubmissionId: "9007199254740993", inventoryActivities: [] }];
  const map = await loadExistingSubmissions({ sourceSubmission: { findMany: async (args) => {
    assert.deepEqual(args.where, { jotformFormId: "form", jotformSubmissionId: { in: ["9007199254740993"] } });
    assert.equal(args.select.inventoryActivities.select.item.select.code, true);
    return rows;
  } } }, { jotformFormId: "form" }, ["9007199254740993"]);
  assert.equal(map.get("9007199254740993"), rows[0]);
  await assert.rejects(loadExistingSubmissions({}, {}, []), /unavailable/);
});

test("Sheets rate-limit retries are bounded and honor short Retry-After values", async () => {
  let calls = 0;
  const sleeps = [];
  const result = await requestJson(async () => ++calls === 1
    ? new Response("PRIVATE", { status: 429, headers: { "retry-after": "2" } })
    : Response.json({ ok: true }), "https://example.test", {}, "Google Sheets read", { sleep: async (ms) => sleeps.push(ms) });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(sleeps, [2000]);
  calls = 0;
  await assert.rejects(requestJson(async () => { calls++; return new Response("PRIVATE", { status: 429 }); }, "https://example.test", {}, "Google Sheets read",
    { sleep: async () => {}, random: () => 0 }), /HTTP 429/);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(requestJson(async () => { calls++; return new Response("PRIVATE", { status: 429, headers: { "retry-after": "120" } }); }, "https://example.test", {}, "Google Sheets read"), /HTTP 429/);
  assert.equal(calls, 1);
});

test("capacity warning fires during a slow invocation before reconciliation completes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let clock = 0, finishSync;
  const warnings = [];
  const h = harness({ now: () => clock, warn: (message) => warnings.push(message),
    sync: () => new Promise((resolve) => { finishSync = resolve; }) });
  const responsePromise = h.handler(request(), "lor-inventory", "0");
  await Promise.resolve();
  clock = 180000;
  t.mock.timers.tick(180000);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /CAPACITY WARNING/);
  finishSync(summary());
  assert.equal((await responsePromise).status, 200);
  assert.equal(warnings.length, 1);
});

test("scheduled execution defaults off and accepts only the exact string true", async () => {
  for (const value of [undefined, null, "", "false", "FALSE", "True", "TRUE", "1", "yes", " true", "true ", "true\n", true, 1]) {
    const h = harness({
      enabled: () => value,
      now: () => assert.fail("Disabled requests must not start timing a sync"),
      store: {
        acquire: () => assert.fail("Disabled requests must not acquire or write leases"),
        finish: () => assert.fail("Disabled requests must not write completion records"),
      },
      sync: () => assert.fail("Disabled requests must not read Sheets or sync"),
    });
    const response = await h.handler(request(), "lor-inventory", "0");
    assert.equal(response.status, 503, `Flag value ${JSON.stringify(value)} must remain disabled`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { status: "disabled", code: "SHEETS_CRON_DISABLED", message: "Scheduled Sheets syncing is disabled." });
    assert.equal(h.completions.length, 0);
  }
  const unwired = harness({ enabled: undefined });
  assert.equal((await unwired.handler(request(), "lor-inventory", "0")).status, 503);
  assert.equal(unwired.acquisitions.length, 0);
  const enabled = harness({ enabled: () => "true" });
  assert.equal((await enabled.handler(request(), "lor-inventory", "0")).status, 200);
  assert.equal(enabled.acquisitions.length, 1);
  assert.equal(enabled.completions[0].completion.success, true);
});

test("cron authentication remains enforced while scheduled execution is disabled", async () => {
  const h = harness({ enabled: () => "false" });
  for (const input of [request("wrong"), new Request("https://example.test")]) {
    const response = await h.handler(input, "lor-inventory", "0");
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  }
  const missingSecret = harness({ enabled: () => "false", secret: () => undefined });
  assert.equal((await missingSecret.handler(request(), "lor-inventory", "0")).status, 503);
  assert.equal(h.acquisitions.length, 0);
  assert.equal(h.options.length, 0);
});

test("actual disabled HTTP route needs no database credentials and performs no network requests", async (t) => {
  const keys = ["SHEETS_CRON_ENABLED", "CRON_SECRET", "DATABASE_URL", "DIRECT_URL"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.mock.method(globalThis, "fetch", () => assert.fail("Disabled HTTP route must not make network requests"));
  try {
    process.env.CRON_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    delete process.env.DIRECT_URL;
    const route = await import("../app/api/cron/sync-sheets/[sourceKey]/[bucket]/route.ts");
    assert.equal(route.runtime, "nodejs");
    assert.equal(route.maxDuration, 300);
    for (const value of [undefined, "false", "TRUE", "true "]) {
      if (value === undefined) delete process.env.SHEETS_CRON_ENABLED;
      else process.env.SHEETS_CRON_ENABLED = value;
      const response = await route.GET(request(), { params: Promise.resolve({ sourceKey: "lor-inventory", bucket: "0" }) });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).status, "disabled");
    }
    assert.equal((await route.GET(request("wrong"), { params: Promise.resolve({ sourceKey: "lor-inventory", bucket: "0" }) })).status, 401);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
