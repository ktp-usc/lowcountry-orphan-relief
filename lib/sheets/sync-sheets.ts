import { syncSubmission } from "../inventory/sync-submission.js";
import { normalizeSheetRow, SheetValidationError } from "./normalize-row.js";
import { readSheet } from "./read-sheet.js";
import { SHEET_SOURCES } from "./sources.js";
import { SheetReadError } from "./errors.js";
import type {
  SheetSource,
  SyncDatabase,
  SyncSheetsOptions,
  SyncSheetsSummary,
} from "./types.js";

type SyncDependencies = {
  sources: readonly SheetSource[];
  read: typeof readSheet;
  normalize: typeof normalizeSheetRow;
  save: typeof syncSubmission;
};

function rowSubmissionId(source: SheetSource, row: { values: Record<string, string> }): string | undefined {
  const value = row.values[source.submissionIdHeader]?.trim();
  return value && /^\d+$/.test(value) ? value : undefined;
}

function normalizationError(error: unknown): string {
  if (!(error instanceof SheetValidationError)) return "Unable to normalize this row.";
  switch (error.code) {
    case "COLUMN": return "A required mapped column is missing or invalid.";
    case "SOURCE": return "The source mapping is invalid.";
    case "SUBMISSION_ID": return "The submission ID is missing or invalid.";
    case "DATE": return "The submission date is missing or invalid.";
    case "QUANTITY": return "An inventory quantity is invalid.";
    case "REFERRAL": return error.message;
    default: return "Unable to normalize this row.";
  }
}

function sourceReadError(error: unknown): string {
  return error instanceof SheetReadError ? error.message : "Unexpected source read failure.";
}

export function createSyncSheets(dependencies: Partial<SyncDependencies> = {}) {
  const { sources, read, normalize, save } = {
    sources: SHEET_SOURCES,
    read: readSheet,
    normalize: normalizeSheetRow,
    save: syncSubmission,
    ...dependencies,
  };

  return async function runSyncSheets(
    client: SyncDatabase,
    options?: SyncSheetsOptions,
  ): Promise<SyncSheetsSummary> {
    const limitPerSource = options?.limitPerSource;
    if (limitPerSource !== undefined
      && (!Number.isSafeInteger(limitPerSource) || limitPerSource < 1)) {
      throw new Error("limitPerSource must be a positive safe integer.");
    }

    const summary: SyncSheetsSummary = {
      created: 0,
      updated: 0,
      unchanged: 0,
      cancelled: 0,
      failed: 0,
      sourceErrors: [],
      rowErrors: [],
    };

    for (const source of sources) {
      let result;
      try {
        result = await read(source, { limit: limitPerSource });
      } catch (error) {
        summary.sourceErrors.push({ sourceKey: source.key, message: sourceReadError(error) });
        continue;
      }

      const concurrency = 5;
      const startedAt = Date.now();

      console.log(
          `${source.key}: processing ${result.rows.length} submissions...`,
      );

      for (let offset = 0; offset < result.rows.length; offset += concurrency) {
        const batch = result.rows.slice(offset, offset + concurrency);

        await Promise.all(
            batch.map(async (row) => {
              const submissionId = rowSubmissionId(source, row);
              let record;

              try {
                record = normalize(source, row);
              } catch (error) {
                summary.failed++;
                summary.rowErrors.push({
                  sourceKey: source.key,
                  rowNumber: row.rowNumber,
                  ...(submissionId ? { submissionId } : {}),
                  message: normalizationError(error),
                });
                return;
              }

              try {
                const saved = await save(client, record);
                summary[saved.status]++;
              } catch {
                summary.failed++;
                summary.rowErrors.push({
                  sourceKey: source.key,
                  rowNumber: row.rowNumber,
                  ...(submissionId ? { submissionId } : {}),
                  message: "Unable to save the normalized submission.",
                });
              }
            }),
        );

        const processed = offset + batch.length;

        if (processed % 100 === 0 || processed === result.rows.length) {
          const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

          console.log(
              `${source.key}: processed ${processed}/${result.rows.length} submissions in ${seconds}s`,
          );
        }
      }
    }

    return summary;
  };
}

const runSyncSheets = createSyncSheets();

export function syncSheets(
  client: SyncDatabase,
  options?: SyncSheetsOptions,
): Promise<SyncSheetsSummary> {
  return runSyncSheets(client, options);
}
