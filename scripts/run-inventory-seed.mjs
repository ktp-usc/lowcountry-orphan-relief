import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function run(file, args) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Unable to start the seed process: ${result.error.message}`);
  }
  return result.status ?? 1;
}

try {
  // Use the project's locked TypeScript version on every supported Node line.
  // Compile first so a type error cannot fall through to stale compiled output.
  const compiler = require.resolve("typescript/lib/tsc.js");
  const status = run(compiler, ["--project", "prisma/tsconfig.seed.json"]);
  process.exitCode = status === 0
    ? run(fileURLToPath(new URL("../.seed-build/prisma/seed.js", import.meta.url)), process.argv.slice(2))
    : status;
} catch {
  console.error("Unable to load the TypeScript compiler. Run npm ci before seeding.");
  process.exitCode = 1;
}
