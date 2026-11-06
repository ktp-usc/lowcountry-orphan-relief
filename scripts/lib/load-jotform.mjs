import { readFile } from "node:fs/promises";

/** Load the shared TS implementation without adding a script runner dependency. */
export async function loadJotform() {
  const sourceUrl = new URL("../../lib/jotform/fetch-submissions.ts", import.meta.url);
  if (process.features.typescript) return import(sourceUrl.href);

  // Node 20 does not strip TypeScript. Use the project's existing dev dependency.
  // This source is standalone and has no runtime imports to resolve from the data URL.
  const { default: ts } = await import("typescript");
  const { outputText } = ts.transpileModule(await readFile(sourceUrl, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
