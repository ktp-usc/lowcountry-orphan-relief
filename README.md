# Lowcountry Orphan Relief Inventory

An internal inventory dashboard for Lowcountry Orphan Relief (LOR) and Midlands Orphan Relief (MOR). It combines opening counts, Jotform inventory submissions, and referral movements to show current stock and estimated value by location and reporting year.

## Features

- Inventory balances and estimated values by location and year
- Inventory and referral submissions imported from approved Jotform forms
- Google sign-in restricted to an email allowlist
- Starting inventory, reference catalogue, and valuation management

## Tech stack

Next.js 16 (App Router), React 19, TypeScript, PostgreSQL on Neon, Prisma 7, Better Auth, and TanStack Query.

## Local setup

Requirements: Node.js 20.19+, 22.12+, or 24+, and npm. Create a local environment file and fill in the variables needed for the services you will use:

```bash
cp .env.example .env
npm ci
```

Set `DATABASE_URL` to the PostgreSQL pooled connection URL and `DIRECT_URL` to the direct URL used for migrations. Keep `sslmode=require` on both. Configure `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (`http://localhost:3000` locally), Google OAuth credentials, and `ALLOWED_EMAILS` (comma-separated) for sign-in. Set `JOTFORM_API_KEY` to run Jotform inspection or imports. All are server-side variables; do not expose credentials with a `NEXT_PUBLIC_` prefix.

Apply migrations and seed the catalogue, then start the app:

```bash
npm run db:deploy
npm run db:seed
npm run dev
```

For a local database where you are authoring a schema change, use `npm run db:migrate -- --name describe_change` instead of `db:deploy`. See [Database](docs/database.md) for migration and seed details.

## Common commands

```bash
npm run dev                 # local development server
npm run build               # production build
npm run start               # serve a production build
npm run lint                # ESLint
npm run test:jotform:unit   # offline Jotform fetch tests
npm run test:referral       # referral normalization tests
npm run test:inventory:unit # offline inventory query tests
npm run test:normalize:inventory
npm run test:save:submission
```

Database-backed checks and additional import commands are documented in the relevant guides below. These command names match `package.json`.

## Documentation

- [Data import and Jotform tools](docs/data-import.md)
- [Database, migrations, seeding, and checks](docs/database.md)
- [Deployment, Google sign-in, and maintenance](docs/deployment.md)
- [Inventory calculations](docs/inventory-calculations.md) (created by the separate calculations documentation ticket)
