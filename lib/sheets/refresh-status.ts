import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Location } from "../../generated/prisma/enums.js";
import { SHEET_SYNC_BUCKET_COUNTS } from "./cron-config.js";
import { SHEET_SOURCES } from "./sources.js";

export type SheetRefreshStatus = {
  inventory: string | null;
  referrals: string | null;
  unavailable: boolean;
};

export async function getSheetRefreshStatus(
  client: Pick<PrismaClient, "sheetSyncJob">,
  location: Location,
): Promise<SheetRefreshStatus> {
  const sources = SHEET_SOURCES.filter((source) => source.location === location);
  try {
    const jobs = await client.sheetSyncJob.findMany({
      where: { sourceKey: { in: sources.map((source) => source.key) } },
      select: { sourceKey: true, bucket: true, lastSuccessfulAt: true, lastSuccessBucketCount: true },
    });
    const completedAt = (sourceType: "INVENTORY" | "REFERRAL") => {
      const dates: Date[] = [];
      for (const source of sources.filter((source) => source.sourceType === sourceType)) {
        const count = SHEET_SYNC_BUCKET_COUNTS[source.key];
        for (let bucket = 0; bucket < count; bucket++) {
          const job = jobs.find((entry) => entry.sourceKey === source.key && entry.bucket === bucket);
          // Every current bucket must have succeeded; older partition layouts
          // and incomplete runs cannot establish a complete refresh time.
          if (!job?.lastSuccessfulAt || job.lastSuccessBucketCount !== count) return null;
          dates.push(job.lastSuccessfulAt);
        }
      }
      // The oldest completed bucket is the time through which all are current.
      return dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString() : null;
    };
    return { inventory: completedAt("INVENTORY"), referrals: completedAt("REFERRAL"), unavailable: false };
  } catch {
    // Sync history may not be migrated yet. Inventory remains usable if only
    // the optional freshness lookup is unavailable.
    return { inventory: null, referrals: null, unavailable: true };
  }
}
