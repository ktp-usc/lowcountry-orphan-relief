This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Jotform form inspection utility

A helper script is included at `scripts/jotform-inspect.mjs` to inspect the Jotform forms and submissions using the API key stored in `.env`.

### Requirements
- Node.js 18 or newer
- A valid `JOTFORM_API_KEY` value in the project root `.env` file

### Set up the API key
Create or update `.env` in the project root with:

```bash
JOTFORM_API_KEY=your_api_key_here
```

Do not print or commit the API key anywhere else. Keep it only in `.env`.

### Run the inspection script
```bash
node scripts/jotform-inspect.mjs
```

Optional paste-friendly output file:
```bash
node scripts/jotform-inspect.mjs --output jotform-output.txt
```

### Export a CSV of form fields
```bash
node scripts/jotform-export-fields.mjs 1234567890 --output exports/lor-fields.csv
```

The form ID is the numeric value at the end of the Jotform URL. Do not rely on form names or keyword matching.

### Inventory normalization utility

The project also includes a pure normalization helper at `lib/jotform/normalize-inventory.ts`.

This utility converts a Jotform inventory submission object into:
- normalized `SourceSubmission` metadata
- a list of inventory activity rows with item code, quantity, and direction (`IN`)

It does not hit the database or the Jotform API. It accepts:
- a Jotform form ID
- a submission object matching the Jotform API payload shape

Then it maps the configured field IDs to item codes, skips blank/zero values,
and rejects negative or otherwise invalid quantities.

#### Example usage
```bash
npx tsx -e "import { normalizeInventorySubmission, sampleInventorySubmissionLowcountry, sampleInventorySubmissionMidlands } from './lib/jotform/normalize-inventory.ts'; const lowcountry = normalizeInventorySubmission('241895593214161', sampleInventorySubmissionLowcountry); const midlands = normalizeInventorySubmission('250054265404145', sampleInventorySubmissionMidlands); console.log(JSON.stringify({ lowcountry, midlands }, null, 2));"
```

#### What the function returns
```ts
{
  submission: {
    jotformFormId: string;
    jotformSubmissionId: string;
    location: 'LOWCOUNTRY' | 'MIDLANDS';
    sourceType: 'INVENTORY';
    submissionDate: Date;
  },
  inventoryActivities: [
    {
      itemCode: string;
      quantity: number;
      direction: 'IN';
    }
  ]
}
```

### Inventory normalization workflow

This feature is the bridge between raw Jotform inventory responses and the Prisma inventory schema.

How it operates:
1. Input a Jotform inventory submission object and its form ID.
2. Match the form ID to the correct inventory mapping for either LOR or MOR.
3. Read each configured field ID and unwrap the real submitted value from the Jotform answer object.
4. Read quantity only from each field's `answer` value.
5. Skip blank or zero values, and reject invalid quantities (negative, text, non-integer/fraction).
6. Reject missing/invalid submission IDs and missing/invalid timestamps.
7. Convert the remaining values to canonical item codes from the seeded item catalog.
8. Return one normalized `SourceSubmission` record plus one `InventoryActivity` row per valid item.

This keeps the operation pure and deterministic: it never queries the database and never calls the Jotform API. The later database layer can take the returned object and insert it into Prisma in one transaction.

#### Registry and mapping source
The normalizer uses the sample payloads in `lib/jotform/sample-data/` as the source of truth for field IDs until a live Jotform export is available:
- `lor-inventory-submission.json` -> LOR form `241895593214161`
- `mor-inventory-submission.json` -> MOR form `250054265404145`

The item code names come from the seed catalog in `prisma/seed-data.ts`, which matches the `Item.code` field in `prisma/schema.prisma`.

