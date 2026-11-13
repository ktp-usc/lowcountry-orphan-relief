import { syncSubmission, unchangedSubmissionResult } from "../inventory/sync-submission.js";
import { normalizeSheetRow, readSheetValue, SheetValidationError } from "./normalize-row.js";
import { readSheet } from "./read-sheet.js";
import { SHEET_SOURCES } from "./sources.js";
import { SheetReadError } from "./errors.js";
import { loadExistingSubmissions } from "./load-existing.js";
import { belongsToBucket } from "./cron-config.js";
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
  loadExisting: typeof loadExistingSubmissions;
};

function rowSubmissionId(source: SheetSource, row: { values: Record<string, string> }): string | undefined {
  try {
    const value = readSheetValue(row, source.submissionIdHeader).trim();
    return value && /^\d+$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
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
  const { sources, read, normalize, save, loadExisting } = {
    sources: SHEET_SOURCES,
    read: readSheet,
    normalize: normalizeSheetRow,
    save: syncSubmission,
    loadExisting: loadExistingSubmissions,
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

    const bucket = options?.bucket;
    if (options?.deadlineMs !== undefined && !Number.isFinite(options.deadlineMs)) {
      throw new Error("deadlineMs must be a finite timestamp.");
    }
    if (bucket && (!Number.isSafeInteger(bucket.count) || bucket.count < 1
      || !Number.isSafeInteger(bucket.index) || bucket.index < 0 || bucket.index >= bucket.count)) {
      throw new Error("Invalid submission bucket.");
    }
    if (bucket && !options?.sourceKey) throw new Error("A bucket requires a source.");
    const selectedSources = options?.sourceKey ? sources.filter((source) => source.key === options.sourceKey) : sources;
    if (!selectedSources.length) throw new Error("Unknown Sheet source.");
    const stopped = () => options?.deadlineMs !== undefined && Date.now() >= options.deadlineMs;

    const summary: SyncSheetsSummary = {
      created: 0,
      updated: 0,
      unchanged: 0,
      cancelled: 0,
      failed: 0,
      sourceErrors: [],
      rowErrors: [],
    };

    for (const source of selectedSources) {
      let result;
      try {
        result = await read(source, { limit: limitPerSource, deadlineMs: options?.deadlineMs });
      } catch (error) {
        summary.sourceErrors.push({ sourceKey: source.key, message: sourceReadError(error) });
        continue;
      }

      const concurrency = 5;
      const startedAt = Date.now();

      console.log(
          `${source.key}: processing ${result.rows.length} submissions...`,
      );

      // readSheet resolves duplicate IDs before partitioning. Invalid IDs must
      // still reach validation rather than silently disappearing from a bucket.
      const rows = result.rows.filter((row) => {
        const id = rowSubmissionId(source, row);
        return !bucket || !id || belongsToBucket(id, bucket);
      });
      const fail = (row: (typeof rows)[number], message: string) => {
        const submissionId = rowSubmissionId(source, row);
        summary.failed++;
        summary.rowErrors.push({ sourceKey: source.key, rowNumber: row.rowNumber,
          ...(submissionId ? { submissionId } : {}), message });
      };
      const deadlineFailure = () => summary.sourceErrors.push({
        sourceKey: source.key, message: "Sync deadline reached; this run is incomplete. Rerun the entire bucket.",
      });

      // One bounded lookup per 250 rows, including all activities. A failed
      // lookup never becomes an empty map and never triggers create attempts.
      for (let offset = 0; offset < rows.length; offset += 250) {
        if (stopped()) { deadlineFailure(); break; }
        const page = rows.slice(offset, offset + 250);
        const normalized: Array<{ row: (typeof rows)[number]; record: ReturnType<typeof normalize> }> = [];
        for (const row of page) {
          try { normalized.push({ row, record: normalize(source, row) }); }
          catch (error) { fail(row, normalizationError(error)); }
        }
        let existing;
        try {
          const ids = normalized.map(({ record }) => record.kind === "cancelled"
            ? record.jotformSubmissionId : record.input.submission.jotformSubmissionId);
          existing = ids.length ? await loadExisting(client, source, ids) : new Map();
        } catch {
          for (const { row } of normalized) fail(row, "Unable to batch-load existing submissions.");
          continue;
        }
        let incomplete = false;
        for (let index = 0; index < normalized.length; index += concurrency) {
          if (stopped()) { deadlineFailure(); incomplete = true; break; }
          await Promise.all(normalized.slice(index, index + concurrency).map(async ({ row, record }) => {
            try {
              const id = record.kind === "cancelled" ? record.jotformSubmissionId : record.input.submission.jotformSubmissionId;
              const saved = unchangedSubmissionResult(record, existing.get(id) ?? null)
                ?? await save(client, record);
              summary[saved.status]++;
            } catch { fail(row, "Unable to save the normalized submission."); }
          }));
        }
        if (incomplete) break;
        const processed = Math.min(offset + page.length, rows.length);
        console.log(`${source.key}: processed ${processed}/${rows.length} submissions in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      }
      if (stopped() && !summary.sourceErrors.some((error) => error.sourceKey === source.key)) deadlineFailure();
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
