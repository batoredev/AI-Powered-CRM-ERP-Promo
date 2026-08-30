import { describe, it, expect, afterAll } from 'vitest';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!); // owner connection — needs to read pg_class/pg_policy catalogs

// The one documented exception (Task 4): tenant is the root of tenancy,
// not tenant-scoped data, so it has no tenant-scoping policy.
const EXEMPT_TABLES = ['tenant'];

describe('RLS policy audit (CI gate)', () => {
  afterAll(async () => {
    await sql.end();
  });

  it('every non-exempt public table has FORCE ROW LEVEL SECURITY enabled', async () => {
    const rows = await sql`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `;
    const violations = rows.filter(
      (r) => !EXEMPT_TABLES.includes(r.relname) && (!r.relrowsecurity || !r.relforcerowsecurity),
    );
    expect(
      violations,
      `Tables missing FORCE ROW LEVEL SECURITY: ${violations.map((v) => v.relname).join(', ')}`,
    ).toHaveLength(0);
  });

  it('every non-exempt tenant-scoped table has a tenant_isolation policy', async () => {
    const rows = await sql`
      SELECT c.relname, EXISTS (
        SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation'
      ) as has_policy
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `;
    const violations = rows.filter((r) => !EXEMPT_TABLES.includes(r.relname) && !r.has_policy);
    expect(
      violations,
      `Tables missing a tenant_isolation policy: ${violations.map((v) => v.relname).join(', ')}`,
    ).toHaveLength(0);
  });

  it('app_runtime role has no BYPASSRLS or SUPERUSER privilege', async () => {
    const [role] = await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_runtime'`;
    expect(role.rolsuper, 'app_runtime must not be SUPERUSER').toBe(false);
    expect(role.rolbypassrls, 'app_runtime must not have BYPASSRLS').toBe(false);
  });
});
