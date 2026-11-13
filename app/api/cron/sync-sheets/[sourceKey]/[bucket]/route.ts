import { createSheetCronHandler } from "@/lib/sheets/cron-handler";
import { createDatabaseCronStore } from "@/lib/sheets/cron-store";
import { syncSheets } from "@/lib/sheets/sync-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

// Disabled/unauthenticated requests must work without even initializing the
// database client (including when database credentials are not configured).
async function database() {
  const { prisma } = await import("@/lib/prisma");
  return prisma;
}

const handle = createSheetCronHandler({
  secret: () => process.env.CRON_SECRET,
  enabled: () => process.env.SHEETS_CRON_ENABLED,
  store: {
    acquire: async (job) => createDatabaseCronStore(await database()).acquire(job),
    finish: async (job, completion) => createDatabaseCronStore(await database()).finish(job, completion),
  },
  sync: async (options) => syncSheets(await database(), options),
});

export async function GET(request: Request, context: { params: Promise<{ sourceKey: string; bucket: string }> }) {
  const { sourceKey, bucket } = await context.params;
  return handle(request, sourceKey, bucket);
}
