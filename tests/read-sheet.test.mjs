import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, verify } from "node:crypto";
import { loadSheets } from "../scripts/lib/load-sheets.mjs";

const modules = await loadSheets();
after(modules.close);
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/sheets/sample-responses.json", import.meta.url), "utf8")).sources;
const savedEnvironment = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
beforeEach(() => { process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "FICTIONAL_CREDENTIAL_JSON"; });
after(() => { if (savedEnvironment === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = savedEnvironment; });
const text = (value) => ({ userEnteredValue: { stringValue: value }, effectiveValue: { stringValue: value }, formattedValue: value });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const copy = (value) => structuredClone(value);

function addMappedHeaders(data) {
  const mapping = modules.mappings.SHEET_MAPPINGS.find(({ key }) => key === data.source.key);
  const headerRow = data.headerResponse.sheets[0].data[0].rowData[0];
  const existingHeaders = new Set(headerRow.values.map((cell) => cell.effectiveValue?.stringValue).filter(Boolean));
  const missingHeaders = Object.values(mapping.answerHeaders).filter((header) => !existingHeaders.has(header));
  const missingPrivateHeaders = ["Name", "Email", "Notes"].filter((header) => !existingHeaders.has(header));
  const appendedHeaders = [...missingHeaders, ...missingPrivateHeaders];
  headerRow.values.push(...appendedHeaders.map(text));
  data.headerResponse.sheets[0].properties.gridProperties.columnCount += appendedHeaders.length;
  const dataGrid = data.dataResponse.sheets[0].data[0];
  dataGrid.rowData = dataGrid.rowData.map((row) => ({ ...row, values: [...(row.values ?? []), ...appendedHeaders.map(() => text(""))] }));
  data.dataResponse.sheets[0].properties.gridProperties.columnCount += appendedHeaders.length;
  return data;
}

function filterResponse(data, filters, header) {
  const result = copy(header ? data.headerResponse : data.dataResponse);
  const sourceGrid = result.sheets[0].data[0];
  if (!sourceGrid) return result;
  const sourceStartRow = sourceGrid.startRow ?? 0;
  const sourceStartColumn = sourceGrid.startColumn ?? 0;
  const sourceEndColumn = sourceStartColumn + Math.max(0, ...sourceGrid.rowData.map((row) => row?.values?.length ?? 0));
  result.sheets[0].data = filters.map((filter) => {
    const startColumn = Math.max(filter.startColumnIndex ?? 0, sourceStartColumn);
    const endColumn = Math.min(filter.endColumnIndex ?? Infinity, sourceEndColumn);
    const startRow = filter.startRowIndex === 0 && sourceGrid.startRow !== undefined ? sourceGrid.startRow : filter.startRowIndex;
    const rowStart = Math.max(0, filter.startRowIndex - sourceStartRow);
    const rowEnd = Math.max(rowStart, filter.endRowIndex - sourceStartRow);
    const sourceRows = filter.startRowIndex === 0 && sourceGrid.startRow !== undefined
      ? sourceGrid.rowData.slice(0, 1)
      : sourceGrid.rowData.slice(rowStart, rowEnd);
    return {
      startRow,
      startColumn,
      rowData: sourceRows.map((row) => row && ({
        ...row,
        values: row.values?.slice(startColumn - sourceStartColumn, endColumn - sourceStartColumn),
      })),
    };
  });
  return result;
}

function harness(fixture = fixtures[0], change = () => {}, overrides = {}) {
  const data = addMappedHeaders(copy(fixture)), requests = [];
  change(data);
  const request = async (url, init) => {
    const parsed = new URL(url), body = JSON.parse(init.body), filters = body.dataFilters.map(({ gridRange }) => gridRange), range = filters[0];
    requests.push({ url: parsed, init, range, filters });
    assert.equal(parsed.origin, "https://sheets.googleapis.com");
    assert.ok(filters.every((filter) => filter.sheetId === data.source.tabId));
    assert.equal(init.headers.Authorization, "Bearer FICTIONAL_TOKEN");
    assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    const result = filterResponse(data, filters, range.startRowIndex === 0);
    // Returning an unrelated first tab must never change which tab is read.
    result.sheets.unshift({ properties: { sheetId: 9999, gridProperties: { rowCount: 1, columnCount: 1 } }, data: [] });
    return response(result);
  };
  const read = modules.reader.createSheetReader({ request, getAccessToken: async (json) => {
    assert.equal(json, "FICTIONAL_CREDENTIAL_JSON"); return "FICTIONAL_TOKEN";
  }, cancellationYellow: "#ffff00", ...overrides });
  return { data, requests, read: (options) => read(data.source, options), reader: read };
}

test("the four client-note sheet and tab IDs, form mappings, date headers and cancellation color are configured", () => {
  assert.equal(modules.sources.SHEET_SOURCES.length, 4);
  const expected = [
    ["1wBOD_fPH7oei5zEfktdFt_-OCZGgsO9eqWCjmbMh-2E", 1993480790],
    ["1dGDtxcFvryt0zE-6K9pVI0ZXCYQOwu-RALePOvATrF0", 51238458],
    ["1su1FCelCAoNnf5auudF_SmU30wLesNFIrmK7dZ-itIg", 1761833122],
    ["16UsDpGbgJTIOXB9czKf03tMnIohDIeoIrLFXc4lGLns", 493112246],
  ];
  for (const [index, source] of modules.sources.SHEET_SOURCES.entries()) {
    const fixtureSource = fixtures[index].source;
    for (const field of ["key", "jotformFormId", "location", "sourceType"]) assert.equal(source[field], fixtureSource[field]);
    assert.equal(source.spreadsheetId, expected[index][0]);
    assert.equal(source.tabId, expected[index][1]);
    assert.equal(source.submissionDateHeader, "Submission Date");
  }
  assert.equal(modules.sources.REFERRAL_CANCELLATION_YELLOW, "#ffff00");
});

for (const fixture of fixtures) {
  test(`${fixture.source.key}: reads the explicit tab, exact text IDs and strings, including cancelled rows`, async () => {
    const h = harness(fixture), result = await h.read();
    assert.equal(result.sourceKey, fixture.source.key);
    assert.deepEqual(result.rows.map((row) => row.rowNumber), [2, 4]);
    assert.ok(result.rows[0].values[fixture.source.submissionIdHeader].startsWith("0067"));
    assert.ok(result.rows.every((row) => Object.values(row.values).every((value) => typeof value === "string")));
    const mapping = modules.mappings.SHEET_MAPPINGS.find(({ key }) => key === fixture.source.key);
    const requiredHeaders = new Set(["Submission ID", "Submission Date", ...Object.values(mapping.answerHeaders)]);
    assert.deepEqual(new Set(Object.keys(result.rows[0].values)), requiredHeaders);
    for (const header of ["Fictional private field", "Name", "Email", "Notes"]) {
      assert.equal(Object.hasOwn(result.rows[0].values, header), false);
    }
    assert.equal(Object.hasOwn(result.rows[0].values, "Male Shoes Type"), mapping.sourceType === "REFERRAL");
    assert.equal(Object.hasOwn(result.rows[0].values, "Female Shoes Type"), mapping.sourceType === "REFERRAL");
    assert.deepEqual(result.rows.map((row) => row.cancelled), fixture.source.sourceType === "REFERRAL" ? [false, true] : [false, false]);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[0].range.startRowIndex, 0); assert.equal(h.requests[0].range.endRowIndex, 1);
    const requestedHeaders = h.requests[1].filters.flatMap((filter) => {
      const headers = h.data.headerResponse.sheets[0].data[0].rowData[0].values;
      return headers.slice(filter.startColumnIndex, filter.endColumnIndex).map((cell) => cell.effectiveValue.stringValue);
    });
    assert.deepEqual(new Set(requestedHeaders), requiredHeaders);
    for (const header of ["Fictional private field", "Name", "Email", "Notes"]) {
      assert.equal(requestedHeaders.includes(header), false);
    }
    if (fixture.source.sourceType === "INVENTORY") {
      assert.equal(result.rows[0].values["Pull-Ups"], "");
      assert.equal(result.rows[0].values.Wipes, "3");
      assert.equal(result.rows[0].values["Men's Tops"], "");
      assert.equal(result.rows[0].values.Diapers, "0");
    }
  });
}

