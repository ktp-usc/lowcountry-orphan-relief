import { writeFile, mkdir } from "node:fs/promises";
import { createSyncClient } from "./sync-sheets.js";
import { syncSheets } from "../lib/sheets/sync-sheets.js";
import { SHEET_SYNC_BUCKET_COUNTS } from "../lib/sheets/cron-config.js";

// Full reconciliation, including Sheet reads and real writes for changed rows.
// No row or date limits. Never prints credentials or submitted answers.
const client = await createSyncClient();
const measurements = [];
try {
  for (const [sourceKey, count] of Object.entries(SHEET_SYNC_BUCKET_COUNTS)) {
    for (let index = 0; index < count; index++) {
      const startedAt = new Date();
      const summary = await syncSheets(client, { sourceKey, bucket: { index, count } });
      const durationMs = Date.now() - startedAt.getTime();
      const processedRows = summary.created + summary.updated + summary.unchanged + summary.cancelled + summary.failed;
      const measurement = { sourceKey, bucket: index, bucketCount: count, startedAt: startedAt.toISOString(),
        durationMs, processedRows, summary };
      measurements.push(measurement);
      console.log(JSON.stringify(measurement));
      if (durationMs >= 180_000) console.warn(`CAPACITY WARNING: ${sourceKey}/${index} exceeded 180 seconds.`);
    }
  }
  await mkdir("exports", { recursive: true });
  await writeFile("exports/sheet-sync-measurements.json", JSON.stringify(measurements, null, 2) + "\n");
  if (measurements.some(({ summary }) => summary.failed || summary.sourceErrors.length)) process.exitCode = 1;
} finally {
  await client.$disconnect();
}
