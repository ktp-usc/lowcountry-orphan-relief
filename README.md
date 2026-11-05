This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

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
Generated files in `generated/prisma` are excluded from git.

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

After configuring `.env` and applying migrations, run `npm run db:seed` to insert
15 starter item categories. Existing codes and display names are preserved.
Review the codes in `prisma/seed.sql` when defining the normalizer's mapping.
This command does not insert counts, valuations, submissions, or activities.

For fictional fixtures in a development/test Neon branch, run
`npm run db:seed:demo`. This first seeds the item catalogue, then runs
`prisma/seed-demo.sql`. Demo data consists of two `DEMO_` items, four opening
counts for 2026, two fictional unit valuations, and four `SEED_DEMO_` submissions
with eight IN/OUT activity rows across Lowcountry and Midlands. These are not
approved IRS values or real Jotform records.

Both scripts use `ON CONFLICT DO NOTHING` to preserve existing records.
Activities are inserted only for newly created demo submissions, so reruns
cannot append duplicate movements. Each SQL script runs in its own transaction;
if the demo step fails, its data rolls back but the earlier catalogue seed stays.
The commands run only when explicitly invoked.

Prisma runs `prisma/seed.sql` through its existing SQL execution command, using
`DIRECT_URL` when set and falling back to `DATABASE_URL`. No separate TypeScript
runner or new dependency is required. Keep `package.json` and `package-lock.json`
on the same dependency versions; run `npm ci` for a clean checkout.

If applying this SQL seed update over the earlier TypeScript seed bundle,
remove the unused `prisma/seed.ts` and leave `inventory-seed.patch` out of the PR.
That patch was only a transfer artifact and is not used by the application.
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
