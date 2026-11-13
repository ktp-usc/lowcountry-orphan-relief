# Deployment and maintenance

## Vercel setup

Import the repository as a Next.js project in Vercel. The project uses the standard Next.js build; `npm run build` generates Prisma Client and runs `next build --webpack`. Use a supported Node.js version (20.19+, 22.12+, or 24+).

Configure the following server-side environment variables in Vercel for each environment that will run the app:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Pooled PostgreSQL connection for app requests |
| `DIRECT_URL` | Direct PostgreSQL connection for migration commands |
| `BETTER_AUTH_SECRET` | Secret used by Better Auth |
| `BETTER_AUTH_URL` | Canonical deployed app URL, including `https://` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ALLOWED_EMAILS` | Comma-separated emails permitted to create accounts |

Add `JOTFORM_API_KEY` and, when needed, `JOTFORM_API_BASE_URL` only to environments that run Jotform tools. Preserve `sslmode=require` in PostgreSQL URLs. Do not prefix secrets with `NEXT_PUBLIC_`.

Run `npm run db:deploy` against the target database as a deployment step before serving code that depends on a new schema. Apply the same reviewed migrations to staging and production; do not use `db:migrate` against production. Seed the reference catalogue with `npm run db:seed` when provisioning a database. Never run demo seeding in production.

## Google sign-in

Create a Google OAuth 2.0 web application client in Google Cloud Console. Set its authorized JavaScript origin to the deployed app origin and add this redirect URI:

```text
https://YOUR_DEPLOYMENT_HOST/api/auth/callback/google
```

Use the production host for production and the matching preview host for any preview environment where sign-in is required. Put the generated client ID and secret in the corresponding Vercel environment variables. Set `BETTER_AUTH_URL` to that environment's canonical URL. Locally, use `http://localhost:3000` and register `http://localhost:3000/api/auth/callback/google` as a development redirect URI.

The app always requests Google's account chooser, which is useful when testing multiple accounts.

## Allowed emails

Set `ALLOWED_EMAILS` to a comma-separated list of approved Google email addresses. Matching trims whitespace and ignores letter case. An empty value allows nobody to create an account. The restriction is enforced before Better Auth creates a user; changing the list affects new sign-ins/account creation without deleting existing user records.

After changing environment values in Vercel, redeploy the relevant environment so the running deployment receives them. Keep the allowlist narrowly scoped and review it when staff access changes.

## Maintenance

- Back up the PostgreSQL database using the database provider's supported process before production schema changes.
- Review migration SQL, then deploy it with `npm run db:deploy` before application code that requires it.
- Keep `DATABASE_URL` pooled for app requests and `DIRECT_URL` direct for database administration and migrations.
- Run `npm run db:seed` when intentionally updating reference catalogue values. This updates names and valuations for the selected reporting year; it does not reset history.
- Monitor deployment and database logs for failed sign-ins, import errors, and database connectivity issues. Do not include API keys, raw form answers, or personal data in shared logs.
- Use [Data import](data-import.md) for Jotform inspection and sync procedures and [Database](database.md) for schema checks and seeding commands.
