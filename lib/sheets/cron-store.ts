import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";
import type { SyncSheetsSummary } from "./types.js";

export type CronJob = { sourceKey: string; bucket: number; bucketCount: number; owner: string };
export type CronCompletion = {
  success: boolean;
  durationMs: number;
  processedRows: number;
  summary?: SyncSheetsSummary;
  error?: string;
};
export type CronStore = {
  acquire(job: CronJob): Promise<boolean>;
  finish(job: CronJob, completion: CronCompletion): Promise<boolean>;
};

/** Database time, atomic acquisition, and owner checks work across instances.
 * The 330s lease outlasts the platform's 300s hard limit; work stops at 270s.
 */
export function createDatabaseCronStore(client: Pick<PrismaClient, "$transaction">): CronStore {
  return {
    async acquire(job) {
      return client.$transaction(async (tx) => {
        const acquired = await tx.$queryRaw<Array<{ sourceKey: string }>>`
          INSERT INTO "SheetSyncJob" ("sourceKey", "bucket", "leaseOwner", "leaseExpiresAt")
          VALUES (${job.sourceKey}, ${job.bucket}, ${job.owner}, clock_timestamp() + interval '330 seconds')
          ON CONFLICT ("sourceKey", "bucket") DO UPDATE
          SET "leaseOwner" = EXCLUDED."leaseOwner", "leaseExpiresAt" = EXCLUDED."leaseExpiresAt"
          WHERE "SheetSyncJob"."leaseExpiresAt" IS NULL OR "SheetSyncJob"."leaseExpiresAt" <= clock_timestamp()
          RETURNING "sourceKey"
        `;
        if (!acquired.length) return false;
        // A process killed by the platform cannot execute a finally block.
        await tx.sheetSyncAttempt.updateMany({
          where: { sourceKey: job.sourceKey, bucket: job.bucket, status: "RUNNING" },
          data: { status: "INTERRUPTED", completedAt: new Date(), error: "Previous execution did not finish before its lease expired." },
        });
        await tx.sheetSyncAttempt.create({ data: {
          id: job.owner, sourceKey: job.sourceKey, bucket: job.bucket, bucketCount: job.bucketCount,
        } });
        return true;
      });
    },
    async finish(job, completion) {
      return client.$transaction(async (tx) => {
        // Release and success metadata are a single conditional update. An old
        // execution can neither release a successor's lease nor claim success.
        const released = completion.success
          ? await tx.$queryRaw<Array<{ sourceKey: string }>>`
            UPDATE "SheetSyncJob" SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
              "lastSuccessfulAt" = clock_timestamp(), "lastSuccessDurationMs" = ${completion.durationMs},
              "lastSuccessProcessedRows" = ${completion.processedRows}, "lastSuccessBucketCount" = ${job.bucketCount}
            WHERE "sourceKey" = ${job.sourceKey} AND "bucket" = ${job.bucket}
              AND "leaseOwner" = ${job.owner} AND "leaseExpiresAt" > clock_timestamp()
            RETURNING "sourceKey"
          `
          : await tx.$queryRaw<Array<{ sourceKey: string }>>`
            UPDATE "SheetSyncJob" SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL
            WHERE "sourceKey" = ${job.sourceKey} AND "bucket" = ${job.bucket}
              AND "leaseOwner" = ${job.owner} AND "leaseExpiresAt" > clock_timestamp()
            RETURNING "sourceKey"
          `;
        const owned = released.length > 0;
        const attempt = await tx.sheetSyncAttempt.updateMany({
          where: { id: job.owner, status: "RUNNING" },
          data: {
            status: !owned ? "INTERRUPTED" : completion.success ? "SUCCEEDED" : "FAILED",
            completedAt: new Date(), durationMs: completion.durationMs, processedRows: completion.processedRows,
            ...(completion.summary ? { summary: completion.summary as Prisma.InputJsonValue } : {}),
            error: !owned ? "Execution lost its lease; completion cannot be confirmed." : completion.error ?? null,
          },
        });
        if (owned && attempt.count !== 1) throw new Error("Unable to persist the owned sync attempt.");
        return owned;
      });
    },
  };
}
