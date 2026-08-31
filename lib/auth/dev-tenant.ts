import postgres from 'postgres';

/**
 * ⚠️⚠️⚠️ DEVELOPMENT-ONLY TENANT RESOLUTION — NOT REAL AUTH ⚠️⚠️⚠️
 * ================================================================
 *
 * This function exists solely because Phase 2B builds UI before Phase 6
 * (guided onboarding) or a real session/login system exists. It resolves
 * (creating on first call) a single well-known "Development Tenant" row
 * and returns its id, so UI screens have a tenant to render data for.
 *
 * This is NOT a security boundary and NEVER should be treated as one —
 * it does not check who is asking. Every call site of this function is a
 * marker for what must be replaced with real session-derived tenant
 * resolution (e.g. from a verified JWT via lib/auth/jwt.ts, once a login
 * flow exists) before this product handles real user data. Grep for
 * `getDevTenantId` when that work begins.
 *
 * WHY THIS DOES NOT USE lib/db/connection.ts's getSql() (app_runtime):
 * `tenant` has RLS enabled with deliberately NO policy (see
 * db/migrations/0002_tenant_user_role.sql) — tenant rows are reachable
 * only via explicit application logic (signup, admin), never via the
 * app_runtime role, which is NOBYPASSRLS by design (spec §3). That means
 * app_runtime can neither read nor create tenant rows at all — verified
 * against the real dev database while writing this function (SELECT
 * silently returns zero rows, INSERT throws
 * "new row violates row-level security policy for table tenant").
 * This function therefore opens its OWN connection using DATABASE_URL
 * (the Neon owner/superuser credential, dev-environment only), the same
 * variable the brief's own test file connects with directly. This is
 * exactly the kind of privileged, un-tenant-scoped access real signup/
 * admin code will eventually need — but until that code exists, THIS is
 * the one place in the app that reaches around app_runtime, and it must
 * stay that way: do not reuse this connection or this pattern for
 * anything else. When real auth lands, this whole file is deleted, not
 * generalized.
 */
const DEV_TENANT_NAME = 'Development Tenant';

let cachedDevTenantId: string | null = null;
let devSqlInstance: postgres.Sql | null = null;

function getDevSql(): postgres.Sql {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'getDevTenantId() must never run in production — this dev-only tenant ' +
      'bootstrap path uses privileged database access with no auth check. ' +
      'If you are seeing this in production, a call site was not migrated ' +
      'to real auth before deploy.'
    );
  }
  if (!devSqlInstance) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set (required by dev-only getDevTenantId)');
    }
    devSqlInstance = postgres(url, { max: 1 });
  }
  return devSqlInstance;
}

export async function getDevTenantId(): Promise<string> {
  if (cachedDevTenantId) return cachedDevTenantId;

  const sql = getDevSql();
  const existing = await sql`SELECT id FROM tenant WHERE name = ${DEV_TENANT_NAME}`;
  if (existing.length > 0) {
    cachedDevTenantId = existing[0].id;
    return cachedDevTenantId!;
  }

  const [created] = await sql`INSERT INTO tenant (name) VALUES (${DEV_TENANT_NAME}) RETURNING id`;
  cachedDevTenantId = created.id;
  return cachedDevTenantId!;
}
