import { pathToFileURL } from "node:url";
import { readSheet } from "../lib/sheets/read-sheet.js";
import { SHEET_SOURCES } from "../lib/sheets/sources.js";
import { SheetReadError } from "../lib/sheets/errors.js";
import type { SheetSource } from "../lib/sheets/types.js";

const usage = "Usage: npm run inspect:sheets -- [--limit N | --all]\nDefaults to 5 physical data rows per source. Prints source keys and active/cancelled row counts only.";
type Dependencies = {
  sources: readonly SheetSource[];
  read: typeof readSheet;
  loadEnvironment: () => Promise<void>;
  print: (line: string) => void;
  printError: (line: string) => void;
};

async function loadEnvironment() {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: ".env.local", quiet: true });
  dotenv.config({ path: ".env", quiet: true });
}

export async function runSheetInspection(args = process.argv.slice(2), overrides: Partial<Dependencies> = {}): Promise<number> {
  const dependencies: Dependencies = { sources: SHEET_SOURCES, read: readSheet, loadEnvironment, print: console.log, printError: console.error, ...overrides };
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) { dependencies.print(usage); return 0; }
  let limit: number | undefined = 5;
  if (args.length === 1 && args[0] === "--all") limit = undefined;
  else if (args.length) {
    if (args.length !== 2 || args[0] !== "--limit" || !/^[1-9]\d*$/.test(args[1]) || !Number.isSafeInteger(Number(args[1]))) {
      dependencies.printError(usage); return 1;
    }
    limit = Number(args[1]);
  }
  try { await dependencies.loadEnvironment(); } catch { dependencies.printError("Unable to load the local environment files."); return 1; }
  let status = 0;
  for (const source of dependencies.sources) {
    try {
      const result = await dependencies.read(source, { limit });
      dependencies.print(JSON.stringify({ source: source.key, active: result.rows.filter((row) => !row.cancelled).length, cancelled: result.rows.filter((row) => row.cancelled).length }));
    } catch (error) {
      dependencies.printError(`${source.key}: ${error instanceof SheetReadError ? error.message : "Unexpected source read failure."}`);
      status = 1;
    }
  }
  return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSheetInspection().then((status) => { process.exitCode = status; }).catch(() => { console.error("Sheet inspection failed."); process.exitCode = 1; });
}
