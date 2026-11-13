import { randomUUID, timingSafeEqual } from "node:crypto";
import { configuredSheetJob } from "./cron-config.js";
import type { CronStore, CronCompletion } from "./cron-store.js";
import type { SyncSheetsOptions, SyncSheetsSummary } from "./types.js";

type Dependencies = {
  secret: () => string | undefined;
  enabled?: () => string | undefined;
  store: CronStore;
  sync: (options: SyncSheetsOptions) => Promise<SyncSheetsSummary>;
  now?: () => number;
  warn?: (message: string) => void;
};

export function createSheetCronHandler(dependencies: Dependencies) {
  const now = dependencies.now ?? Date.now;
  const warn = dependencies.warn ?? console.warn;
  return async (request: Request, sourceKey: string, bucket: string): Promise<Response> => {
    const json = (body: object, status: number) => Response.json(body, {
      status, headers: { "Cache-Control": "no-store" },
    });
    const secret = dependencies.secret();
    if (!secret?.trim()) return json({ error: "Cron authentication is not configured." }, 503);
    const expected = Buffer.from(`Bearer ${secret}`);
    const supplied = Buffer.from(request.headers.get("authorization") ?? "");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      return json({ error: "Unauthorized" }, 401);
    }
    // Authenticate even when disabled. Check before validating jobs, creating
    // timers, acquiring leases or starting any Sheet/database work.
    if (dependencies.enabled?.() !== "true") {
      return json({ status: "disabled", code: "SHEETS_CRON_DISABLED",
        message: "Scheduled Sheets syncing is disabled." }, 503);
    }
    const configured = configuredSheetJob(sourceKey, bucket);
    if (!configured) return json({ error: "Unknown source or bucket." }, 404);
    const startedAt = now();
    const job = { sourceKey, bucket: configured.bucket.index, bucketCount: configured.bucket.count, owner: randomUUID() };
    let acquired = false;
    let capacityWarned = false;
    const warnCapacity = (elapsedMs: number) => {
      if (elapsedMs >= 180_000 && !capacityWarned) {
        capacityWarned = true;
        warn(`CAPACITY WARNING: ${sourceKey}/${bucket} took ${elapsedMs}ms; target is below 180000ms. Measure and increase partitions.`);
      }
    };
    // Warn while work is still running, even if the platform later kills it.
    const capacityTimer = setTimeout(() => warnCapacity(Math.max(180_000, now() - startedAt)), 180_000);
    capacityTimer.unref?.();
    try {
      acquired = await dependencies.store.acquire(job);
      if (!acquired) return json({ error: "This source/bucket is already running." }, 409);
      let summary: SyncSheetsSummary | undefined;
      let error: string | undefined;
      try {
        summary = await dependencies.sync({ sourceKey, bucket: configured.bucket, deadlineMs: startedAt + 270_000 });
      } catch {
        error = "Unexpected Sheet sync failure; this run is incomplete.";
      }
      const elapsedMs = now() - startedAt;
      warnCapacity(elapsedMs);
      if (elapsedMs >= 270_000) error = "Sync deadline reached; this run is incomplete. Rerun the entire bucket.";
      const success = !!summary && !error && !summary.failed && !summary.sourceErrors.length;
      const processedRows = summary ? summary.created + summary.updated + summary.unchanged + summary.cancelled + summary.failed : 0;
      const completion: CronCompletion = { success, durationMs: elapsedMs, processedRows, summary,
        error: error ?? (success ? undefined : "One or more rows or sources failed; see summary.") };
      const owned = await dependencies.store.finish(job, completion);
      return json({ sourceKey, bucket: job.bucket, bucketCount: job.bucketCount, elapsedMs, processedRows,
        ...(summary ? { summary } : {}),
        ...(!owned ? { error: "Execution lost its lease; completion cannot be confirmed." } : error ? { error } : {}),
      }, success && owned ? 200 : 500);
    } catch {
      // Do not expose raw database errors. If persistence fails, never claim
      // success; the RUNNING attempt/expired lease makes the interruption visible.
      return json({ error: acquired ? "Unable to confirm sync completion in the database." : "Unable to acquire the database sync lease.",
        elapsedMs: now() - startedAt }, 500);
    } finally {
      clearTimeout(capacityTimer);
    }
  };
}