test("MOR referral uses Submission Date and does not substitute the unlabeled first column", async () => {
  const h = harness(fixtures[3]), result = await h.read();
  assert.equal(result.rows[0].values["Submission Date"], "11/10/2026");
  assert.equal(Object.hasOwn(result.rows[0].values, ""), false);
  assert.equal(JSON.stringify(result).includes("UNLABELED_TIMESTAMP"), false);
});

test("preserves actual header spelling, whitespace and internal blank-cell positions", async () => {
  const h = harness(fixtures[0], (d) => { d.headerResponse.sheets[0].data[0].rowData[0].values[6] = text(" Submission ID "); });
  const result = await h.read();
  assert.equal(result.rows[0].values[" Submission ID "], fixtures[0].dataResponse.sheets[0].data[0].rowData[0].values[6].effectiveValue.stringValue);
  assert.equal(result.rows[0].values["Pull-Ups"], ""); assert.equal(result.rows[0].values.Wipes, "3");
});

test("limits physical data rows excluding the header; empty rows do not cause replacement reads", async () => {
  const h = harness(), result = await h.read({ limit: 2 });
  assert.deepEqual(result.rows.map((row) => row.rowNumber), [2]);
  assert.deepEqual(h.requests.map((request) => [request.range.startRowIndex, request.range.endRowIndex]), [[0, 1], [1, 3]]);
});

