import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadJotform } from "../scripts/lib/load-jotform.mjs";
import { formatSubmissionSummary } from "../scripts/lib/jotform-summary.mjs";

const { fetchSubmissions } = await loadJotform();
const formId = "12345";
const testKey = "test-key-not-a-real-credential";
const envNames = ["JOTFORM_API_KEY", "JOTFORM_API_BASE_URL"];
let previousEnv;

beforeEach(() => {
  previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.JOTFORM_API_KEY = testKey;
  delete process.env.JOTFORM_API_BASE_URL;
});

afterEach(() => {
  for (const name of envNames) {
    if (previousEnv[name] === undefined) delete process.env[name];
    else process.env[name] = previousEnv[name];
  }
});

const submission = (id, created_at = "2026-01-02 12:00:00") => ({
  id, form_id: formId, created_at, answers: { sensitive: "PRIVATE ANSWER" },
});

function page(content, extra = {}) {
  return new Response(JSON.stringify({ responseCode: 200, content, ...extra }), {
    headers: { "Content-Type": "application/json" },
  });
}

function stubPages(t, pages) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url: new URL(url), options });
    assert.ok(pages.length > 0, "Unexpected extra page request");
    return pages.shift();
  });
  return requests;
}

test("returns [] for a successfully empty form", async (t) => {
  const requests = stubPages(t, [page([])]);
  assert.deepEqual(await fetchSubmissions(formId), []);
  assert.equal(requests.length, 1);
});

test("fetches full pages through a final empty page", async (t) => {
  const rows = ["1", "2", "3", "4"].map((id) => submission(id));
  const requests = stubPages(t, [page(rows.slice(0, 2)), page(rows.slice(2)), page([])]);
  assert.deepEqual(await fetchSubmissions(formId, { pageSize: 2 }), rows);
  assert.deepEqual(requests.map(({ url }) => url.searchParams.get("offset")), ["0", "2", "4"]);
  for (const { url, options } of requests) {
    assert.equal(url.pathname, `/form/${formId}/submissions`);
    assert.equal(url.searchParams.get("limit"), "2");
    assert.equal(url.searchParams.get("orderby"), "id");
    assert.equal(options.headers.APIKEY, testKey);
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(url.searchParams.has("apiKey"), false);
    assert.equal(url.href.includes(testKey), false);
  }
});

test("continues after short pages and ignores resultSet.count as a total", async (t) => {
  const requests = stubPages(t, [
    page([submission("1")], { resultSet: { count: 1 } }),
    page([submission("2")], { resultSet: { count: 1 } }), page([]),
  ]);
  assert.equal((await fetchSubmissions(formId)).length, 2);
  assert.deepEqual(requests.map(({ url }) => url.searchParams.get("offset")), ["0", "1", "2"]);
});

test("deduplicates overlapping pages by string ID", async (t) => {
  const largeId = "237955080346633702";
  stubPages(t, [page([submission(largeId), submission("2")]), page([submission("2"), submission("3")]), page([])]);
  assert.deepEqual((await fetchSubmissions(formId)).map(({ id }) => id), [largeId, "2", "3"]);
});

test("rejects repeated pages instead of looping forever", async (t) => {
  stubPages(t, [page([submission("1")]), page([submission("1")])]);
  await assert.rejects(fetchSubmissions(formId), /offset 1: Pagination made no progress/);
});

test("a later-page failure rejects the whole fetch", async (t) => {
  stubPages(t, [page([submission("1")]), new Response("PRIVATE ANSWER", { status: 503 })]);
  await assert.rejects(fetchSubmissions(formId), /offset 1: HTTP 503/);
});

for (const [status, hint] of [[401, /JOTFORM_API_KEY/], [403, /permission/], [404, /form ID/], [429, /limit/]]) {
  test(`explains HTTP ${status} without exposing the response body`, async (t) => {
    stubPages(t, [new Response(`${testKey}: PRIVATE ANSWER`, { status })]);
    await assert.rejects(fetchSubmissions(formId), (error) => {
      assert.match(error.message, hint);
      assert.equal(error.message.includes(testKey), false);
      assert.equal(error.message.includes("PRIVATE ANSWER"), false);
      return true;
    });
  });
}

test("checks Jotform responseCode even when HTTP succeeds", async (t) => {
  stubPages(t, [page([], { responseCode: 403, message: `${testKey}: PRIVATE ANSWER` })]);
  await assert.rejects(fetchSubmissions(formId), (error) => {
    assert.match(error.message, /API response code 403/);
    assert.equal(error.message.includes(testKey), false);
    assert.equal(error.message.includes("PRIVATE ANSWER"), false);
    return true;
  });
});

test("rejects malformed JSON", async (t) => {
  stubPages(t, [new Response("not JSON")]);
  await assert.rejects(fetchSubmissions(formId), /invalid JSON/);
});

