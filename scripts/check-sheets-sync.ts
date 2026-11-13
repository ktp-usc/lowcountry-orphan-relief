import { createSyncClient } from "./sync-sheets.js";
import { SHEET_SYNC_BUCKET_COUNTS } from "../lib/sheets/cron-config.js";

const client = await createSyncClient();
try {
  for (const [sourceKey, count] of Object.entries(SHEET_SYNC_BUCKET_COUNTS)) {
    for (let bucket = 0; bucket < count; bucket++) {
      const [job, latest] = await Promise.all([
        client.sheetSyncJob.findUnique({ where: { sourceKey_bucket: { sourceKey, bucket } } }),
        client.sheetSyncAttempt.findFirst({ where: { sourceKey, bucket }, orderBy: { startedAt: "desc" } }),
      ]);
      const expired = latest?.status === "RUNNING" && (!job?.leaseExpiresAt || job.leaseExpiresAt.getTime() <= Date.now());
      const missed = !job?.lastSuccessfulAt || Date.now() - job.lastSuccessfulAt.getTime() > 26 * 3600_000
        || job.lastSuccessBucketCount !== count;
      const slow = (latest?.durationMs ?? 0) >= 180_000;
      const unhealthy = missed || slow || expired || latest?.status === "FAILED" || latest?.status === "INTERRUPTED";
      console.log(JSON.stringify({ sourceKey, bucket, bucketCount: count,
        lastSuccessfulAt: job?.lastSuccessfulAt ?? null,
        lastSuccessDurationMs: job?.lastSuccessDurationMs ?? null,
        lastSuccessProcessedRows: job?.lastSuccessProcessedRows ?? null,
        lastSuccessBucketCount: job?.lastSuccessBucketCount ?? null,
        latestAttempt: latest ? { id: latest.id, status: expired ? "INTERRUPTED" : latest.status,
          startedAt: latest.startedAt, completedAt: latest.completedAt,
          durationMs: latest.durationMs, processedRows: latest.processedRows, error: latest.error } : null,
        missed, slow, unhealthy,
      }));
      if (unhealthy) process.exitCode = 1;
    }
  }
} finally {
  await client.$disconnect();
}
