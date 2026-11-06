import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { loadJotform } from "./lib/load-jotform.mjs";
import { formatSubmissionSummary } from "./lib/jotform-summary.mjs";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    throw new Error("Usage: npm run --silent test:jotform -- FORM_ID");
  }
  for (const envFile of [".env.local", ".env"]) {
    try {
      loadEnvFile(fileURLToPath(new URL(`../${envFile}`, import.meta.url)));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error(`Unable to read the project's ${envFile} file.`);
      }
    }
  }
  const { fetchSubmissions } = await loadJotform();
  const submissions = await fetchSubmissions(args[0]);
  console.log(formatSubmissionSummary(submissions));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Jotform test failed.");
  process.exitCode = 1;
});