test("blank and formatting-only rows are skipped, including yellow cells without a value", async () => {
  const h = harness(fixtures[2], (d) => {
    d.dataResponse.sheets[0].data[0].rowData[1] = { values: [{ effectiveFormat: { backgroundColor: { red: 1, green: 1 } } }] };
  });
  assert.deepEqual((await h.read()).rows.map((row) => row.rowNumber), [2, 4]);
});

for (const name of ["Submission ID", "Submission Date"]) {
  test(`missing required ${name} header fails clearly before reading data`, async () => {
    const h = harness(fixtures[0], (d) => {
      const row = d.headerResponse.sheets[0].data[0].rowData[0];
      row.values = row.values.map((cell) => cell.effectiveValue?.stringValue === name ? {} : cell);
    });
    await assert.rejects(h.read(), new RegExp(`Missing required header: ${name}`));
    assert.equal(h.requests.length, 1);
  });
  test(`ambiguous required ${name} headers are not silently overwritten`, async () => {
    const h = harness(fixtures[0], (d) => { d.headerResponse.sheets[0].data[0].rowData[0].values[4] = text(` ${name.toLowerCase()} `); });
    await assert.rejects(h.read(), /Ambiguous duplicate header/);
  });
}

test("missing MOR Submission Date fails even when its unlabeled first column contains timestamps", async () => {
  const h = harness(fixtures[3], (d) => {
    const headers = d.headerResponse.sheets[0].data[0].rowData[0].values;
    const index = headers.findIndex((cell) => cell.effectiveValue?.stringValue === "Submission Date");
    headers[index] = {};
  });
  await assert.rejects(h.read(), /Missing required header: Submission Date/);
});

test("other duplicate headers fail instead of silently losing one of their values", async () => {
  const h = harness(fixtures[0], (d) => { d.headerResponse.sheets[0].data[0].rowData[0].values[4] = text("Wipes"); });
  await assert.rejects(h.read(), /Ambiguous duplicate header/);
});

for (const [name, cell] of [
  ["unsafe numeric", { userEnteredValue: { numberValue: 6700000000000000001 }, effectiveValue: { numberValue: 6700000000000000001 }, formattedValue: "6700000000000000000" }],
  ["safe numeric", { userEnteredValue: { numberValue: 123 }, effectiveValue: { numberValue: 123 }, formattedValue: "123" }],
  ["scientific text", text("6.7E+18")], ["comma-formatted text", text("6,700,000,000,000,000,001")],
  ["whitespace", text(" 6700000000000000001 ")], ["missing", {}],
  ["formula text", { userEnteredValue: { formulaValue: '=TEXT(A2,"0")' }, effectiveValue: { stringValue: "6700000000000000000" } }],
  ["inconsistent values", { userEnteredValue: { stringValue: "6700000000000000001" }, effectiveValue: { stringValue: "6700000000000000000" } }],
]) {
  test(`rejects ${name} submission IDs without printing their values`, async () => {
    const h = harness(fixtures[0], (d) => { d.dataResponse.sheets[0].data[0].rowData[0].values[6] = cell; });
    await assert.rejects(h.read(), (error) => {
      assert.match(error.message, /Submission ID at row 2 must be exact plain text digits/);
      assert.equal(error.message.includes("670000"), false); return true;
    });
  });
}

