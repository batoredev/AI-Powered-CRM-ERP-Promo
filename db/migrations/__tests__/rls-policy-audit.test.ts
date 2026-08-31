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
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
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
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
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

  it('tenant table specifically has RLS enabled but zero policies (exemption is by design, not by oversight)', async () => {
    // Per db/migrations/0002_tenant_user_role.sql: tenant is the root of
    // tenancy, not tenant-scoped data, so it gets ENABLE ROW LEVEL
    // SECURITY (RLS is "on") but deliberately no FORCE and no
    // tenant_isolation policy — a row's own id IS the tenant, so
    // scoping it via current_tenant_id() doesn't apply. This test exists
    // so that if that ever changes unexpectedly, it fails loudly instead
    // of the EXEMPT_TABLES skip silently covering for it.
    const [table] = await sql`
      SELECT c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = 'tenant'
    `;
    expect(table, 'tenant table must exist').toBeDefined();
    expect(table.relrowsecurity, 'tenant table must have RLS enabled').toBe(true);

    const policies = await sql`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenant'
    `;
    expect(
      policies,
      `tenant table must have zero policies (it is the tenancy root, not tenant-scoped data); found: ${policies.map((p) => p.policyname).join(', ')}`,
    ).toHaveLength(0);
  });
});
