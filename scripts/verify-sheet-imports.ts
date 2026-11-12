import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SHEET_SOURCES } from "../lib/sheets/sources.js";
import { normalizeSheetRow, SheetValidationError } from "../lib/sheets/normalize-row.js";
import { formatCsv, parseCsv } from "./lib/sheet-csv.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const normalizedHeader = ["sourceFile", "sourceRowNumber", "kind", "jotformFormId", "jotformSubmissionId",
  "location", "sourceType", "submissionDate", "itemCode", "quantity", "direction"];
const errorHeader = ["sourceFile", "sourceRowNumber", "jotformFormId", "jotformSubmissionId", "errorCode", "errorMessage"];

async function safeFile(directory: string, name: string, mustExist: boolean): Promise<string> {
  if (basename(name) !== name) throw new Error("Invalid configured filename.");
  const file = join(directory, name);
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || dirname(await realpath(file)) !== directory) {
      throw new Error("Invalid file path.");
    }
  } catch (error) {
    if (mustExist || !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return file;
}

export async function verifySheetImports(projectRoot = root) {
  let failed = false;
  projectRoot = resolve(projectRoot);
  const inputDir = await realpath(join(projectRoot, "imports"));
  if (inputDir !== join(projectRoot, "imports")) throw new Error("Invalid imports directory.");
  const exportPath = join(projectRoot, "exports");
  await mkdir(exportPath, { recursive: true });
  const outputDir = await realpath(exportPath);
  if (outputDir !== exportPath) throw new Error("Invalid exports directory.");

  for (const source of SHEET_SOURCES) {
    const counts = { active: 0, cancelled: 0, rejected: 0 };
    try {
      const input = await safeFile(inputDir, source.fileName, true);
      const base = source.fileName.slice(0, -4);
      const normalizedPath = await safeFile(outputDir, `${base}-normalized.csv`, false);
      const errorsPath = await safeFile(outputDir, `${base}-errors.csv`, false);
      const { headers, rows } = parseCsv(await readFile(input, "utf8"));
      const normalized: (string | number)[][] = [normalizedHeader];
      const errors: (string | number)[][] = [errorHeader];
      for (const row of rows) {
        try {
          const result = normalizeSheetRow(source, { headers, values: row.values, rowNumber: row.rowNumber });
          if (result.kind === "cancelled") {
            counts.cancelled++;
            normalized.push([source.fileName, row.rowNumber, result.kind, result.jotformFormId, result.jotformSubmissionId, "", "", "", "", "", ""]);
          } else {
            counts.active++;
            const { submission, inventoryActivities } = result.input;
            const metadata = [source.fileName, row.rowNumber, result.kind, submission.jotformFormId,
              submission.jotformSubmissionId, submission.location, submission.sourceType, submission.submissionDate.toISOString()];
            if (!inventoryActivities.length) normalized.push([...metadata, "", "", ""]);
            for (const activity of inventoryActivities) normalized.push([...metadata, activity.itemCode, activity.quantity, activity.direction]);
          }
        } catch (error) {
          counts.rejected++;
          const idIndex = headers.indexOf("Submission ID");
          const value = idIndex >= 0 ? row.values[idIndex].trim() : "";
          const id = /^\d+$/.test(value) ? value : "";
          if (!(error instanceof SheetValidationError)) failed = true;
          errors.push([source.fileName, row.rowNumber, source.jotformFormId, id,
            error instanceof SheetValidationError ? error.code : "UNEXPECTED",
            error instanceof SheetValidationError ? error.message : "Unexpected normalization failure."]);
        }
      }
      await writeFile(normalizedPath, formatCsv(normalized), "utf8");
      await writeFile(errorsPath, formatCsv(errors), "utf8");
      console.log(`${source.key}: active=${counts.active} cancelled=${counts.cancelled} rejected=${counts.rejected}`);
    } catch {
      failed = true;
      console.error(`${source.key}: file processing failed.`);
    }
  }
  return !failed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifySheetImports().then((ok) => { if (!ok) process.exitCode = 1; }).catch(() => {
    console.error("Sheet verification failed: invalid or inaccessible input/output directories.");
    process.exitCode = 1;
  });
}