#### Run the validation locally
```bash
cd "C:\Users\sunny\Documents\GitHub\lowcountry-orphan-relief"
npx tsc --noEmit
npx tsx -e "import { normalizeInventorySubmission, sampleInventorySubmissionLowcountry, sampleInventorySubmissionMidlands } from './lib/jotform/normalize-inventory.ts'; const lor = normalizeInventorySubmission('241895593214161', sampleInventorySubmissionLowcountry); const mor = normalizeInventorySubmission('250054265404145', sampleInventorySubmissionMidlands); console.log(JSON.stringify({ lor: { count: lor.inventoryActivities.length, first: lor.inventoryActivities.slice(0, 5) }, mor: { count: mor.inventoryActivities.length, first: mor.inventoryActivities.slice(0, 5) } }, null, 2));"
```

The expected result is a non-empty positive activity list for both locations and no silent inclusion of invalid values such as `0`, negative numbers, or non-integer quantities.

#### Run normalization unit tests
```bash
npm run test:normalize:inventory
```

This test uses fixtures shaped like `lib/jotform/sample-data/*.json` and asserts expected output for:
- multiple locations
- missing `answer` values
- blank and zero quantities (skipped)
- invalid quantities (text/fractions, rejected)
- missing/invalid submission IDs and timestamps (rejected)

### What the script does
- Reads the Jotform API key from `.env`
- Lists all available forms and form IDs
- Targets only the exact Jotform form IDs configured in `TARGET_FORM_IDS`
- Prints field names, IDs, and field types for each target form
- Prints recent submissions for the configured forms
- Filters output to the approved field IDs for each form
- Excludes a known remove list of sensitive fields by exact ID
- Saves a sanitized pasteable text file when `--output` is used

### Safety rules
- Keep all field selection by exact Jotform field ID, not by keyword match
- Ignore other forms unless their exact IDs are added to the config
- Remove or hide names, locations, ages, and other personal identifiers before sharing output in Google Docs
- Keep the approved list narrow and conservative until the team confirms the exact safe columns

## Jotform submissions

Set `JOTFORM_API_KEY` in the project's ignored `.env` file to a key that can read
the form. For EU or HIPAA accounts, set `JOTFORM_API_BASE_URL` as shown in
`.env.example`. Keep these variables server-only.

After `npm ci`, run the read-only live test with the numeric form ID:

```bash
npm run --silent test:jotform -- YOUR_FORM_ID
```

It prints only the unique submission count and earliest/latest `created_at`
timestamps. Empty forms show `Submissions: 0` and `Date range: none`. If any
submission lacks a supported timestamp, the date range is `unavailable`.
Timestamps are displayed as supplied by Jotform without assuming a timezone;
answers, personal details, and the API key are never printed. Errors go to
stderr and exit with a nonzero status.

Server code can import `fetchSubmissions` from
`@/lib/jotform/fetch-submissions` and call `await fetchSubmissions(formId)`.
The function returns raw submission objects, requests pages of up to 1,000
records until an empty page, and rejects on HTTP/API errors, invalid payloads,
timeouts, or a repeated page that makes no progress. It does not save or
normalize records. Like offset pagination generally, it does not provide a
snapshot if submissions are added or deleted during retrieval.