test("exact text IDs win over misleading display formatting", async () => {
  const h = harness(fixtures[0], (d) => { d.dataResponse.sheets[0].data[0].rowData[0].values[6].formattedValue = "6.7E+18"; });
  assert.equal((await h.read()).rows[0].values["Submission ID"], fixtures[0].dataResponse.sheets[0].data[0].rowData[0].values[6].userEnteredValue.stringValue);
});

test("duplicate IDs keep the first row and warn about later rows", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));

  const h = harness(fixtures[2], (d) => {
    const rows = d.dataResponse.sheets[0].data[0].rowData;
    rows[2].values[6] = {
      ...copy(rows[0].values[6]),
      effectiveFormat: {
        backgroundColor: { red: 1, green: 1 },
      },
    };
  });

  const result = await h.read();

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].rowNumber, 2);
  assert.equal(result.rows[0].cancelled, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /kept row 2, skipped row 4/);
});

test("cancellation checks the Submission ID cell only, not a yellow adjacent answer", async () => {
  const h = harness(fixtures[2], (d) => { d.dataResponse.sheets[0].data[0].rowData[0].values[1].effectiveFormat = { backgroundColor: { red: 1, green: 1 } }; });
  assert.equal((await h.read()).rows[0].cancelled, false);
});

test("inventory rows are never cancellations even if their ID cell is yellow", async () => {
  const h = harness(fixtures[0], (d) => { d.dataResponse.sheets[0].data[0].rowData[0].values[6].effectiveFormat = { backgroundColor: { red: 1, green: 1 } }; });
  assert.equal((await h.read()).rows[0].cancelled, false);
});

test("effective color style takes precedence over legacy fill; near-yellow is not guessed", async () => {
  const h = harness(fixtures[2], (d) => { d.dataResponse.sheets[0].data[0].rowData[2].values[6].effectiveFormat = { backgroundColor: { red: 1, green: 1 }, backgroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 0.8 } } }; });
  assert.equal((await h.read()).rows[1].cancelled, false);
});

test("resolves theme-based effective fills and legacy RGB colors", async () => {
  for (const style of [{ backgroundColor: { red: 1, green: 1 } }, { backgroundColorStyle: { themeColor: "ACCENT1" } }]) {
    const h = harness(fixtures[2], (d) => {
      d.dataResponse.properties = { spreadsheetTheme: { themeColors: [{ colorType: "ACCENT1", color: { rgbColor: { red: 1, green: 1 } } }] } };
      d.dataResponse.sheets[0].data[0].rowData[2].values[6].effectiveFormat = style;
    });
    assert.equal((await h.read()).rows[1].cancelled, true);
  }
});

test("unknown theme colors fail instead of quietly treating a possible cancellation as active", async () => {
  const h = harness(fixtures[2], (d) => { d.dataResponse.sheets[0].data[0].rowData[2].values[6].effectiveFormat = { backgroundColorStyle: { themeColor: "ACCENT2" } }; });
  await assert.rejects(h.read(), /Cannot resolve the Submission ID background color at row 4/);
});

test("invalid source metadata and missing cancellation color stop before a network request", async () => {
  const h = harness();
  await assert.rejects(h.reader({ ...fixtures[0].source, tabId: -1 }), /verified tabId/);
  await assert.rejects(h.reader({ ...fixtures[0].source, submissionDateHeader: "" }), /verified submission ID and date headers/);
  const referral = harness(fixtures[2], undefined, { cancellationYellow: null });
  await assert.rejects(referral.read(), /Verify and configure the cancellation color/);
  assert.equal(h.requests.length, 0); assert.equal(referral.requests.length, 0);
});

test("invalid limits and malformed source configuration fail before authentication", async () => {
  const h = harness(undefined, undefined, { getAccessToken: () => assert.fail("Unexpected authentication") });
  for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2"]) await assert.rejects(h.read({ limit }), /limit must/);
  for (const source of [{ ...fixtures[0].source, spreadsheetId: "https://PRIVATE" }, { ...fixtures[0].source, jotformFormId: 123 }]) await assert.rejects(h.reader(source), /Invalid SheetSource/);
  assert.equal(h.requests.length, 0);
});

