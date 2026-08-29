# Neon Setup Notes

## Provisioning

1. Neon project created by the user via console.neon.tech (region:
   ap-southeast-1). Connection string supplied directly.
2. Stored as `DATABASE_URL` in `.env.local` (gitignored, never committed).
   For deployed environments, set as a Cloudflare Pages secret via
   `wrangler pages secret put DATABASE_URL`.
3. Connectivity verified 2026-08-29 via a one-off Node script using the
   `postgres` npm package (no local `psql`/`pg` CLI available in this
   environment) — confirmed live PostgreSQL 18.6 instance reachable.

## Hyperdrive

Created via:
```
npx wrangler hyperdrive create ai-crm-erp-db --connection-string="$DATABASE_URL"
```
Returned Hyperdrive config ID `ad7c15ef18114a7aa90f175f88dd3f24`, added to
`wrangler.toml` as the `HYPERDRIVE` binding. `wrangler` was already
authenticated to a real Cloudflare account in this environment (verified
via `wrangler whoami`), so this was provisioned directly rather than
requiring separate manual dashboard steps.

## CI database

Not yet provisioned. CI requires its own Neon branch/database with
migrations applied, plus its connection strings and a test JWT secret
added as GitHub Actions repository secrets: `CI_DATABASE_URL`,
`CI_APP_RUNTIME_DATABASE_URL`, `CI_SESSION_JWT_SECRET`. This is an
account-setup step for whoever has repo admin access on GitHub — not
completed as part of Task 2/8, flagged for follow-up before Task 8's CI
workflow can actually run in GitHub Actions (it will still commit and be
correct locally, just won't pass in CI until these secrets exist).
