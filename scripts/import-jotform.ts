import { pathToFileURL } from "node:url";
import { importSubmissions, type ImportSummary } from "../lib/jotform/import-submissions.js";
import { importUsage, parseImportArgs } from "./lib/jotform-import-args.js";

type ImportClient = Parameters<typeof importSubmissions>[0] & { $disconnect(): Promise<void> };
type CliDependencies = {
  createClient: () => Promise<ImportClient>;
  runImport: typeof importSubmissions;
  print: (message: string) => void;
};

/** Load credentials only for a requested import, never while importing this module. */
export async function createImportClient() {
  const { config } = await import("dotenv");
  // Match Next's precedence: existing process env, .env.local, then .env.
  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });
  const connectionString = process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim();
  if (!connectionString) throw new Error("Set DATABASE_URL (or DIRECT_URL) before importing.");
  if (!process.env.JOTFORM_API_KEY?.trim()) throw new Error("Set JOTFORM_API_KEY before importing.");
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
    import("../generated/prisma/client.js"), import("@prisma/adapter-pg"),
  ]);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 }) });
}

/** Print only totals and structured error lists; always close the database client. */
export async function runImportCli(
  args: string[] = process.argv.slice(2),
  overrides: Partial<CliDependencies> = {},
): Promise<number> {
  const options = parseImportArgs(args);
  const print = overrides.print ?? console.log;
  if (options.help) { print(importUsage); return 0; }
  const client = await (overrides.createClient ?? createImportClient)();
  try {
    const summary: ImportSummary = await (overrides.runImport ?? importSubmissions)(client, { limitPerForm: options.limitPerForm });
    print(JSON.stringify(summary, null, 2));
    return summary.failed || summary.formErrors.length ? 1 : 0;
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runImportCli().then((status) => { process.exitCode = status; }).catch(() => {
    // Raw Prisma/driver exceptions may embed credentials or payloads.
    console.error("Import could not start or finish. Check the command arguments, Jotform configuration and database connection. Use --help for usage.");
    process.exitCode = 1;
  });
}
