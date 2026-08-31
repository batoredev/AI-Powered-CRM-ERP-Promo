import postgres from 'postgres';

let sqlInstance: postgres.Sql | null = null;

/**
 * The single Postgres connection pool for the application. Always
 * connects as app_runtime (never a superuser/owner role) — enforced by
 * which connection string is configured in the environment, not by this
 * function, which is why db/README.md documents the required setup.
 *
 * ⚠️ DO NOT use this directly for tenant-scoped queries. ⚠️
 * `withTenant` (lib/db/with-tenant.ts) is the sole sanctioned entrypoint
 * for tenant-scoped data access — it wraps this connection in a
 * transaction and sets the tenant context via SET LOCAL before your
 * query runs. Calling getSql() directly and querying tenant-scoped
 * tables bypasses that context entirely, and RLS will (correctly) return
 * zero rows rather than leaking data — but the bug will look like "no
 * data" instead of failing loudly, which is its own hazard.
 *
 * Legitimate direct uses of getSql() are non-tenant-scoped operations
 * only (e.g. auditing pg_catalog, operating on the `tenant` table itself).
 *
 * TODO(future phase): once the first API route / agent-runtime caller is
 * added, consider restricting this export (e.g. only exporting withTenant
 * from an index barrel) or adding an eslint rule that forbids importing
 * getSql outside lib/db/. Not done now because there is no caller yet to
 * enforce against.
 */
export function getSql(): postgres.Sql {
  if (!sqlInstance) {
    const url = process.env.APP_RUNTIME_DATABASE_URL;
    if (!url) {
      throw new Error('APP_RUNTIME_DATABASE_URL is not set');
    }
    sqlInstance = postgres(url, { max: 10 });
  }
  return sqlInstance;
}
