# Daily Google Sheets reconciliation (KAN-36)

The four daily jobs reuse KAN-34's full reconciliation pipeline, including the
existing referral normalization fallbacks. Every run reads its entire source,
including old and cancelled rows. Rows absent from a Sheet are never treated as
cancellations. Duplicate submission IDs keep the first occurrence **before**
partitioning. Normalization and database work happen only for the selected
bucket. `BigInt(submissionId) % BigInt(bucketCount)` assigns exact string IDs;
IDs are never converted to JavaScript numbers and row positions do not affect
assignment.

Existing submissions and their activities are loaded in batches of at most
250 IDs. The fast comparison shares validation and metadata/activity comparison
code with `syncSubmission`: form/submission key, location, source type,
submission timestamp, and the multiset of item code/quantity/direction values.
Activity order and database IDs do not matter. Confirmed unchanged records
need no per-record transaction or item query. New/changed records, restorations,
and cancellations with remaining activities still use the existing atomic
transactional saver, with concurrency bounded at five. A failed batch lookup
fails that batch; it is never treated as an empty database.

## Hosting assumptions and activation

**Assumed, not verified:** Vercel Hobby, Fluid Compute enabled, Node.js runtime,
and a 300-second function maximum. There is no linked Vercel project/login in
this checkout, and the available Vercel plugin is disabled by the administrator.
The project owner explicitly approved continuing locally with these assumptions;
confirm the actual plan, Fluid Compute setting, deployment region, and deployed
function duration **before enabling the production schedule**. The route declares
`runtime = "nodejs"`, `maxDuration = 300`, `dynamic = "force-dynamic"`, and
`revalidate = 0`; every response sends `Cache-Control: no-store`.