test("header-only and entirely empty sheets return no data or a clear missing-header error", async () => {
  const h = harness(fixtures[0], (d) => { d.headerResponse.sheets[0].properties.gridProperties.rowCount = 1; });
  assert.deepEqual((await h.read()).rows, []); assert.equal(h.requests.length, 1);
  const empty = harness(fixtures[0], (d) => { d.headerResponse.sheets[0].data = []; });
  await assert.rejects(empty.read(), /Missing required header/);
});
test("duplicates across pages keep the first row and warn", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));

  const h = harness(fixtures[0], (d) => {
    d.headerResponse.sheets[0].properties.gridProperties.rowCount = 503;
    d.dataResponse.sheets[0].properties.gridProperties.rowCount = 503;

    const blank = Array.from({ length: 502 }, () => ({}));
    const first = copy(d.dataResponse.sheets[0].data[0].rowData[0]);
    blank[0] = first;
    blank[501] = copy(first);
    d.dataResponse.sheets[0].data[0].rowData = blank;
  });

  const result = await h.read();

  assert.deepEqual(result.rows.map((row) => row.rowNumber), [2]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /kept row 2, skipped row 503/);
  assert.deepEqual(
      h.requests.map((r) => [
        r.range.startRowIndex,
        r.range.endRowIndex,
      ]),
      [[0, 1], [1, 501], [501, 503]],
  );
});

test("empty middle pages do not hide later data", async () => {
  const h = harness(fixtures[0], (d) => {
    d.headerResponse.sheets[0].properties.gridProperties.rowCount = 503;
    d.dataResponse.sheets[0].properties.gridProperties.rowCount = 503;
    const valid = copy(d.dataResponse.sheets[0].data[0].rowData[0]);
    d.dataResponse.sheets[0].data[0].rowData = [...Array.from({ length: 501 }, () => ({})), valid];
  });
  assert.deepEqual((await h.read()).rows.map((row) => row.rowNumber), [503]);
});

test("honors GridData startColumn when leading blank columns are omitted", async () => {
  const h = harness(fixtures[3], (d) => {
    for (const body of [d.headerResponse, d.dataResponse]) {
      const grid = body.sheets[0].data[0]; grid.startColumn = 1;
      grid.rowData = grid.rowData.map((row) => row.values ? { values: row.values.slice(1) } : row);
    }
  });
  assert.equal((await h.read()).rows[0].values["Submission Date"], "11/10/2026");
});

test("cell errors expose only row/column metadata", async () => {
  const h = harness(fixtures[0], (d) => { d.dataResponse.sheets[0].data[0].rowData[0].values[1] = { effectiveValue: { errorValue: { message: "PRIVATE PERSONAL ANSWER" } } }; });
  await assert.rejects(h.read(), (error) => { assert.match(error.message, /Cell error at row 2, column 2/); assert.equal(error.message.includes("PRIVATE"), false); return true; });
});

test("wrong tabs, malformed grids and mid-read dimension changes fail clearly", async () => {
  for (const change of [
    (d) => { d.headerResponse.sheets[0].properties.sheetId = 9998; },
    (d) => { d.headerResponse.sheets[0].data[0].startRow = 1; },
    (d) => { d.dataResponse.sheets[0].data[0].rowData = [null]; },
    (d) => { d.dataResponse.sheets[0].properties.gridProperties.rowCount = 7; },
  ]) {
    const h = harness(fixtures[0], change);
    await assert.rejects(h.read(), /configured tabId|invalid or misaligned grid|dimensions changed/);
  }
});

