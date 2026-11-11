import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

/** Execute the real TS module graph in tests without a database or API key. */
export async function loadImportModules() {
  const directory = await mkdtemp(join(tmpdir(), "jotform-import-tests-"));
  const paths = [
    "lib/jotform/forms.ts", "lib/jotform/fetch-submissions.ts", "lib/jotform/import-errors.ts", "lib/jotform/import-diagnostics.ts",
    "lib/jotform/import-submissions.ts", "lib/jotform/normalize-inventory.ts", "lib/jotform/normalize-referral.ts",
    "lib/inventory/save-submission.ts", "scripts/lib/jotform-import-args.ts", "scripts/import-jotform.ts", "scripts/check-jotform-import.ts",
  ];
  let compile;
  if (process.features.typescript) {
    const { stripTypeScriptTypes } = await import("node:module");
    compile = (source) => stripTypeScriptTypes(source, { mode: "strip" });
  } else {
    const { default: ts } = await import("typescript");
    compile = (source) => ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
  }
  try {
    await writeFile(join(directory, "package.json"), '{"type":"module"}');
    for (const path of paths) {
      const target = join(directory, path.replace(/\.ts$/, ".js"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, compile(await readFile(new URL(`../../${path}`, import.meta.url), "utf8")));
    }
    const load = (path) => import(pathToFileURL(join(directory, path)).href);
    return {
      importer: await load("lib/jotform/import-submissions.js"),
      fetcher: await load("lib/jotform/fetch-submissions.js"),
      forms: await load("lib/jotform/forms.js"),
      cli: await load("scripts/import-jotform.js"),
      checker: await load("scripts/check-jotform-import.js"),
      diagnostics: await load("lib/jotform/import-diagnostics.js"),
      args: await load("scripts/lib/jotform-import-args.js"),
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
