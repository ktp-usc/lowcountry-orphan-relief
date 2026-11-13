import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyncSheets } from "../lib/sheets/sync-sheets.ts";
import { SheetReadError } from "../lib/sheets/errors.ts";
import { SheetValidationError } from "../lib/sheets/normalize-row.ts";
import { parseSyncSheetsArgs, runSyncSheetsCli } from "../scripts/sync-sheets.ts";

const source = (key) => ({ key, submissionIdHeader: "Submission ID" });
const row = (rowNumber, id, kind = "active") => ({
  rowNumber,
  values: { "Submission ID": id, kind },
  cancelled: kind === "cancelled",
});

test("syncSheets applies the per-source limit and counts each save result", async () => {
  const sources = [source("first"), source("second")];
  const limits = [];
  const savedRecords = [];
  const sync = createSyncSheets({
    sources,
    read: async (current, options) => {
      limits.push([current.key, options.limit]);
      return {
        sourceKey: current.key,
        rows: current.key === "first"
          ? [row(2, "101"), row(3, "102"), row(4, "103"), row(5, "104")]
          : [],
      };
    },
    normalize: (_current, currentRow) => ({ kind: currentRow.values.kind, id: currentRow.values["Submission ID"] }),
    save: async (_client, record) => {
      savedRecords.push(record);
      return { status: ({
        "101": "created",
        "102": "updated",
        "103": "unchanged",
        "104": "cancelled",
      })[record.id] };
    },
  });

  const summary = await sync({}, { limitPerSource: 4 });

  assert.deepEqual(limits, [["first", 4], ["second", 4]]);
  assert.deepEqual(savedRecords.map((record) => record.id), ["101", "102", "103", "104"]);
  assert.deepEqual(summary, {
    created: 1,
    updated: 1,
    unchanged: 1,
    cancelled: 1,
    failed: 0,
    sourceErrors: [],
    rowErrors: [],
  });
});

test("syncSheets isolates source and row failures without exposing raw errors", async () => {
  const sources = [source("unreadable"), source("readable")];
  const savedIds = [];
  const sync = createSyncSheets({
    sources,
    read: async (current) => {
      if (current.key === "unreadable") throw new Error("credential and private data");
      return {
        sourceKey: current.key,
        rows: [row(7, "201", "invalid"), row(8, "202"), row(9, "203")],
      };
    },
    normalize: (_current, currentRow) => {
      if (currentRow.values.kind === "invalid") throw new SheetValidationError("DATE", "private answer");
      return { kind: "active", id: currentRow.values["Submission ID"] };
    },
    save: async (_client, record) => {
      savedIds.push(record.id);
      if (record.id === "202") throw new Error("database URL and private answer");
      return { status: "unchanged" };
    },
  });

  const summary = await sync({}, { limitPerSource: 2 });

  assert.deepEqual(savedIds, ["202", "203"]);
  assert.equal(summary.failed, 2);
  assert.equal(summary.unchanged, 1);
  assert.deepEqual(summary.sourceErrors, [{
    sourceKey: "unreadable",
    message: "Unexpected source read failure.",
  }]);
  assert.deepEqual(summary.rowErrors, [
    { sourceKey: "readable", rowNumber: 7, submissionId: "201", message: "The submission date is missing or invalid." },
    { sourceKey: "readable", rowNumber: 8, submissionId: "202", message: "Unable to save the normalized submission." },
  ]);
  assert.equal(JSON.stringify(summary).includes("private"), false);
  assert.equal(JSON.stringify(summary).includes("credential"), false);
});

test("known Sheets read failures retain only their safe reader message", async () => {
  const sync = createSyncSheets({
    sources: [source("denied")],
    read: async () => { throw new SheetReadError("Google Sheets: HTTP 403. Check API access and Viewer sharing with the service account."); },
  });

  const summary = await sync({});

  assert.deepEqual(summary.sourceErrors, [{
    sourceKey: "denied",
    message: "Google Sheets: HTTP 403. Check API access and Viewer sharing with the service account.",
  }]);
});

test("sync CLI requires exactly one safe scope and disconnects after syncing", async () => {
  assert.deepEqual(parseSyncSheetsArgs(["--limit", "2"]), {
    help: false,
    options: { limitPerSource: 2 },
  });
  assert.deepEqual(parseSyncSheetsArgs(["--all"]), { help: false, options: {} });
  assert.throws(() => parseSyncSheetsArgs([]));
  assert.throws(() => parseSyncSheetsArgs(["--all", "--limit", "2"]));
  assert.throws(() => parseSyncSheetsArgs(["--limit", "0"]));

  let disconnected = false;
  let options;
  const printed = [];
  const status = await runSyncSheetsCli(["--limit", "2"], {
    createClient: async () => ({ $disconnect: async () => { disconnected = true; } }),
    sync: async (_client, value) => {
      options = value;
      return {
        created: 0, updated: 0, unchanged: 0, cancelled: 0, failed: 0,
        sourceErrors: [], rowErrors: [],
      };
    },
    print: (message) => printed.push(message),
  });

  assert.equal(status, 0);
  assert.deepEqual(options, { limitPerSource: 2 });
  assert.equal(disconnected, true);
  assert.equal(printed.length, 1);
});

test("sync CLI exits unsuccessfully when any source or row failed", async () => {
  const statuses = [];
  for (const summary of [
    { created: 0, updated: 0, unchanged: 0, cancelled: 0, failed: 1, sourceErrors: [], rowErrors: [] },
    { created: 0, updated: 0, unchanged: 0, cancelled: 0, failed: 0, sourceErrors: [{ sourceKey: "x", message: "read failed" }], rowErrors: [] },
  ]) {
    statuses.push(await runSyncSheetsCli(["--all"], {
      createClient: async () => ({ $disconnect: async () => {} }),
      sync: async () => summary,
      print: () => {},
    }));
  }
  assert.deepEqual(statuses, [1, 1]);
});

test("sync processes up to five submissions concurrently", async () => {
  let active = 0;
  let peak = 0;

  const sync = createSyncSheets({
    sources: [source("concurrency-test")],
    read: async () => ({
      sourceKey: "concurrency-test",
      rows: Array.from(
          { length: 12 },
          (_, index) => row(index + 2, String(index + 1)),
      ),
    }),
    normalize: () => ({ kind: "active" }),
    save: async () => {
      active++;
      peak = Math.max(peak, active);

      await new Promise((resolve) => setTimeout(resolve, 10));

      active--;
      return { status: "created" };
    },
  });

  const summary = await sync({});

  assert.equal(peak, 5);
  assert.equal(active, 0);
  assert.equal(summary.created, 12);
  assert.equal(summary.failed, 0);
});
test("referral failures retain controlled field validation details", async () => {
  const message = "An adult or child/baby selection is required for requested supply field 88 (TOPS).";
  const sync = createSyncSheets({
    sources: [source("referral")],
    read: async () => ({ sourceKey: "referral", rows: [row(2, "301")] }),
    normalize: () => { throw new SheetValidationError("REFERRAL", message); },
    save: async () => assert.fail("Invalid referral must not be saved"),
  });
  const summary = await sync({});
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.rowErrors, [{ sourceKey: "referral", rowNumber: 2, submissionId: "301", message }]);
});