test("Google failures report status/timeouts without response bodies or credentials", async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const h = harness(undefined, undefined, { request: async () => response({ private: "PRIVATE ANSWER CREDENTIAL" }, status) });
    await assert.rejects(h.read(), (error) => { assert.match(error.message, new RegExp(`HTTP ${status}`)); assert.equal(error.message.includes("PRIVATE"), false); return true; });
  }
  const h = harness(undefined, undefined, { request: async () => { throw new Error("PRIVATE credential network error"); } });
  await assert.rejects(h.read(), /Google Sheets read: request failed\./);
  const bad = harness(undefined, undefined, { request: async () => new Response("PRIVATE invalid JSON") });
  await assert.rejects(bad.read(), /invalid JSON response/);
});

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credential = (extra = {}) => JSON.stringify({ type: "service_account", client_email: "fictional@project.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "https://oauth2.googleapis.com/token", ...extra });

test("real auth path signs a valid configured-scope JWT and caches the Google access token", async () => {
  const requests = [];
  const provider = modules.auth.createTokenProvider(async (url, init) => {
    requests.push({ url, init });
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
    const params = new URLSearchParams(init.body), assertion = params.get("assertion"), [header, payload, signature] = assertion.split(".");
    assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    assert.equal(claims.scope, "https://www.googleapis.com/auth/spreadsheets");
    assert.equal(claims.aud, url); assert.equal(claims.exp - claims.iat, 3600); assert.equal(claims.sub, undefined);
    assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
    return response({ access_token: "FICTIONAL_TOKEN", token_type: "Bearer", expires_in: 3600 });
  });
  assert.deepEqual(await Promise.all([provider(credential()), provider(credential())]), ["FICTIONAL_TOKEN", "FICTIONAL_TOKEN"]);
  assert.equal(await provider(credential()), "FICTIONAL_TOKEN"); assert.equal(requests.length, 1);
});

test("credentials are validated before requests, including the fixed Google token endpoint", async () => {
  const provider = modules.auth.createTokenProvider(() => assert.fail("Unexpected request"));
  for (const json of ["", "PRIVATE invalid JSON", "null", "{}", credential({ type: "authorized_user" }), credential({ private_key: "PRIVATE BAD KEY" }), credential({ token_uri: "https://PRIVATE.invalid" })]) {
    await assert.rejects(provider(json), (error) => { assert.match(error.message, /GOOGLE_SERVICE_ACCOUNT_JSON/); assert.equal(error.message.includes("PRIVATE"), false); return true; });
  }
});

test("expired/changed credentials refresh tokens and failed authentication can be retried", async () => {
  let count = 0;
  const provider = modules.auth.createTokenProvider(async () => {
    count++; if (count === 1) return response({ private: "PRIVATE ANSWER" }, 403);
    return response({ access_token: `FICTIONAL_TOKEN_${count}`, token_type: "Bearer", expires_in: 30 });
  });
  await assert.rejects(provider(credential()), /Google authentication: HTTP 403/);
  assert.equal(await provider(credential()), "FICTIONAL_TOKEN_2");
  assert.equal(await provider(credential()), "FICTIONAL_TOKEN_3");
  assert.equal(await provider(credential({ client_email: "other@project.iam.gserviceaccount.com" })), "FICTIONAL_TOKEN_4");
});

test("invalid access-token responses are rejected without exposing their content", async () => {
  for (const body of [{}, { access_token: "PRIVATE TOKEN", token_type: "Bearer", expires_in: 3600 }, { access_token: "FICTIONAL", token_type: "Basic", expires_in: 3600 }, { access_token: "FICTIONAL", token_type: "Bearer", expires_in: -1 }]) {
    const provider = modules.auth.createTokenProvider(async () => response(body));
    await assert.rejects(provider(credential()), /invalid access-token response/);
  }
});

test("public readSheet uses env credentials, the real auth flow and a shared token for inventory sources", async (t) => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = credential();
  const samples = fixtures.slice(0, 2).map((fixture) => addMappedHeaders(copy(fixture)));
  let tokenRequests = 0, gridRequests = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const parsed = new URL(url);
    if (parsed.hostname === "oauth2.googleapis.com") {
      tokenRequests++;
      return response({ access_token: "PUBLIC_PATH_FICTIONAL_TOKEN", token_type: "Bearer", expires_in: 3600 });
    }
    gridRequests++;
    assert.equal(parsed.hostname, "sheets.googleapis.com");
    assert.equal(init.headers.Authorization, "Bearer PUBLIC_PATH_FICTIONAL_TOKEN");
    const filters = JSON.parse(init.body).dataFilters.map(({ gridRange }) => gridRange);
    const range = filters[0];
    const fixture = samples.find((f) => f.source.tabId === range.sheetId);
    const body = filterResponse(fixture, filters, range.startRowIndex === 0);
    return response(body);
  });
  for (const fixture of fixtures.slice(0, 2)) {
    const result = await modules.reader.readSheet(fixture.source, { limit: 2 });
    assert.equal(result.rows.length, 1); assert.equal(result.rows[0].rowNumber, 2);
  }
  assert.equal(tokenRequests, 1); assert.equal(gridRequests, 4);
});

