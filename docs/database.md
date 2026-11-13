# Database

The app stores inventory in PostgreSQL using Prisma 7. The Prisma schema is `prisma/schema.prisma`; SQL migrations in `prisma/migrations/` also install database checks that Prisma's schema language cannot express. Use migrations rather than `prisma db push`.

## Connection setup

Copy `.env.example` to `.env` and set:

- `DATABASE_URL`: pooled PostgreSQL URL for application connections.
- `DIRECT_URL`: direct, non-pooler URL for migrations. Prisma commands fall back to `DATABASE_URL` if this is empty.

Preserve `sslmode=require` on both URLs. Keep database credentials server-only. Generated Prisma Client output is under `generated/prisma/` and is recreated by `npm install` and `npm run build`.

Use a supported Node.js version: 20.19+, 22.12+, or 24+.

## Schema overview

| Model | Purpose | Key uniqueness |
| --- | --- | --- |
| `Item` | Canonical item code and display name | `code` |
| `SourceSubmission` | Jotform form/submission IDs, location, source kind, timestamp | form ID + submission ID |
| `InventoryActivity` | Positive item movement quantity and IN/OUT direction | ID |
| `StartingInventory` | Opening count by item, year, and location | item + year + location |
| `ItemValuation` | Estimated USD value per unit by item and year | item + year |
| `User`, `Session`, `Account`, `Verification` | Better Auth identity records | Auth-specific IDs and unique fields |

Locations are `LOWCOUNTRY` and `MIDLANDS`; source kinds are `INVENTORY` and `REFERRAL`. Activity location and timestamp are inherited from the related source submission. Source IDs are strings and activities reference both IDs together, so identical submission IDs from different forms remain distinct.

Activity quantities are positive magnitudes; direction determines whether they add or subtract. Starting quantities and valuations may be zero but not negative. Valuations use `Decimal(12, 2)` for exact cents. Foreign keys protect referenced inventory history from deletion. These constraints are enforced in migrations.

## Migrations

For a new or already provisioned database, apply checked-in migrations with:

```bash
npm run db:deploy
```

When changing the schema against a development database, create and apply a migration with:

```bash
npm run db:migrate -- --name describe_change
```

Validate and regenerate the client as needed:

```bash
npm run db:validate
npm run db:generate
```

Do not use a production database for migration authoring. Deploy reviewed migrations with `db:deploy`.

## Seeding

Seed the reference catalogue and valuations:

```bash
npm run db:seed
```

The default reporting year is 2026 and the seed contains 35 catalogue categories and policy-table valuations. Use `-- --year YYYY` to choose another reporting year. The seed updates catalogue names and that year's valuations, while preserving existing item IDs and inventory history.

To add fictional opening counts, submissions, and movements for both locations on a development database:

```bash
npm run db:seed:demo
```

Demo quantities and movements are fictional; the catalogue and valuations remain the reference data. The command is repeatable and does not reset existing data.

Opening counts can also be loaded with `npm run import:starting-inventory -- path/to/file.json`. See [Data import](data-import.md) and [`../examples/starting-inventory.example.json`](../examples/starting-inventory.example.json).

## Database checks

Run the SQL constraint checks on a migrated development/test database:

```bash
npm run db:test
```

The fixtures check duplicate source handling, composite source references, multiple activities per submission, movement directions, starting-count and valuation uniqueness, exact cents, quantity constraints, and protected history. Fixture rows are rolled back, though PostgreSQL sequences may advance.

Other checks:

```bash
npm run db:check:seed -- --demo
npm run db:test:seed
npm run db:test:inventory
npm run check:inventory
```

`db:test:seed` exercises both seed modes and repeatability. `db:test:inventory` checks the location/year inventory query against demo records and rolls back its transactional fixtures. `check:inventory` runs schema validation, client generation, migrations, seed and valuation checks, constraints, lint, and build twice, comparing persisted inventory table contents between passes. Run database-backed checks only against a development or test database.

`getInventory(year, location)` returns each item's name, opening count, additions, subtractions, and unit valuation. Missing opening counts or activity count as zero; a missing valuation for the requested year is an error. Reporting year boundaries use UTC. See [Inventory calculations](inventory-calculations.md) for the separate calculation guide when it is added.