Vercel documents a 300-second maximum on Hobby with Fluid Compute:
[function duration](https://vercel.com/docs/functions/configuring-functions/duration).
Hobby cron jobs run once daily and may start anywhere in the specified hour:
[cron pricing and timing](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing).
These published limits do not verify this project's settings. A production
Vercel deployment containing `vercel.json` registers its cron entries, but this
application does no scheduled sync work unless `SHEETS_CRON_ENABLED` is exactly
the string `true`. Missing, empty, `false`, `TRUE`, `1`, and whitespace-padded
values all remain disabled. The flag is server-only and evaluated on each
request after cron-secret authentication and before any Sheet/database work.
Authenticated disabled requests return HTTP **503** with
`{ "status": "disabled", "code": "SHEETS_CRON_DISABLED", "message": "Scheduled Sheets syncing is disabled." }`.
They do not initialize the database client, read Sheets, acquire/write leases,
write attempts or success timestamps, or return a successful sync summary.
Wrong/missing authorization still returns 401; a missing cron secret returns
503 for missing authentication configuration, independently of the flag.

Required **server-only production variables**:

- `DATABASE_URL`: the existing pooled PostgreSQL URL. `DIRECT_URL` is used by
  Prisma migrations where configured, and remains the local CLI fallback.
- `GOOGLE_SERVICE_ACCOUNT_JSON`: existing complete service-account JSON with
  Viewer access to all four Sheets. No Jotform key is needed.
- `CRON_SECRET`: already configured in Vercel. The handler requires the exact
  `Authorization: Bearer <secret>` header. Missing configuration returns 503;
  missing/incorrect authorization returns 401, with no sync or lease work.
- `SHEETS_CRON_ENABLED`: leave unset or set to `false` until the Vercel owner
  completes the checks below. Only the exact value `true` enables scheduled HTTP
  execution. Configure it in the Production environment and redeploy when
  changing it; setting the local shell variable does not configure Vercel.
- Keep all existing application authentication variables. The proxy bypass is
  limited to `/api/cron/sync-sheets/`; the cron handler authenticates these
  requests itself and other dashboard/API protection remains in place.

Deployment handoff for the Vercel owner on **November 13, 2026**:

1. Confirm the actual project and plan, Fluid Compute setting, deployment region,
   production environment variables, Node.js runtime, and 300-second Functions
   duration. These are assumptions locally, not verified production settings.
   Configure `DATABASE_URL`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `CRON_SECRET`, and
   the existing application auth variables. Initially leave
   `SHEETS_CRON_ENABLED` unset or set to `false`.
2. Review `prisma/migrations/20261112000000_sheet_sync_jobs/migration.sql` and
   check migration status for the target database. **This migration was already
   applied to the configured shared database on November 12, 2026**, before the
   code-freeze handoff instruction. It adds only `SheetSyncJob`,
   `SheetSyncAttempt`, indexes and checks. It does not modify submissions,
   opening counts, valuations or auth. No additional migration is needed for
   the feature flag. If using a different database, apply pending migrations
   through the approved process with `npm run db:deploy`; do not reset or seed.
3. Run the validation commands below and review known source validation failures.
   Deploy the frozen implementation with the flag disabled. Confirm an
   authenticated cron request returns 503/`SHEETS_CRON_DISABLED` and creates no
   new attempt or success timestamp. A request without the correct bearer secret
   must still return 401. No database or Sheets credentials are needed for the
   handler to return the disabled response, but they are required before enabling.
4. Confirm the deployed function's Node.js runtime and 300-second duration via
   the project's Functions settings and `vercel inspect <deployment-url> --json`
   (inspect the function timeout). The local Next.js build manifest records
   `maxDuration: 300`, which does not verify the deployed runtime/plan. Check
   deployment protection allows authorized Vercel cron requests. Confirm all
   four daily paths and UTC windows from the table below in the Cron Jobs UI.
5. After those checks, set **Production** `SHEETS_CRON_ENABLED=true` and redeploy.
   Verify the flag is present in the new deployment; older deployments retain
   their original environment. Use an authenticated request or the project's
   Run control to verify each source/bucket, one at a time after checking for an
   active lease. Inspect responses, Vercel logs, `SheetSyncAttempt` and
   `SheetSyncJob`. Successful full runs return 200 and advance success metadata.
   The last authorized full run reported 24 referral validation failures; such
   partial runs correctly return 500, record FAILED attempts, and do not claim
   success. The stricter selection validation described below may report
   additional invalid source values; no full live sync was rerun after that fix.
6. Confirm automatic daily invocations actually arrive at their scheduled
   windows, check `npm run status:sync:sheets`, and verify dashboard refresh
   timestamps. Local tests and manual runs do not prove Vercel cron delivery.

To disable future scheduled execution, set Production
`SHEETS_CRON_ENABLED=false` (or remove it) and redeploy. Existing in-flight runs
are not cancelled by an environment change; let them finish or their 330-second
leases expire before maintenance or partition changes. The existing manual
`npm run sync:sheets -- --limit N` and `--all` commands remain available while
scheduled execution is disabled. HTTP reruns of the cron endpoint always obey
the flag; only administrative local manual commands bypass it.

No Vercel login, project linking, manual deployment, or additional real-data sync
is part of the code-freeze work. The Vercel owner must complete production
verification and activation; automatic delivery, runtime configuration, and
Production environment values have not been verified from this checkout.

## Daily schedules and measurements

`lib/sheets/cron-config.ts` owns each source's bucket count. Each is currently
**one**: the optimized full-source measurements fit comfortably below 180 seconds.
`vercel.json` contains exactly one daily entry for each configured source/bucket:

| Source/bucket | Daily UTC window | Rows attempted | Seconds in two full runs, including Sheet reads |
| --- | --- | ---: | ---: |
| `lor-inventory/0` | 01:00–01:59 | 7,077 | 20.017 / 20.072 |
| `mor-inventory/0` | 03:00–03:59 | 2,654 | 7.099 / 6.859 |
| `lor-referral/0` | 05:00–05:59 | 1,879 | 10.865 / 8.589 |
| `mor-referral/0` | 07:00–07:59 | 708 | 5.904 / 6.560 |

Both runs measured locally on November 12, 2026 (America/New_York), against the complete
configured live Sheets and database, after batched comparisons were implemented.
Each row count includes cancellations and failed normalization attempts, after
first-occurrence duplicate handling. These are real full reconciliations, not
read-only estimates or newest-N samples, but they are **not Vercel production
latency guarantees**. Most existing rows were unchanged; a large backlog of
changed/new rows costs more because it still requires transactions. Neither
referral run was successful: each reported 12 validation failures (24 total,
including two invalid dates), while continuing through every other row. There
were no source read failures. Do not interpret a finished measurement as a
successful reconciliation when its summary contains failures.

The two-hour spacing reduces contention despite Hobby's hour-wide execution
windows. UTC schedules do not change for daylight saving. Because the jobs run
separately, the dashboard reflects each source at a different time; it is not a
single simultaneous daily snapshot.

Baby Blanket (`BABY_BLANKET`) and Care Kit Laundry Bags
(`CARE_KIT_LAUNDRY_BAGS`) are excluded from dashboard rows and summary totals,
and from its starting-count and valuation editors, for both locations and all
years. Their catalogue records and imported activities remain intact.

The dashboard shows separate **Last successful refresh** timestamps for inventory
and referrals for the selected location, in America/New_York time (EST/EDT).
These come from persisted successful sync history, independently of the selected
reporting year. Failed runs leave the prior successful timestamp unchanged. For
partitioned sources, every current bucket must have succeeded and the oldest
bucket's completion determines the displayed time. Sources without a successful
refresh timestamp are hidden. If both timestamps are missing or history is
unavailable (including before its migration), the entire indicator is hidden
without leaving extra spacing. The original `sync:sheets` CLI does not update
cron history; the explicit administrative tracked runner below does.

Rerun measurements with `npm run measure:sync:sheets`. This reconciles every
configured bucket, writes safe summaries to ignored
`exports/sheet-sync-measurements.json`, and exits nonzero on any source/row
failure. Existing local commands still work:

```bash
npm run sync:sheets -- --limit 2
npm run sync:sheets -- --all
```

The local CLI and measurement command intentionally remain direct tools without
cron run-history/leases. Do not run them concurrently with scheduled jobs or
partition changes. Prefer the authenticated endpoint for a tracked bucket rerun.

An administrator with the existing database and Sheets credentials can also
start tracked runs locally using the same leases, history, deadlines and full
coverage as the cron endpoint:

```bash
npm run sync:sheets:scheduled -- --all
npm run sync:sheets:scheduled -- --source lor-referral --bucket 0
```

This is a one-shot administrative manual run, not an installed daily scheduler.
Like the existing manual sync command it is unaffected by
`SHEETS_CRON_ENABLED`; it explicitly opts into the shared job executor with its
own in-process authentication. It neither reads nor changes the production
`CRON_SECRET` or deployment flag. A full initial tracked
run completed on November 12, 2026: both inventory jobs succeeded (7,077 and
2,654 rows); both referral jobs processed all rows (1,879 and 708) but recorded
12 validation failures each. The status command correctly reports those two
referral jobs as unhealthy, preserving their unsuccessful status.
Recurring daily runs begin only after deploying and activating the verified
Vercel project. The existing Vercel connection is disabled by the administrator,
and this checkout currently has no Vercel login/project link.

## Leases, failed runs and monitoring

`GET /api/cron/sync-sheets/<sourceKey>/<bucket>` authenticates, checks the exact
`SHEETS_CRON_ENABLED=true` switch, validates parameters against server
configuration, and awaits the complete reconciliation.
It returns source/bucket, elapsed milliseconds, processed-row count and the sync
summary. A complete successful run returns 200; partial/source/unexpected
failures return 500; invalid parameters return 404. Overlapping execution of
the same source/bucket returns 409 without running or releasing the active job.

Atomic PostgreSQL upsert acquires a database-backed lease with a random owner
and a 330-second expiry, using database time. Completion/release requires that
same unexpired owner. A stale execution cannot release a newer owner's lease or
record success. The pipeline shares a 270-second deadline across authentication,
Sheet requests, response-body reads, retry waits, pagination, bounded database
batches and writes, leaving time before Vercel's 300-second hard stop. HTTP
requests use at most the remaining budget (capped at 30 seconds per request).
A retry that would consume the remaining budget is rejected, and an expired
page read rejects the entire source rather than returning a partial result.
Any deadline overrun is unsuccessful. If the platform kills the function first,
the attempt remains `RUNNING`; monitoring treats an expired lease as interrupted,
and the next acquired run marks that old attempt `INTERRUPTED`. No background
process is launched, and an incomplete run never updates success metadata.

`SheetSyncJob` preserves last successful completion time, duration, processed-row
count and partition count. `SheetSyncAttempt` separately records every acquired
attempt, including status, timing, row count, safe summary and controlled error.
A failed attempt never overwrites the previous successful completion. Database
failures while acquiring or recording completion also return 500; a killed or
unconfirmed attempt must be investigated rather than assumed successful.

Run this read-only operational check after applying the migration:

```bash
npm run status:sync:sheets
```

It checks **every currently configured bucket**, including buckets with no job
row, and exits nonzero for missing/stale success (>26 hours), a changed partition
count without a new success, failed/interrupted attempts, or a run >=180 seconds.
It reports expired `RUNNING` attempts as interrupted even before the next run.
This is an operator check, not an externally installed alert service. Before the
first successful run, missing success is expected; current referral data errors
will keep those jobs unhealthy until resolved.

Inspect a particular attempt's safe validation details with Prisma Studio or a
read-only SQL query (use the source and bucket you are investigating):

```sql
SELECT "id", "startedAt", "completedAt", "status", "durationMs",
       "processedRows", "error", "summary"
FROM "SheetSyncAttempt"
WHERE "sourceKey" = 'lor-referral' AND "bucket" = 0
ORDER BY "startedAt" DESC
LIMIT 10;
```

Review Vercel invocation logs for HTTP failures, timeouts and `CAPACITY WARNING`.
Vercel does not retry failed cron calls, and delivery can be missed or duplicated:
[cron operations](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs).
Check history regularly or have the operations team wire the status command
into its existing external monitoring. A missing request cannot write a database
attempt, so checking time since last success is essential.

To rerun a failed/missed bucket while scheduled execution is enabled, use the
same authenticated endpoint. It also returns the explicit disabled response
when the flag is off, even for a manual HTTP request. Set
`PRODUCTION_ORIGIN` to the verified production origin and load `CRON_SECRET`
securely into your shell; do not paste secret values into source or command
history. For example:

```bash
curl --fail-with-body --max-time 310 \
  --header "Authorization: Bearer ${CRON_SECRET}" \
  "${PRODUCTION_ORIGIN}/api/cron/sync-sheets/lor-referral/0"
```

A 409 means another invocation still owns the lease: wait for it to finish or
expire and investigate its attempt. A timeout/disconnection does not establish
whether the server completed: inspect persisted history before retrying. Full
bucket reconciliation is idempotent; previously saved records are compared and
changed records are replaced transactionally, never appended as duplicate
submissions.

## Capacity and future partition changes

Any job taking >=180 seconds emits `CAPACITY WARNING` and monitoring flags it.
Re-measure after substantial growth or a large correction backlog. If a source
cannot safely fit below the target, increase **only that source's** count in
`SHEET_SYNC_BUCKET_COUNTS`, and add one daily `vercel.json` path for **every**
index from `0` through `count - 1` in the same change. Remove obsolete paths
when reducing counts. Stagger new jobs in distinct hours and re-measure every
final bucket. The schedule/config coverage test rejects missing or duplicate
entries.

Pause production cron execution and wait for active leases to finish/expire
before deploying a partition-count change; do not run old/new partition layouts
concurrently. Success history includes bucket count so old-layout success does
not imply that a new layout has completed. Old attempts remain as history;
monitoring checks the current configuration. Repartitioning reassigns IDs but
uses the same unique form/submission key, so it does not create duplicate rows.
All new submissions also map to exactly one bucket automatically. Rows remain
eligible for daily corrections, cancellation and restoration regardless of age.

Every bucket initially reads the complete Sheet before filtering. Increasing
bucket count therefore increases Sheet API requests proportionally. The reader
retries 429/503 responses at most twice with backoff/jitter or a short
`Retry-After` (up to 10 seconds); a longer quota wait or exhausted retries fails
the source without returning partial data. Spread jobs across hours, watch
Google's service-account quotas, and include full Sheet reading in capacity
measurements. Bucketing cannot fix a Sheet read that alone consumes the budget:
report that limitation and move the workload to a suitable worker/hosting plan
rather than introducing date/row cutoffs or silently reducing coverage.

## Validation of Sheet corrections

Unknown nonblank referral request selections are errors, so a typo such as
`Yse` cannot silently remove existing activity during reconciliation. The row
fails before database lookup/save and its previously saved activities remain
intact. Errors identify only the configured field ID/header, without echoing
the submitted answer. Binary request fields accept `Yes`, `No`, blank, `None`,
or `N/A` after trimming and case normalization; the latter four mean unselected.
Diaper and school fields accept those unselected values or their exact existing
mapped choices (`Diapers`, `Pull Ups`, and the two school bookbag/supplies
options). Explicit invalid classifications continue to fail, and the existing
missing-classification inference rules remain. Cancelled referrals still bypass
item/date validation after their submission ID is checked.

The reader preserves original header spelling. Both normalization and safe
submission-ID reporting now match mapped headers by trimmed, case-insensitive
names. Duplicate normalized names remain ambiguous and fail; renamed or missing
columns are not guessed from neighboring columns or labels.

Sheet timestamps accept the existing `YYYY-MM-DD H:mm:ss` Eastern convention,
as well as `T` separators, milliseconds, `Z`, and explicit `±HH:mm` offsets.
For example, `2026-11-01 01:30:00-04:00` and
`2026-11-01 01:30:00-05:00` distinguish the two fall-back occurrences of 1:30 AM.
Without an explicit offset, ambiguous/nonexistent Eastern times still fail.
Invalid dates and offsets also fail; no timestamp is guessed or silently shifted.

## Validation

```bash
npm run test:sheets:reader
npm run test:sheets
npm run test:sync:sheets
npm run test:sync:submission
npm run test:cron:sheets
node --import tsx --test tests/sheet-refresh-status.test.mjs
npm run test:inventory:unit
npm run test:inventory:math
npm run lint
npm run build
```

The new tests cover exact large-ID bucket assignment and future additions,
coverage after increasing counts, cancelled rows, filtering before normalization,
batched unchanged comparisons, changed/created/cancelled/restored records,
lookup failures, authorization, proxy behavior, invalid parameters, overlaps,
partial failures, capacity/deadline handling and rate limits. Regression tests
also pass actual reader output into normalization with case/space-varied
headers, protect saved activities from invalid corrections, exercise explicit
DST offsets, stop pagination/authentication/body/retry waits at the shared
deadline, and check calculation/summary contracts (including `valuePerUnit`).
Flag regression
checks cover default-off/exact-string behavior, no work or persistence when
disabled, authentication while disabled, the real HTTP route without database
credentials/network calls, and manual CLI execution while the flag is off. The existing
normalizer fallbacks are preserved.

For a completely local migration SQL check without shared-database credentials,
install the optional embedded PostgreSQL test engine outside the application
and point the test at that temporary installation:

```bash
npm install --prefix /tmp/lor-migration-test --no-save --no-package-lock @electric-sql/pglite@0.5.16
PGLITE_TEST_MODULE=/tmp/lor-migration-test/node_modules/@electric-sql/pglite/dist/index.js npm run test:migration:sheets:local
```

This was run successfully for the code-freeze handoff. It executes all migration
files in an in-memory PostgreSQL database, inserts fictional inventory/auth
fixtures before the scheduling migration, and verifies that the migration
preserves every fixture, creates the expected defaults/indexes, and enforces
partition, lease, status, and uniqueness constraints. It makes no network calls,
uses no shared database, and adds no application dependency or lockfile change.
It validates migration SQL locally, not Vercel runtime or deployment behavior.

For real PostgreSQL verification, set `INTEGRATION_DATABASE_URL` to an approved
PostgreSQL connection and run `npm run test:cron:sheets:integration`. This creates
a uniquely named isolated test schema, exercises concurrent leases and run
history plus real batched reconciliation/transactional preservation, and drops
only that schema in `finally`. It needs permission to create a schema and does
not apply migrations to or modify application tables. Without the variable, the
integration test is explicitly skipped. The test was run successfully against
an isolated schema in the configured database during implementation.

Code-freeze handoff status (November 12, 2026): disabled/default/exact-flag and
cron-secret behavior were tested offline, including the actual HTTP route with
no database credentials; manual sync behavior with the flag off was tested using
fictional rows. Dashboard/category, existing normalizers/readers/savers and
schedule coverage tests, local migration SQL checks, lint, and the production
build were checked locally. No additional full real-data sync was started during
this handoff. The shared database already has the scheduling migration from the
earlier authorized run. Production deployment, environment values, actual
Vercel settings, invocation timing and automatic daily delivery still require
verification by the Vercel owner; they have not been tested from this checkout.
