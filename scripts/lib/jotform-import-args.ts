import { parseArgs } from "node:util";

export const importUsage = "Usage: npm run import:jotform -- --limit 2 | --all\n--limit is the maximum submissions per form; --all explicitly imports every submission.";
export const checkImportUsage = "Usage: npm run check:jotform:import -- --limit 2\nChecks 1–5 real submissions per form twice, verifies database rows, then rolls back separate fictional fixtures.";

/** Require a deliberate bounded sample or explicit full-import selection. */
export function parseImportArgs(args: string[], check = false): { help: boolean; limitPerForm?: number } {
  const { values } = parseArgs({
    args, options: { limit: { type: "string" }, all: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    allowPositionals: false, strict: true,
  });
  if (values.help) return { help: true };
  if ((values.all && values.limit !== undefined) || (!values.all && values.limit === undefined) || (check && values.all)) {
    throw new Error(check ? checkImportUsage : importUsage);
  }
  if (values.all) return { help: false };
  if (!/^[1-9]\d*$/.test(values.limit ?? "")) throw new Error("--limit must be a positive integer.");
  const limitPerForm = Number(values.limit);
  if (!Number.isSafeInteger(limitPerForm) || (check && limitPerForm > 5)) {
    throw new Error(check ? "Live checks accept --limit between 1 and 5 per form." : "--limit must be a positive safe integer.");
  }
  return { help: false, limitPerForm };
}
