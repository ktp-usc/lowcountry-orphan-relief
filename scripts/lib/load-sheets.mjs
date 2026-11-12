import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

/** Compile the actual reader and CLI for offline tests on supported Node versions. */
export async function loadSheets() {
  const directory = await mkdtemp(join(tmpdir(), "sheets-reader-tests-"));
  const paths = ["lib/sheets/types.ts", "lib/jotform/forms.ts", "lib/sheets/sources.ts", "lib/sheets/mappings.ts", "lib/sheets/errors.ts", "lib/sheets/auth.ts", "lib/sheets/read-sheet.ts", "scripts/inspect-sheets.ts"];
  let compile;
  if (process.features.typescript) {
    const { stripTypeScriptTypes } = await import("node:module");
    compile = (source) => stripTypeScriptTypes(source, { mode: "strip" });
  } else {
    const { default: ts } = await import("typescript");
    compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
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
      reader: await load("lib/sheets/read-sheet.js"), sources: await load("lib/sheets/sources.js"),
      mappings: await load("lib/sheets/mappings.js"),
      auth: await load("lib/sheets/auth.js"), errors: await load("lib/sheets/errors.js"),
      cli: await load("scripts/inspect-sheets.js"), close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }); throw error;
  }
}
