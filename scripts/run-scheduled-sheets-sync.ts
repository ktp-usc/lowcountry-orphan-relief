import { randomUUID } from "node:crypto";
import { createSyncClient } from "./sync-sheets.js";
import { SHEET_SYNC_BUCKET_COUNTS, configuredSheetJob } from "../lib/sheets/cron-config.js";
import { createSheetCronHandler } from "../lib/sheets/cron-handler.js";
import { createDatabaseCronStore } from "../lib/sheets/cron-store.js";
import { syncSheets } from "../lib/sheets/sync-sheets.js";

// Administrative one-shot runner using the same leases, history, deadlines and
// full-coverage job selection as Vercel. This does not install a daily schedule.
const args = process.argv.slice(2);
const jobs = args.length === 1 && args[0] === "--all"
  ? Object.entries(SHEET_SYNC_BUCKET_COUNTS).flatMap(([sourceKey, count]) =>
    Array.from({ length: count }, (_, bucket) => ({ sourceKey, bucket: String(bucket) })))
  : args.length === 4 && args[0] === "--source" && args[2] === "--bucket"
    && configuredSheetJob(args[1], args[3])
    ? [{ sourceKey: args[1], bucket: args[3] }] : undefined;
if (!jobs) {
  console.error("Usage: npm run sync:sheets:scheduled -- [--all | --source SOURCE_KEY --bucket INDEX]");
  process.exitCode = 1;
} else {
  const client = await createSyncClient();
  // Local authentication is isolated to this in-process handler. No production
  // secret is read, generated, persisted, changed, or printed by this runner.
  const localSecret = randomUUID();
  const handle = createSheetCronHandler({
    secret: () => localSecret,
    // This is an explicit administrative manual run, not a scheduled HTTP
    // invocation. The deployment flag does not disable manual sync commands.
    enabled: () => "true",
    store: createDatabaseCronStore(client),
    sync: (options) => syncSheets(client, options),
  });
  try {
    for (const { sourceKey, bucket } of jobs) {
      const response = await handle(new Request("http://localhost", {
        headers: { authorization: `Bearer ${localSecret}` },
      }), sourceKey, bucket);
      console.log(JSON.stringify({ status: response.status, ...await response.json() }));
      if (!response.ok) process.exitCode = 1;
    }
  } finally {
    await client.$disconnect();
  }
}
