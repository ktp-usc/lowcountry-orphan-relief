import { readFile } from "node:fs/promises";

/** Load the pure normalizer on every Node version supported by the project. */
export async function loadReferral() {
  const sourceUrl = new URL("../../lib/jotform/normalize-referral.ts", import.meta.url);
  if (process.features.typescript) return import(sourceUrl.href);

  const { default: ts } = await import("typescript");
  const { outputText } = ts.transpileModule(await readFile(sourceUrl, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