test("request and body timeouts are reported safely", async (t) => {
  t.mock.method(AbortSignal, "timeout", () => { const c = new AbortController(); c.abort(); return c.signal; });
  for (const request of [
    async () => { throw new Error("PRIVATE credentials"); },
    async () => ({ ok: true, json: async () => { throw new Error("PRIVATE response body"); } }),
  ]) {
    const h = harness(undefined, undefined, { request });
    await assert.rejects(h.read(), /^SheetReadError: Google Sheets read: request timed out\.$/);
  }
});

test("reader never prints returned answers, tokens or credential material", async (t) => {
  for (const method of ["log", "warn", "error", "info", "debug"]) t.mock.method(console, method, () => assert.fail("Unexpected console output"));
  const result = await harness().read();
  assert.equal(Object.hasOwn(result.rows[0].values, "Fictional private field"), false);
  assert.equal(JSON.stringify(result).includes("PRIVATE_FICTIONAL_ANSWER"), false);
  await assert.rejects(harness(undefined, undefined, { request: async () => response({ secret: "PRIVATE_FICTIONAL_ANSWER" }, 403) }).read(), /HTTP 403/);
});

test("CLI prints only source keys and counts, continues after failed sources, and needs no DB/Jotform", async () => {
  const out = [], errors = [], calls = [];
  const status = await modules.cli.runSheetInspection(["--limit", "2"], {
    sources: fixtures.map((f) => f.source), loadEnvironment: async () => {}, print: (line) => out.push(line), printError: (line) => errors.push(line),
    read: async (source, options) => {
      calls.push({ source, options });
      if (source.key === "mor-inventory") throw new Error("PRIVATE raw database answer credential");
      return { sourceKey: source.key, rows: [{ rowNumber: 2, values: { private: "PRIVATE ANSWER" }, cancelled: false }, { rowNumber: 3, values: {}, cancelled: true }] };
    },
  });
  assert.equal(status, 1); assert.equal(calls.length, 4); assert.ok(calls.every(({ options }) => options.limit === 2));
  assert.equal(out.length, 3); assert.deepEqual(JSON.parse(out[0]), { source: "lor-inventory", active: 1, cancelled: 1 });
  assert.deepEqual(errors, ["mor-inventory: Unexpected source read failure."]);
  assert.equal(JSON.stringify([...out, ...errors]).includes("PRIVATE"), false);
});

test("CLI help and invalid arguments require no credentials, database or network", async () => {
  const out = [], overrides = { loadEnvironment: () => assert.fail("Unexpected env read"), read: () => assert.fail("Unexpected source read"), print: (line) => out.push(line), printError: (line) => out.push(line) };
  assert.equal(await modules.cli.runSheetInspection(["--help"], overrides), 0);
  for (const args of [["--limit"], ["--limit", "0"], ["--limit", "1.5"], ["--all", "--limit", "2"], ["--unknown"]]) assert.equal(await modules.cli.runSheetInspection(args, overrides), 1);
});

test("CLI defaults to a small sample, supports an explicit full read and displays only safe reader errors", async () => {
  for (const [args, expected] of [[[], 5], [["--all"], undefined]]) {
    const errors = [];
    const status = await modules.cli.runSheetInspection(args, {
      sources: [fixtures[0].source], loadEnvironment: async () => {}, printError: (line) => errors.push(line),
      read: async (_source, options) => { assert.equal(options.limit, expected); throw new modules.errors.SheetReadError("Missing required header: Submission ID."); },
    });
    assert.equal(status, 1); assert.deepEqual(errors, ["lor-inventory: Missing required header: Submission ID."]);
  }
});

