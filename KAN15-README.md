# KAN-15 replacement

Extract **all files** directly into the project folder containing `package.json`:

```text
C:\Users\Sree\Desktop\LOR\lowcountry-orphan-relief
```

Choose to replace the existing files. Open that folder in VS Code. This archive
contains the complete KAN-15 seed implementation, Prisma configuration, generator
settings, unchanged initial migration and corrected SQL constraint test. It
supersedes the previous seed bundles.

## Apply and check

From the VS Code terminal in the project folder, run:

```powershell
.\CHECK-KAN15.cmd
```

This works from Windows CMD or PowerShell. Keep your existing `.env` files.
The seed uses `DIRECT_URL` first, falling back to `DATABASE_URL`; point that
URL at your development/test database. The command applies the update,
installs the existing locked dependencies, generates Prisma Client through
postinstall, applies pending migrations, and runs these checks:

1. The default seed twice, followed by verification of all 35 real categories
   and exact source-table prices for reporting year 2026.
2. The demo seed twice, followed by verification of four demo submissions,
   eight activities and opening records for both locations.
3. The SQL constraint test, ESLint and the production build.

The command stops on the first failure. A successful run ends with
`PASS: KAN-15 seed commands, valuation checks, constraints, lint and build.`
It can use an already seeded database. Existing unrelated records and older
seed rows are preserved; total database counts can therefore exceed 35 items.
The checks query the 35 source categories and the specific new demo IDs.
Existing opening counts are retained on reruns. No database reset is performed.

To apply configuration changes without installing packages or running any
database commands, use `APPLY-KAN15.cmd` instead.

## What application changes

The application script updates the database npm commands in `package.json`,
repairs `.gitignore`, replaces the README's old SQL-seeding section, and excludes
generated Prisma/seed output in the standard Next.js ESLint configuration.
Other npm scripts, including Jotform commands, are retained. Dependency
versions and `package-lock.json` are retained because no new package is needed.
It removes:

- `prisma/seed.sql`
- `prisma/seed-demo.sql`
- `inventory-seed.patch`
- Generated `tsconfig.tsbuildinfo`
- The empty stray file named `npm`, if present and empty
- Old generated Prisma Client and compiled seed output, regenerated during checks

The SQL migration and constraints remain. The seed uses the existing TypeScript
compiler; no `tsx` dependency is required. Generator settings explicitly emit
ESM-compatible `.js` imports, and the seed compiler includes the full generated
client. The constraint test accepts both PostgreSQL RESTRICT error codes only
for its two deliberate deletion assertions.

## Seed commands

| Command | Result |
| --- | --- |
| `npm run db:seed` | Real categories and valuations only |
| `npm run db:seed:demo` | Same real catalogue and valuations, plus fictional inventory fixtures |
| `npm run db:check:seed` | Verify the 35 categories and prices in an existing database |
| `npm run db:check:seed -- --demo` | Also verify the specific demo records and activity counts |
| `npm run db:test:seed` | Strict integration test requiring initially empty migrated inventory tables |

The strict `db:test:seed` check remains available for a separate fresh test
database. `CHECK-KAN15.cmd` uses the verification that supports existing data.

Prices come from the supplied "List of Counted Items & IRS Valuation" image
on page 3 of the [inventory-management policy](https://drive.google.com/file/d/1b84C5IE-74xe2U8v57pnLEveAr1-_6LE/view).
All 35 names and prices are in `prisma/seed-data.ts`. The source image has no
visible effective year; 2026 is the reporting year selected for this seed.

The source's units are retained: diapers and pull-ups cost $7.25 **per pack
of 30**, wipes cost $2.50 per pack, toiletries are per kit, and school supplies
are per bookbag/backpack. Unit and quantity metadata are retained in the data
file; the database stores category names and quoted prices using the existing
schema. Future Jotform normalization must use those same pricing units.

Demo counts use men's tops and children's tops. Sample counts, submissions
and activity quantities are fictional; category names and valuations are real.

For another reporting year, explicitly choose it:

```cmd
npm run db:seed -- -- --year 2027
npm run db:seed:demo -- --year 2027
npm run db:check:seed -- --demo --year 2027
```

## Commit the complete update

After the check command passes, inspect all changes in VS Code Source Control:

```cmd
git branch --show-current
git status --short --untracked-files=all
git diff --check
```

Use the `KAN-15-Create-Prisma-Schema` branch for the KAN-15 PR. Include all new
`prisma/` and `scripts/` source files, configuration/README edits, the CMD
helpers, and the deletions listed above. Remove already tracked build artifacts
from Git's index; `.gitignore` alone does not untrack them. Environment files
and generated output should stay ignored. Review the staged file list before
committing so the main seed files are included along with the constraint test.

## Validation of this archive

Installer behavior, source syntax, the 35 transcribed prices, generator settings
and archive contents are checked in the authoring environment. Database execution,
TypeScript compilation, lint and build require your local environment because
package downloads and a test database connection are unavailable here. The
included CMD command runs those checks locally before you commit. No commit
or push is performed by this archive.
