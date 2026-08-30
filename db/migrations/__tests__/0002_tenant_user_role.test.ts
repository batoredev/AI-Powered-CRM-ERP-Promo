import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

// Connects as app_runtime specifically — the whole point is verifying
// what THIS role can and cannot see, not the superuser/owner role.
const sql = postgres(process.env.APP_RUNTIME_DATABASE_URL!);

describe('tenant isolation on app_user', () => {
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    // Use the owner connection for setup (inserting tenants themselves
    // is out of scope for RLS, per the migration's design).
    const setupSql = postgres(process.env.DATABASE_URL!);
    const [tenantA] = await setupSql`INSERT INTO tenant (name) VALUES ('Tenant A') RETURNING id`;
    const [tenantB] = await setupSql`INSERT INTO tenant (name) VALUES ('Tenant B') RETURNING id`;
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    await setupSql`INSERT INTO app_user (tenant_id, email, role) VALUES (${tenantAId}, 'a@example.com', 'owner')`;
    await setupSql`INSERT INTO app_user (tenant_id, email, role) VALUES (${tenantBId}, 'b@example.com', 'owner')`;
    await setupSql.end();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('a transaction scoped to tenant A cannot see tenant B users', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantAId})`;
      return tx`SELECT * FROM app_user`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(tenantAId);
  });

  it('a transaction with no tenant context set sees zero rows', async () => {
    const rows = await sql.begin(async (tx) => {
      return tx`SELECT * FROM app_user`; // no set_tenant_context call
    });
    expect(rows).toHaveLength(0);
  });

  it('tenant context does not leak across transactions on the same pooled connection', async () => {
    await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantAId})`;
    });
    const rows = await sql.begin(async (tx) => {
      return tx`SELECT * FROM app_user`; // fresh transaction, no context set
    });
    expect(rows).toHaveLength(0);
  });
});