test("reader imports do not execute a database, normalizer or Jotform API dependency", () => {
  for (const name of ["read-sheet.ts", "auth.ts", "sources.ts", "mappings.ts"]) {
    const source = readFileSync(new URL(`../lib/sheets/${name}`, import.meta.url), "utf8");
    assert.equal(/from\s+["'][^"']*(?:prisma|fetch-submissions|import-submissions|save-submission|normalize)[^"']*["']/.test(source), false);
  }
});

test("referral readers include available optional size columns with original headers", async () => {
  const header = " adult female dresses size ";
  const h = harness(fixtures[3], (data) => {
    data.headerResponse.sheets[0].data[0].rowData[0].values.push(text(header));
    data.headerResponse.sheets[0].properties.gridProperties.columnCount++;
    data.dataResponse.sheets[0].properties.gridProperties.columnCount++;
    for (const row of data.dataResponse.sheets[0].data[0].rowData) {
      const value = row.values.some((cell) => cell.effectiveValue?.stringValue) ? "M" : "";
      const index = data.headerResponse.sheets[0].properties.gridProperties.columnCount - 1;
      while (row.values.length <= index) row.values.push(text(""));
      row.values[index] = text(value);
    }
  });
  const result = await h.read();
  assert.equal(result.rows[0].values[header], "M");
  assert.equal(Object.hasOwn(result.rows[0].values, "Adult Male Tops Size"), false);
  assert.equal(Object.hasOwn(result.rows[0].values, "Name"), false);
});

test("deadline expiry during pagination rejects the whole read before later pages", async (t) => {
  let clock = 0;
  t.mock.method(Date, "now", () => clock);
  const h = harness(fixtures[0], (data) => {
    data.headerResponse.sheets[0].properties.gridProperties.rowCount = 1002;
    data.dataResponse.sheets[0].properties.gridProperties.rowCount = 1002;
  }, { getAccessToken: async () => "FICTIONAL_TOKEN" });
  // Return the first page normally, then expire the budget during its parsing.
  const originalJson = Response.prototype.json;
  t.mock.method(Response.prototype, "json", async function () {
    const value = await originalJson.call(this);
    if (h.requests.at(-1).range.startRowIndex === 1) clock = 280000;
    return value;
  });
  await assert.rejects(h.read({ deadlineMs: 270000 }), /deadline.*incomplete/i);
  assert.deepEqual(h.requests.map(({ range }) => range.startRowIndex), [0, 1]);
});

test("expired/invalid read budgets stop before authentication or any Sheet request", async () => {
  const h = harness(undefined, undefined, { getAccessToken: () => assert.fail("No authentication after deadline") });
  await assert.rejects(h.read({ deadlineMs: Date.now() - 1 }), /deadline.*incomplete/i);
  for (const deadlineMs of [NaN, Infinity, -Infinity]) await assert.rejects(h.read({ deadlineMs }), /finite timestamp/);
  assert.equal(h.requests.length, 0);
});

test("authentication waits are bounded by the read deadline", async () => {
  const h = harness(undefined, undefined, { getAccessToken: () => new Promise(() => {}) });
  await assert.rejects(h.read({ deadlineMs: Date.now() + 30 }), /deadline.*incomplete/i);
  assert.equal(h.requests.length, 0);
});

test("retry and response-body waits cannot outlive the overall read budget", async () => {
  let calls = 0;
  await assert.rejects(modules.errors.requestJson(async () => {
    calls++;
    return new Response("PRIVATE", { status: 429, headers: { "retry-after": "2" } });
  }, "https://example.test", {}, "Google Sheets read", { deadlineMs: Date.now() + 1000,
    sleep: () => assert.fail("Retry-After exceeds the budget") }), /deadline.*incomplete/i);
  assert.equal(calls, 1);
  for (const request of [
    () => new Promise(() => {}),
    async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
  ]) {
    await assert.rejects(modules.errors.requestJson(request, "https://example.test", {}, "Google Sheets read", {
      deadlineMs: Date.now() + 30,
    }), /deadline.*incomplete/i);
  }
});

test("a caller's short deadline also bounds a shared in-flight authentication token", async () => {
  const json = credential();
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = json;
  let resolveToken;
  const provider = modules.auth.createTokenProvider(() => new Promise((resolve) => { resolveToken = resolve; }));
  const pending = provider(json);
  const read = modules.reader.createSheetReader({ getAccessToken: provider,
    request: () => assert.fail("No Sheet read after authentication deadline") });
  try {
    await assert.rejects(read(fixtures[0].source, { deadlineMs: Date.now() + 30 }), /deadline.*incomplete/i);
  } finally {
    resolveToken(Response.json({ access_token: "FICTIONAL_TOKEN", token_type: "Bearer", expires_in: 3600 }));
    await pending;
  }
});
