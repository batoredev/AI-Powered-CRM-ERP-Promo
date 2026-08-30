# Database Migrations

Migrations live in `db/migrations/`, numbered sequentially, applied in
order. `database-data-engineer` is the sole owner of this directory
(per `docs/ROUTER.md`).

## Running migration 0001 (creates the app_runtime role)

This migration takes a password variable so the role's password is never
committed to git:

    psql "$DATABASE_URL" -v app_runtime_password="$(openssl rand -base64 32)" -f db/migrations/0001_create_app_role.sql

Store the generated password as a Cloudflare Pages secret
(`APP_RUNTIME_DB_PASSWORD`) — the application connects to Postgres using
this role's credentials, never the Neon-provisioned superuser/owner
credentials from Task 2.
