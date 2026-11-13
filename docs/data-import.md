# Data import and Jotform tools

## Configured sources

`lib/jotform/forms.ts` is the registry used by the importer. It lists four approved sources:

| Form ID | Location | Source kind |
| --- | --- | --- |
| `241895593214161` | Lowcountry | Inventory |
| `250054265404145` | Midlands | Inventory |
| `261498369429070` | Lowcountry | Referral |
| `261526295444158` | Midlands | Referral |

The registry determines which forms are fetched and which normalizer is used. Inventory field mappings are in `lib/jotform/normalize-inventory.ts`; referral mappings are in `lib/jotform/normalize-referral.ts`. Sample payloads are under `lib/jotform/sample-data/`. Use exact form and field IDs when updating mappings.

## Environment

Set `JOTFORM_API_KEY` in `.env` or `.env.local`. It must be able to read the configured forms. The default API endpoint is `https://api.jotform.com`; set `JOTFORM_API_BASE_URL` to the appropriate EU or HIPAA endpoint when required. For database imports, also configure `DATABASE_URL` and, if applicable, `DIRECT_URL`. These values are server-only.

## Inspection utilities

Inspect configured form metadata and recent submissions:

```bash
node scripts/jotform-inspect.mjs
node scripts/jotform-inspect.mjs --output jotform-output.txt
```

The inspector targets the exact configured IDs, excludes the known funds request form and removed field IDs, and can write a sanitized text report. Treat all output as potentially sensitive: review it and remove personal details before sharing.

Export a form's field list to CSV:

```bash
node scripts/jotform-export-fields.mjs 241895593214161 --output=exports/lor-fields.csv
```

Run the read-only live fetch check with a numeric form ID. It prints a submission count and date range without printing answers or personal details:

```bash
npm run --silent test:jotform -- 241895593214161
```

`fetchSubmissions` in `lib/jotform/fetch-submissions.ts` is the server-side paginated fetch utility. It returns raw submission objects and does not persist or normalize them. See [Jotform's API reference](https://api.jotform.com/docs/).

## Importing submissions

Apply migrations and seed the item catalogue first; imports need the catalogue to resolve item codes.

```bash
npm run import:jotform -- --limit 2
npm run import:jotform -- --all
npm run test:jotform:import
npm run check:jotform:import -- --limit 2
```

`--limit 2` attempts at most two records per form, including malformed records. `--all` opts into a full import. Imports do not run migrations, reset the database, or seed it. Existing form/submission IDs are skipped on repeat runs. The importer continues across records and forms after failures, then exits nonzero if any failures occurred. Its JSON result separates saved, skipped, and failed totals from form-level fetch errors and submission-level errors. A fetch failure cannot report an unknown number of records as failed.

The offline `test:jotform:import` suite uses fictional cases and mock data. The live checker imports the same real sample twice and compares persisted values; those sample imports remain in the database. Its fictional failure cases run transactionally and leave no test records. A successful live check ends with `PASS`; it can report `passed-with-source-data-issues` for known rejected source values while still validating accepted rows and repeat-import behavior. Any source data issues still cause the normal import command to exit nonzero.

Malformed API submissions are reported and skipped while later records continue. HTTP, invalid response-envelope, and pagination failures are reported at form level. Timezone-less submission timestamps are interpreted in `America/New_York`. Pagination does not provide a snapshot if records are added or deleted during retrieval.

## Starting inventory import

Opening counts can be imported from JSON:

```bash
npm run import:starting-inventory -- path/to/starting-inventory.json
```

Use [`../examples/starting-inventory.example.json`](../examples/starting-inventory.example.json) for the record shape. Every item code, location, year, and quantity is validated before writing. Existing item/year/location records are skipped; this command does not overwrite opening counts.

## Troubleshooting

- **Missing API key:** confirm `JOTFORM_API_KEY` is in `.env` or `.env.local` and available to the process.
- **Form not found or empty results:** confirm the numeric form ID belongs to the configured Jotform account and that the key can read it.
- **Unknown item code:** seed/update the catalogue before importing; check the mapping against `prisma/seed-data.ts`.
- **Submission rejected:** inspect the reported form/submission ID and source data. Do not change validation to accept malformed counts without reviewing the source.
- **Database URL or connection failure:** check `DATABASE_URL`, and for migrations/seed operations check `DIRECT_URL`, network access, and required SSL settings.