test("rejects malformed response envelopes and non-array content", async (t) => {
  stubPages(t, [new Response("{}"), page({}), page(null)]);
  await assert.rejects(fetchSubmissions(formId), /invalid response envelope/);
  await assert.rejects(fetchSubmissions(formId), /non-array/);
  await assert.rejects(fetchSubmissions(formId), /non-array/);
});

test("rejects invalid submissions and submissions from a different form", async (t) => {
  stubPages(t, [page([null]), page([{ ...submission("1"), form_id: "999" }]), page([{ ...submission("1"), id: 1 }])]);
  for (let i = 0; i < 3; i++) {
    await assert.rejects(fetchSubmissions(formId), /invalid submission/);
  }
});

test("reports network failure without leaking an underlying error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error(`${testKey}: PRIVATE ANSWER`); });
  await assert.rejects(fetchSubmissions(formId), (error) => {
    assert.match(error.message, /Request failed/);
    assert.equal(error.message.includes(testKey), false);
    assert.equal(error.message.includes("PRIVATE ANSWER"), false);
    return true;
  });
});

function waitForAbort(signal) {
  return new Promise((resolve, reject) => {
    // Keep the event loop alive while AbortSignal.timeout's unref'ed timer runs.
    const timer = setTimeout(() => reject(new Error("Timeout signal did not fire")), 1_000);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

test("reports a request timeout", async (t) => {
  t.mock.method(globalThis, "fetch", (_url, { signal }) => waitForAbort(signal));
  await assert.rejects(fetchSubmissions(formId, { timeoutMs: 5 }), /timed out after 5 ms/);
});

test("also times out when reading the response body", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => ({
    ok: true, json: () => waitForAbort(signal),
  }));
  await assert.rejects(fetchSubmissions(formId, { timeoutMs: 5 }), /timed out after 5 ms/);
});

test("validates input and configuration before making requests", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("No request expected"); });
  for (const id of ["", "abc", "123/456", 123, null]) {
    await assert.rejects(fetchSubmissions(id), /numeric string/);
  }
  for (const pageSize of [0, 1001, 1.5]) {
    await assert.rejects(fetchSubmissions(formId, { pageSize }), /pageSize/);
  }
  for (const timeoutMs of [0, -1, NaN, Infinity]) {
    await assert.rejects(fetchSubmissions(formId, { timeoutMs }), /timeoutMs/);
  }
  delete process.env.JOTFORM_API_KEY;
  await assert.rejects(fetchSubmissions(formId), /Set JOTFORM_API_KEY/);
  process.env.JOTFORM_API_KEY = testKey;
  process.env.JOTFORM_API_BASE_URL = "https://example.com";
  await assert.rejects(fetchSubmissions(formId), /JOTFORM_API_BASE_URL/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("supports the documented EU and HIPAA API regions", async (t) => {
  const requests = stubPages(t, [page([]), page([])]);
  process.env.JOTFORM_API_BASE_URL = "https://eu-api.jotform.com/";
  await fetchSubmissions(` ${formId} `);
  process.env.JOTFORM_API_BASE_URL = "https://hipaa-api.jotform.com";
  await fetchSubmissions(formId);
  assert.deepEqual(requests.map(({ url }) => url.hostname), ["eu-api.jotform.com", "hipaa-api.jotform.com"]);
});

test("summary reports count and chronological range without printing answers", () => {
  assert.equal(formatSubmissionSummary([
    submission("1", "2026-11-02 13:00:00"), submission("2", "2025-12-31 23:59:59"),
  ]), "Submissions: 2\nDate range: 2025-12-31 23:59:59 to 2026-11-02 13:00:00");
});

test("summary handles empty and missing-date data", () => {
  assert.equal(formatSubmissionSummary([]), "Submissions: 0\nDate range: none");
  assert.equal(formatSubmissionSummary([submission("1", null)]), "Submissions: 1\nDate range: unavailable");
  assert.equal(formatSubmissionSummary([submission("1", "bad-date")]), "Submissions: 1\nDate range: unavailable");
});

test("CLI emits just the count and date range on success", () => {
  const script = fileURLToPath(new URL("../scripts/test-jotform.mjs", import.meta.url));
  const preloader = `let page = 0; globalThis.fetch = async () => new Response(JSON.stringify({responseCode:200,content:page++ === 0 ? [{id:'1',form_id:'${formId}',created_at:'2026-01-02 12:00:00',answers:{private:'PRIVATE ANSWER'}}] : []}));`;
  const result = spawnSync(process.execPath, ["--import", `data:text/javascript;base64,${Buffer.from(preloader).toString("base64")}`, script, formId], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, JOTFORM_API_KEY: testKey, JOTFORM_API_BASE_URL: "https://api.jotform.com" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "Submissions: 1\nDate range: 2026-01-02 12:00:00 to 2026-01-02 12:00:00\n");
});

test("CLI gives a nonzero exit status for missing arguments", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/test-jotform.mjs", import.meta.url))], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Usage:/);
});
