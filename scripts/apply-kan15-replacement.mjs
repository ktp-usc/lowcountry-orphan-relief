import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const path = (name) => join(projectRoot, name);
const read = (name) => readFileSync(path(name), "utf8").replace(/^\uFEFF/, "");

try {
  if (!existsSync(path("package.json"))) {
    throw new Error("Extract the replacement zip into the project folder containing package.json.");
  }
  const manifest = JSON.parse(read("package.json"));
  for (const name of ["@prisma/client", "@prisma/adapter-pg", "dotenv", "prisma", "typescript"]) {
    if (!manifest.dependencies?.[name] && !manifest.devDependencies?.[name]) {
      throw new Error(`The existing Prisma project is missing the ${name} dependency.`);
    }
  }
  const scripts = { ...manifest.scripts };
  Object.assign(scripts, {
    "db:generate": "prisma generate",
    "db:validate": "prisma validate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "db:test": "prisma db execute --file prisma/tests/inventory-constraints.sql",
    "db:seed": "prisma db seed",
    "db:seed:demo": "prisma db seed -- --demo",
    "db:test:seed": "node scripts/test-inventory-seed.mjs",
    "db:check:seed": "node scripts/check-inventory-seed.mjs",
  });
  if (!scripts.postinstall?.includes("prisma generate")) {
    scripts.postinstall = scripts.postinstall
      ? `${scripts.postinstall} && prisma generate`
      : "prisma generate";
  }
  if (!scripts.build?.includes("prisma generate")) {
    scripts.build = `prisma generate && ${scripts.build || "next build"}`;
  }

  const ignoreLines = existsSync(path(".gitignore")) ? read(".gitignore").split(/\r?\n/) : [];
  const requiredIgnores = ["/generated/prisma/", "/.seed-build/", "*.tsbuildinfo", ".vercel", ".env*", "!.env.example"];
  const managedIgnores = new Set([
    "/.seed-build/", ".seed-build/", "/.seed-build", ".seed-build",
    "/.seed-buiinfo", ".seed-buiinfo",
    ...requiredIgnores,
  ]);
  const cleaned = ignoreLines.filter((line) => !managedIgnores.has(line.trim()));
  while (cleaned.length && cleaned.at(-1).trim() === "") cleaned.pop();
  if (cleaned.length) cleaned.push("");
  cleaned.push(...requiredIgnores);

  const section = `### Seeding

Run \`npm run db:seed\` to seed the 35 real categories and exact prices from
the supplied inventory-management policy table for reporting year 2026.
Run \`npm run db:seed:demo\` to include fictional opening counts, submissions
and movements for both locations using those same categories and valuations.

The implementation is TypeScript in \`prisma/seed.ts\`. Both commands use
\`DIRECT_URL\` when set, otherwise \`DATABASE_URL\`. Repeated runs preserve
item IDs and existing inventory history. Reference names and prices are
updated to match the supplied table. The SQL migration and constraints remain.

Prices retain the source units: diapers and pull-ups are $7.25 per pack of 30.
Unit and quantity metadata are retained in \`prisma/seed-data.ts\` for the
future normalizer. The source has no visible effective year; 2026 is the
chosen reporting year.

\`CHECK-KAN15.cmd\` applies this replacement and runs the seed commands twice,
checks the 35 valuations and demo fixtures, then runs constraints, lint and build.
\`npm run db:check:seed -- --demo\` verifies seeded records on an existing
development database. \`npm run db:test:seed\` provides the stricter integration
test for an initially empty, migrated test database.

See [KAN15-README.md](KAN15-README.md) for installation and review instructions.
`;
  let readme = existsSync(path("README.md")) ? read("README.md") : "# Inventory project\n";
  const start = readme.indexOf("### Seeding");
  if (start >= 0) {
    const next = readme.indexOf("\n### ", start + "### Seeding".length);
    const end = next < 0 ? readme.length : next;
    const before = readme.slice(0, start).trimEnd();
    const after = readme.slice(end).trimStart();
    readme = before + "\n\n" + section.trimEnd() + "\n" + (after ? "\n" + after : "");
  } else {
    readme = readme.trimEnd() + "\n\n" + section.trimEnd() + "\n";
  }

  let eslintConfig;
  if (existsSync(path("eslint.config.mjs"))) {
    eslintConfig = read("eslint.config.mjs");
    const missing = ["generated/prisma/**", ".seed-build/**"]
      .filter((pattern) => !eslintConfig.includes(`"${pattern}"`) && !eslintConfig.includes(`'${pattern}'`));
    if (missing.length > 0) {
      eslintConfig = eslintConfig.replace("globalIgnores([", "globalIgnores([\n" + missing.map((pattern) => `    "${pattern}",`).join("\n"));
    }
  }

  manifest.type = "module";
  manifest.scripts = scripts;
  writeFileSync(path("package.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(path(".gitignore"), cleaned.join("\n").trimEnd() + "\n");
  writeFileSync(path("README.md"), readme);
  if (eslintConfig !== undefined) writeFileSync(path("eslint.config.mjs"), eslintConfig);
  for (const name of ["prisma/seed.sql", "prisma/seed-demo.sql", "inventory-seed.patch", "tsconfig.tsbuildinfo"]) {
    rmSync(path(name), { force: true });
  }
  if (existsSync(path("npm")) && statSync(path("npm")).isFile() && statSync(path("npm")).size === 0) {
    rmSync(path("npm"));
  }
  rmSync(path(".seed-build"), { recursive: true, force: true });
  rmSync(path("generated/prisma"), { recursive: true, force: true });
  console.log(`Applied KAN-15 replacement to ${projectRoot}`);
  console.log("Seed commands configured; obsolete seeds and generated output removed.");
  console.log("Dependency versions, lockfile, environment files and other npm commands preserved.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to apply the replacement.");
  process.exitCode = 1;
}
