import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const [mode, ...args] = process.argv.slice(2);
const entry = { import: "import-jotform.js", check: "check-jotform-import.js" }[mode];
function run(file, arguments_) {
  const result = spawnSync(process.execPath, [file, ...arguments_], { cwd: projectRoot, stdio: "inherit" });
  return result.status ?? 1;
}

try {
  if (!entry) throw new Error("Unsupported Jotform command.");
  const compiler = require.resolve("typescript/lib/tsc.js");
  const status = run(compiler, ["--project", "tsconfig.jotform.json"]);
  process.exitCode = status === 0 ? run(fileURLToPath(new URL(`../.seed-build/scripts/${entry}`, import.meta.url)), args) : status;
} catch {
  console.error("Unable to compile the Jotform command. Run npm ci and npm run db:generate first.");
  process.exitCode = 1;
}
