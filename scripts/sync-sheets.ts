import { pathToFileURL } from "node:url";
import type { PrismaClient } from "../generated/prisma/client.js";
import { syncSheets } from "../lib/sheets/sync-sheets.js";
import type { SyncDatabase, SyncSheetsOptions, SyncSheetsSummary } from "../lib/sheets/types.js";

const usage = "Usage: npm run sync:sheets -- [--limit N | --all]\n--limit applies to each source; --all imports every source row.";

type SyncClient = SyncDatabase & { $disconnect(): Promise<void> };
type CliDependencies = {
  createClient: () => Promise<SyncClient>;
  sync: typeof syncSheets;
  print: (message: string) => void;
  printError: (message: string) => void;
};

type ParsedArgs = { help: boolean; options?: SyncSheetsOptions };

export function parseSyncSheetsArgs(args: string[]): ParsedArgs {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return { help: true };
  if (args.length === 1 && args[0] === "--all") return { help: false, options: {} };
  if (args.length === 2 && args[0] === "--limit"
    && /^[1-9]\d*$/.test(args[1]) && Number.isSafeInteger(Number(args[1]))) {
    return { help: false, options: { limitPerSource: Number(args[1]) } };
  }
  throw new Error(usage);
}

export async function createSyncClient(): Promise<PrismaClient> {
  const { config } = await import("dotenv");
  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });
  const connectionString = process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim();
  if (!connectionString) throw new Error("Set DATABASE_URL (or DIRECT_URL) before syncing.");
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
    import("../generated/prisma/client.js"),
    import("@prisma/adapter-pg"),
  ]);
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000, max: 5 }),
  });
}

export async function runSyncSheetsCli(
  args = process.argv.slice(2),
  overrides: Partial<CliDependencies> = {},
): Promise<number> {
  const dependencies: CliDependencies = {
    createClient: createSyncClient,
    sync: syncSheets,
    print: console.log,
    printError: console.error,
    ...overrides,
  };
  let parsed: ParsedArgs;
  try {
    parsed = parseSyncSheetsArgs(args);
  } catch {
    dependencies.printError(usage);
    return 1;
  }
  if (parsed.help) {
    dependencies.print(usage);
    return 0;
  }

  const client = await dependencies.createClient();
  try {
    const summary: SyncSheetsSummary = await dependencies.sync(client, parsed.options);
    dependencies.print(JSON.stringify(summary, null, 2));
    return summary.failed || summary.sourceErrors.length ? 1 : 0;
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSyncSheetsCli().then((status) => { process.exitCode = status; }).catch(() => {
    console.error("Sheet sync could not start or finish. Check the command arguments, database configuration, and Sheets access. Use --help for usage.");
    process.exitCode = 1;
  });
}