Run offline automated checks with `npm run test:jotform:unit`; they use mock
responses and need no Jotform key. Scripts use native TypeScript loading when
available and the existing TypeScript dev dependency on Node 20, so no new
dependency or lockfile update is required. API reference: [Jotform API](https://api.jotform.com/docs/).

## Google Sheets reader

`readSheet(source, { limit })` in `lib/sheets/read-sheet.ts` is a read-only Google
Sheets API hook. It returns `{ sourceKey, rows }`, where each row contains its
actual 1-based spreadsheet row number, a string-valued map keyed by the original
headers, and `cancelled`. Returned values are limited to Submission ID,
Submission Date and the answer columns mapped in `lib/sheets/mappings.ts`.
This includes male/female shoe type fields needed for sock classification;
names, contact details, notes and unrelated columns are neither requested nor
returned. The reader does not normalize requests, call Jotform or write to the
database. Shared contracts live in `lib/sheets/types.ts`.

Set `GOOGLE_SERVICE_ACCOUNT_JSON` in the ignored `.env.local` or `.env` file to
the entire service-account JSON object. Use a single-quoted dotenv value and
preserve JSON's escaped `\n` characters in `private_key`. Enable the Google
Sheets API and share the four documents with the service account as **Viewer**.
The OAuth scope is `https://www.googleapis.com/auth/spreadsheets`; the reader
only performs read operations. Existing process variables take precedence over
`.env.local`, then `.env`. Keep these credentials server-only and out of git.

```bash
npm run test:sheets
npm run inspect:sheets -- --limit 2
npm run inspect:sheets -- --all
```

Inspection defaults to five physical data rows per source. `--limit N` bounds
rows after the header, including empty/cancelled rows; ignored empty rows do not
cause replacement reads. The script prints only each source key and its active
and cancelled counts, continues to later sources after a failure, and exits
nonzero if any source fails. `--all` explicitly reads the full configured tabs.
It needs no database or Jotform credentials. Run
`npx tsc --noEmit -p tsconfig.sheets.json`, lint and build for type/application
checks after installing dependencies and generating the Prisma types.

`SHEET_SOURCES` contains the spreadsheet and tab IDs from the client notes.
All four sources use the `Submission Date` header. The separate MOR referral
`Date` column and its unlabeled first column are not used.

The referral cancellation color is configured as `#ffff00` and checked against
the effective background of the Submission ID cell only. Effective styles,
theme colors and legacy RGB fills are supported; cancelled rows remain in the
result. Confirm the configured color against a real cancelled referral with
`npm run inspect:sheets -- --all`.

Submission IDs must be plain-text digit strings. Numeric cells, formulas,
scientific notation and already-rounded IDs are rejected with a row number;
formatting a rounded number as text cannot restore its original ID. Blank cells
remain `""`, internal positions are preserved, and completely empty rows are
ignored. Missing/duplicate headers, repeated submission IDs, cell errors and
failed requests reject the source without returning partial results. A bounded
read checks duplicates only within its selected rows. Reads are paged, not an
atomic snapshot; avoid editing/reordering the sheet during a read.

Offline tests use fictional API responses for all four source kinds, including
blank cells, large IDs, cancellation fills, paging, auth and safe CLI output.
The live inspection prints only source keys and active/cancelled counts.

Repeated submission IDs within a source keep the first occurrence and skip later occurrences, including across pages. Warnings identify the source, submission ID, and kept/skipped row numbers. Duplicate column headers still cause an error.
## Import Jotform submissions

`lib/jotform/forms.ts` configures the four approved forms, locations and source
kinds. `importSubmissions(client, { limitPerForm })` fetches each form, uses its
normalizer and calls KAN-18's `saveSubmission`. Set `JOTFORM_API_KEY` and
`DATABASE_URL` (or `DIRECT_URL`) in `.env.local`/`.env`; existing process variables
win. Run migrations and seed the item catalogue before importing.

```bash
npm run import:jotform -- --limit 2
npm run import:jotform -- --all
npm run test:jotform:import
npm run check:jotform:import -- --limit 2
```

`--limit 2` fetches and attempts at most two records **per form**, including
malformed records (eight total), bounding the API requests themselves. Repeat it to skip existing
source IDs. Full imports require explicit `--all`. No database reset, migration
or seeding happens automatically. Timezone-less timestamps use `America/New_York`.

The command prints JSON totals `saved`, `skipped`, `failed` and separate lists
`formErrors: [{ formId, message }]` and
`submissionErrors: [{ formId, submissionId, message }]`. A failed fetch cannot
count unknown submissions in `failed`; it appears only in `formErrors`. All
later submissions/forms are attempted. Any failure gives exit status 1 after
processing finishes. Answers, credentials and raw database errors are not printed.

The importer opts into the fetcher's `onInvalidSubmission` reporting mode. A
malformed API record becomes a submission error and does not stop other records
from that form or later pages. Errors without a usable string ID use `unknown`
and identify the API record position in the message. Ordinary fetch calls stay
strict by default; HTTP, response-envelope and pagination failures are form
errors. The live check replays fetch-validation failures along with its captured
records, so repeated runs retain identical failure totals.

`test:jotform:import` runs offline fictional cases, including seeded randomized
batches. The live checker accepts limits of 1–5 per form, imports the exact same
real sample twice and compares persisted metadata and activities. Real sample
imports remain in the database. Its separate fictional invalid-then-valid tests
run in a transaction and leave no test rows. The live check is successful only
when its final `PASS` line appears.

The live checker verifies import behavior and can report
`passed-with-source-data-issues` for confirmed negative/fractional counts or
missing clothing selections. It still verifies accepted rows, rejected-row
absence and unchanged repeat imports, and requires successful inventory and
referral saves. Those rejected records remain failed and need source review;
the regular import command continues to exit with status 1 when any records fail.
Unexpected failures, missing catalogue items and incorrect database results fail
the live check.

## Inventory database

The inventory ledger uses Prisma ORM 7.10.1 and PostgreSQL on Neon. Use Node
20.19+, 22.12+, or 24+ and TypeScript 5.4+ (the Node 21 and 23 lines are not supported).

### Local setup

1. Run `npm install`. This installs Prisma and generates the client. Commit the
   resulting `package-lock.json` with the dependency changes.
2. Copy `.env.example` to `.env` if `.env` does not already exist. Set
   `DATABASE_URL` to the Neon pooled PostgreSQL connection string for app
   connections. Set `DIRECT_URL` to the direct, non-pooler URL for migrations;
   preserve `sslmode=require` on both. Prisma migration commands fall back to
   `DATABASE_URL` if `DIRECT_URL` is unset. `.env` is ignored by git;
   `.env.example` contains no credentials.
3. Run `npm run db:validate` and `npm run db:generate`.
4. Run `npm run db:deploy` to apply the included initial migration to the
   configured database. For subsequent schema changes, use
   `npm run db:migrate -- --name describe_change` against a development database.
5. Run `npm run build`. Prisma Client is also generated automatically during builds.

Set the same server-only `DATABASE_URL` environment variable in the deployment
environment. Never use a `NEXT_PUBLIC_` variable for database credentials.
Import the shared client from `@/lib/prisma` in server code running on the Node.js
runtime. The PostgreSQL TCP adapter is not intended for Next.js Edge routes.
Generated files under `generated/` are excluded from git.
`npm run build` runs `prisma generate` first so deployment environments recreate
the Prisma client before Next.js compilation.

### Normalized records

| Model | Stored data | Uniqueness |
| --- | --- | --- |
| `Item` | Canonical item code and display name | Item code |
| `SourceSubmission` | Form/submission IDs, location, source type, submission timestamp | Form ID + submission ID |
| `InventoryActivity` | One item movement, positive quantity, IN/OUT direction | Primary ID |
| `StartingInventory` | Opening quantity by item, reporting year, and location | Item + year + location |
| `ItemValuation` | Estimated USD value per unit | Item + year |

Locations are `LOWCOUNTRY` and `MIDLANDS`; source types are `INVENTORY` and
`REFERRAL`. Both locations share these tables. Activity location and timestamp
come from the related source submission rather than being duplicated.

Import opening counts from a JSON array with
`npm run import:starting-inventory -- path/to/starting-inventory.json`.
The expected record shape is shown in
[`examples/starting-inventory.example.json`](examples/starting-inventory.example.json).
The importer requires a configured `DATABASE_URL`, validates every item code
and location before writing, and skips records already present for that item,
year and location.

Jotform IDs are strings to avoid JavaScript integer precision loss. Each
activity references its source through **both** `jotformFormId` and
`jotformSubmissionId`, which must match the same submission. This also permits
the same submission ID in different forms without an ambiguous foreign key.

The normalizer should create a source submission and its activities together
in one transaction. The composite unique constraint rejects a repeated source
submission, preventing a webhook retry from creating another source row. The
importer must treat that duplicate as already imported and must not append
activities to the existing row on a retry. Importer/webhook code is separate
from this schema setup.

Activity quantity is a positive magnitude: an `OUT` activity with quantity 3
means subtract 3, not store -3. Starting quantities and valuations may be zero
but cannot be negative. These checks are enforced by the SQL migration because
Prisma's schema language cannot express CHECK constraints. Use migrations rather
than `prisma db push` so these checks are installed. `valuePerUnit` uses
`Decimal(12, 2)` to preserve USD cents; use Prisma Decimal arithmetic when
calculating monetary totals. Referenced items and sources cannot be deleted
while their inventory records exist.

Current count is the starting count plus IN quantities minus OUT quantities
for the selected reporting period and location. Valuations are shared across
locations and selected by item and reporting year. Migrations create the schema;
the optional seed commands below populate initial records.

### Seeding

Run `npm run db:seed` to seed the 35 real categories and exact prices from
the supplied inventory-management policy table for reporting year 2026.
Run `npm run db:seed:demo` to include fictional opening counts, submissions
and movements for both locations using those same categories and valuations.

The implementation is TypeScript in `prisma/seed.ts`. Both commands use
`DIRECT_URL` when set, otherwise `DATABASE_URL`. Repeated runs preserve
item IDs and existing inventory history. Reference names and prices are
updated to match the supplied table. The SQL migration and constraints remain.

Prices retain the source units: diapers and pull-ups are $7.25 per pack of 30.
Unit and quantity metadata are retained in `prisma/seed-data.ts` for the
future normalizer. The source has no visible effective year; 2026 is the
chosen reporting year.

`npm run db:check:seed -- --demo` verifies seeded records on an existing
development database. `npm run db:test:seed` runs both seed modes repeatedly
and verifies their records and repeatability on a migrated development database.
It supports existing data and does not reset the database.
`npm run db:test:inventory` verifies the year/location inventory query against
the seeded demo records for both locations. Transactional fixtures also check
UTC year boundaries, multiple additions/subtractions, zero and missing opening
counts, zero valuations and missing valuations; those fixtures are rolled back.
`npm run test:inventory:unit` runs the query's offline fixture tests without a
database. Both test commands compile the query and generated client first, so
they run on every Node version supported by this project.

`getInventory(year, location)` returns `itemName`, `initialCount`, `itemsAdded`,
`itemsSubtracted` and `valuePerUnit` for each item. An item without a valuation for the requested year causes
an explicit error instead of being silently omitted. Missing opening counts and
activity produce zero. The reporting year uses UTC boundaries.

Run `npm run check:inventory` to validate the schema, generate the client, apply
all pending migrations, run seed tests and valuation checks, run database
constraint checks, lint, and build. It runs the complete sequence twice on the
same configured development/test database, then compares row counts and content
fingerprints for all five inventory tables. Any change on the second pass
fails the check. PostgreSQL sequence positions are excluded because rolled-back
constraint fixtures and upserts can consume sequence values without adding rows.

### Database checks

After applying migrations to a development/test database, run `npm run db:test`.
It checks duplicate handling, composite source references, multiple item
activities per submission, IN/OUT movement, starting-count uniqueness by
location, per-year valuation uniqueness, exact cents, quantity constraints,
and protected history. Fixture rows are rolled back; PostgreSQL sequences can
still advance. Run `npm run lint` and `npm run build` for application checks.

### Notes
This script is meant for local inspection and validation. It does not write or store any secret outside of `.env`.

### Submission import helper

`lib/inventory/save-submission.ts` persists normalized importer output using Prisma.

Behavior:
- Resolves each activity `itemCode` to `Item.id` from the `Item` table.
- Throws when any code is missing, and does not save that submission or any of
  its activities.
- Saves `SourceSubmission` and `InventoryActivity` rows in one transaction.
- Enforces source-direction consistency (`INVENTORY` -> `IN`, `REFERRAL` -> `OUT`).
- Skips existing `jotformFormId + jotformSubmissionId` combinations.
- Returns either `saved` (with source ID and activity count) or `skipped`.

Run importer unit tests:
```bash
npm run test:save:submission
```

Run the real Prisma integration test against a non-production database:
```bash
INTEGRATION_DATABASE_URL=postgresql://... npm run test:save:submission:integration
```

The integration test uses the generated Prisma client, writes one uniquely tagged
submission, verifies it through Prisma reads, tests duplicate skip and invalid
item-code rejection, then deletes only its own test rows.
