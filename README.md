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
locations and selected by item and reporting year. This setup does not populate
item codes, opening counts, valuations, or Jotform records.

### Database checks

After applying migrations to a development/test database, run `npm run db:test`.
It checks duplicate handling, composite source references, multiple item
activities per submission, IN/OUT movement, starting-count uniqueness by
location, per-year valuation uniqueness, exact cents, quantity constraints,
and protected history. Fixture rows are rolled back; PostgreSQL sequences can
still advance. Run `npm run lint` and `npm run build` for application checks.
