import postgres from 'postgres';

let sqlInstance: postgres.Sql | null = null;

/**
 * The single Postgres connection pool for the application. Always
 * connects as app_runtime (never a superuser/owner role) — enforced by
 * which connection string is configured in the environment, not by this
 * function, which is why db/README.md documents the required setup.
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
