import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatCsv, parseCsv } from "../scripts/lib/sheet-csv.mjs";
import { SHEET_MAPPINGS } from "../lib/sheets/mappings.ts";
import { verifySheetImports } from "../scripts/verify-sheet-imports.ts";

const fixtureCsv = (mapping) => {
  const headers = [mapping.submissionDateHeader, ...Object.values(mapping.answerHeaders), mapping.submissionIdHeader];
  const values = headers.map((header) => header === mapping.submissionDateHeader
    ? "2026-07-01 09:00:00"
    : header === mapping.submissionIdHeader ? "000987654321" : "");
  return { headers, values };
};
test("CSV preserves duplicate and blank headers, quoting and source row numbers", () => {
  const parsed = parseCsv('\uFEFFa,,a\r\n"hello,\nworld",,"a""b"\r\nx,,y\r\n');
  assert.deepEqual(parsed, { headers: ["a", "", "a"], rows: [
    { values: ["hello,\nworld", "", 'a"b'], rowNumber: 2 },
    { values: ["x", "", "y"], rowNumber: 4 },
  ] });
  assert.deepEqual(parseCsv(formatCsv([parsed.headers, ...parsed.rows.map((r) => r.values)])).rows.map((r) => r.values),
    parsed.rows.map((r) => r.values));
});

test("CSV rejects malformed files without exposing contents", () => {
  for (const input of ['a,b\n"PRIVATE', 'a,b\n"PRIVATE"x,b', "a,b\nx"]) {
    assert.throws(() => parseCsv(input), (error) => !error.message.includes("PRIVATE"));
  }
});

test("offline verifier handles all sources, rejects individual rows safely, and writes empty error files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sheet-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.mock.method(globalThis, "fetch", () => { throw new Error("Network access forbidden"); });
  await mkdir(join(root, "imports"));
  for (const source of SHEET_MAPPINGS) {
    const { headers, values } = fixtureCsv(source);
    await writeFile(join(root, "imports", source.fileName), formatCsv([headers, values]));
  }
  const source = SHEET_MAPPINGS[0], input = join(root, "imports", source.fileName);
  const original = parseCsv(await readFile(input, "utf8"));
  const invalid = [...original.rows[0].values];
  invalid[original.headers.indexOf("Men's Tops")] = "PRIVATE-ANSWER";
  await writeFile(input, formatCsv([original.headers, original.rows[0].values, invalid]));
  const before = await readFile(input, "utf8");
  assert.equal(await verifySheetImports(root), true);
  assert.equal(await readFile(input, "utf8"), before);
  for (const item of SHEET_MAPPINGS) {
    const name = item.fileName.slice(0, -4);
    const normalized = parseCsv(await readFile(join(root, "exports", `${name}-normalized.csv`), "utf8"));
    const errorsText = await readFile(join(root, "exports", `${name}-errors.csv`), "utf8");
    const errors = parseCsv(errorsText);
    assert.equal(normalized.rows.length, item.sourceType === "INVENTORY" ? 1 : 2);
    assert.equal(errors.rows.length, item === source ? 1 : 0);
    assert.equal(errorsText.includes("PRIVATE-ANSWER"), false);
  }
});

test("offline verifier fails safely for a malformed input while continuing other files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sheet-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "imports"));
  for (const source of SHEET_MAPPINGS) {
    const { headers, values } = fixtureCsv(source);
    const text = source === SHEET_MAPPINGS[0] ? '"PRIVATE' : formatCsv([headers, values]);
    await writeFile(join(root, "imports", source.fileName), text);
  }
  assert.equal(await verifySheetImports(root), false);
  const next = SHEET_MAPPINGS[1].fileName.slice(0, -4);
  assert.ok((await readFile(join(root, "exports", `${next}-normalized.csv`), "utf8")).includes("active"));
});
