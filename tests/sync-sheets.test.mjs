import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyncSheets as createSyncSheetsImpl } from "../lib/sheets/sync-sheets.ts";
import { SheetReadError } from "../lib/sheets/errors.ts";
import { normalizeSheetRow, SheetValidationError } from "../lib/sheets/normalize-row.ts";
import { SHEET_MAPPINGS } from "../lib/sheets/mappings.ts";
import { parseSyncSheetsArgs, runSyncSheetsCli } from "../scripts/sync-sheets.ts";

const activeRecord = (id = "101") => ({
  kind: "active", id,
  input: { submission: {
    jotformFormId: "123", jotformSubmissionId: id, location: "LOWCOUNTRY",
    sourceType: "INVENTORY", submissionDate: new Date("2026-07-01T00:00:00Z"),
  }, inventoryActivities: [] },
});
const createSyncSheets = (overrides) => createSyncSheetsImpl({
  loadExisting: async () => new Map(), ...overrides,
});

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
    normalize: (_current, currentRow) => activeRecord(currentRow.values["Submission ID"]),
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
      return activeRecord(currentRow.values["Submission ID"]);
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
    normalize: (_source, currentRow) => activeRecord(currentRow.values["Submission ID"]),
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

const existingRecord = (record) => ({
  id: 1, ...record.input.submission,
  inventoryActivities: record.input.inventoryActivities.map((a) => ({
    item: { code: a.itemCode.trim() }, quantity: a.quantity, direction: a.direction,
  })),
});

test("unchanged records use bounded batched lookups without save transactions", async () => {
  const rows = Array.from({ length: 601 }, (_, i) => row(i + 2, String(i + 1)));
  const lookups = [];
  const sync = createSyncSheets({
    sources: [source("batch")],
    read: async () => ({ sourceKey: "batch", rows }),
    normalize: (_source, row) => activeRecord(row.values["Submission ID"]),
    loadExisting: async (_client, _source, ids) => {
      lookups.push(ids.length);
      return new Map(ids.map((id) => [id, existingRecord(activeRecord(id))]));
    },
    save: () => assert.fail("No individual transaction for unchanged records"),
  });
  const result = await sync({});
  assert.equal(result.unchanged, 601);
  assert.equal(result.failed, 0);
  assert.deepEqual(lookups, [250, 250, 101]);
});

test("batch lookup failure never turns existing records into new submissions", async () => {
  const sync = createSyncSheets({
    sources: [source("batch")],
    read: async () => ({ sourceKey: "batch", rows: [row(2, "1"), row(3, "2")] }),
    normalize: (_source, row) => activeRecord(row.values["Submission ID"]),
    loadExisting: async () => { throw new Error("PRIVATE DATABASE URL"); },
    save: () => assert.fail("Must not save after a failed lookup"),
  });
  const result = await sync({});
  assert.equal(result.created, 0);
  assert.equal(result.failed, 2);
  assert.ok(result.rowErrors.every(({ message }) => message === "Unable to batch-load existing submissions."));
});

test("fast comparison matches saver semantics, routes changes/restorations/cancellations to saver", async () => {
  const records = new Map(Array.from({ length: 8 }, (_, i) => {
    const id = String(i + 1), record = activeRecord(id);
    record.input.inventoryActivities = [
      { itemCode: " TOPS ", quantity: 2, direction: "IN" },
      { itemCode: "WIPES", quantity: 1, direction: "OUT" },
    ];
    return [id, record];
  }));
  const existing = new Map([...records].map(([id, record]) => [id, existingRecord(record)]));
  existing.get("1").inventoryActivities.reverse();
  existing.delete("2"); // create
  existing.get("3").inventoryActivities[0].quantity = 3; // quantity change
  existing.get("4").inventoryActivities = []; // restore
  existing.get("5").location = "MIDLANDS"; // metadata change
  records.set("6", { kind: "cancelled", jotformFormId: "123", jotformSubmissionId: "6" });
  records.set("7", { kind: "cancelled", jotformFormId: "123", jotformSubmissionId: "7" });
  existing.get("7").inventoryActivities = []; // cancellation already applied
  records.set("8", { kind: "cancelled", jotformFormId: "123", jotformSubmissionId: "8" });
  existing.delete("8"); // never imported cancellation
  const saved = [];
  const sync = createSyncSheets({
    sources: [source("batch")],
    read: async () => ({ sourceKey: "batch", rows: [...records.keys()].map((id, i) => row(i + 2, id)) }),
    normalize: (_source, row) => records.get(row.values["Submission ID"]),
    loadExisting: async () => existing,
    save: async (_client, record) => {
      const id = record.kind === "active" ? record.input.submission.jotformSubmissionId : record.jotformSubmissionId;
      saved.push(id);
      return { status: id === "2" ? "created" : id === "6" ? "cancelled" : "updated" };
    },
  });
  const result = await sync({});
  assert.deepEqual(saved, ["2", "3", "4", "5", "6"]);
  assert.deepEqual([result.created, result.updated, result.unchanged, result.cancelled, result.failed], [1, 3, 1, 3, 0]);
});

test("partition filtering precedes normalization and includes old and cancelled rows", async () => {
  const ids = ["00000000000000000000000001", "9007199254740993", "9999999999999999999999999999999999999999999999999"];
  const visited = [];
  const sync = createSyncSheets({
    sources: [source("partition")],
    read: async (_source, options) => {
      assert.equal(options.limit, undefined);
      return { sourceKey: "partition", rows: ids.map((id, i) => row(10000 - i, id, i === 1 ? "cancelled" : "active")) };
    },
    normalize: (_source, row) => {
      const id = row.values["Submission ID"];
      visited.push(id);
      return row.cancelled ? { kind: "cancelled", jotformFormId: "123", jotformSubmissionId: id } : activeRecord(id);
    },
    save: async () => ({ status: "created" }),
  });
  for (let index = 0; index < 7; index++) await sync({}, { sourceKey: "partition", bucket: { index, count: 7 } });
  assert.deepEqual(visited.sort(), ids.sort());
});

test("deadline leaves an explicit incomplete failure instead of a successful partial run", async () => {
  const sync = createSyncSheets({
    sources: [source("deadline")],
    read: async () => ({ sourceKey: "deadline", rows: [row(2, "1")] }),
    normalize: () => assert.fail("Deadline must stop normalization"),
    save: () => assert.fail("Deadline must stop writes"),
  });
  const result = await sync({}, { deadlineMs: Date.now() - 1 });
  assert.equal(result.created, 0);
  assert.match(result.sourceErrors[0].message, /incomplete/);
});

test("existing manual sync CLI still processes rows while the cron flag is disabled", async () => {
  const original = process.env.SHEETS_CRON_ENABLED;
  process.env.SHEETS_CRON_ENABLED = "false";
  try {
    const sync = createSyncSheets({
      sources: [source("manual")],
      read: async () => ({ sourceKey: "manual", rows: [row(2, "123")] }),
      normalize: () => activeRecord("123"),
      save: async () => ({ status: "created" }),
    });
    const output = [];
    let disconnected = false;
    const status = await runSyncSheetsCli(["--all"], {
      createClient: async () => ({ $disconnect: async () => { disconnected = true; } }),
      sync,
      print: (message) => output.push(JSON.parse(message)),
    });
    assert.equal(status, 0);
    assert.equal(output[0].created, 1);
    assert.equal(disconnected, true);
  } finally {
    if (original === undefined) delete process.env.SHEETS_CRON_ENABLED;
    else process.env.SHEETS_CRON_ENABLED = original;
  }
});

test("invalid referral corrections never replace existing saved activities", async () => {
  const mapping = SHEET_MAPPINGS.find(({ key }) => key === "lor-referral");
  const values = {
    ...Object.fromEntries(Object.values(mapping.answerHeaders).map((header) => [header, ""])),
    "Submission ID": "9007199254740993", "Submission Date": "2026-11-12 10:00:00",
    "Child's Sex": "Female", "Tops?": "Yes", "Female Tops Type": "Adult",
  };
  const old = normalizeSheetRow(mapping, { rowNumber: 2, cancelled: false, values });
  const before = structuredClone(old);
  const invalidValues = Object.fromEntries(Object.entries({ ...values, "Tops?": "Yse" }).map(([key, value]) => [` ${key.toUpperCase()} `, value]));
  const sync = createSyncSheets({
    sources: [mapping],
    read: async () => ({ sourceKey: mapping.key, rows: [{ rowNumber: 2, cancelled: false, values: invalidValues }] }),
    loadExisting: () => assert.fail("Invalid rows must not reach a database lookup"),
    save: () => assert.fail("An invalid correction must not replace saved activities"),
  });
  const result = await sync({});
  assert.equal(result.failed, 1);
  assert.equal(result.updated, 0);
  assert.equal(result.created, 0);
  assert.equal(result.rowErrors[0].submissionId, "9007199254740993");
  assert.match(result.rowErrors[0].message, /field 88/);
  assert.equal(result.rowErrors[0].message.includes("Yse"), false);
  assert.deepEqual(old, before);
});

test("sync passes the same deadline into the Sheet reader and reports incomplete reads", async () => {
  const deadlineMs = Date.now() + 10000;
  const sync = createSyncSheets({
    sources: [source("deadline")],
    read: async (_source, options) => {
      assert.equal(options.deadlineMs, deadlineMs);
      throw new SheetReadError("Sheet sync deadline reached; this read is incomplete.");
    },
    normalize: () => assert.fail("No partial-read normalization"),
    save: () => assert.fail("No partial-read writes"),
  });
  const result = await sync({}, { deadlineMs });
  assert.match(result.sourceErrors[0].message, /deadline.*incomplete/);
  assert.equal(result.created + result.updated + result.unchanged + result.cancelled, 0);
});
