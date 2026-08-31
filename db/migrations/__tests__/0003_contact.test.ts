import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const sql = postgres(process.env.APP_RUNTIME_DATABASE_URL!);
const setupSql = postgres(process.env.DATABASE_URL!);

describe('contact tenant isolation', () => {
  let tenantAId: string;
  let tenantBId: string;
  let contactAId: string;

  beforeAll(async () => {
    const [tenantA] = await setupSql`INSERT INTO tenant (name) VALUES ('Contact Test Tenant A') RETURNING id`;
    const [tenantB] = await setupSql`INSERT INTO tenant (name) VALUES ('Contact Test Tenant B') RETURNING id`;
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    const [contactA] = await setupSql`INSERT INTO contact (tenant_id, full_name, email) VALUES (${tenantAId}, 'Alice Test', 'alice@example.test') RETURNING id`;
    contactAId = contactA.id;
    await setupSql`INSERT INTO contact (tenant_id, full_name, email) VALUES (${tenantBId}, 'Bob Test', 'bob@example.test')`;
  });

  afterAll(async () => {
    await setupSql`DELETE FROM contact WHERE tenant_id IN (${tenantAId}, ${tenantBId})`;
    await setupSql`DELETE FROM tenant WHERE id IN (${tenantAId}, ${tenantBId})`;
    await setupSql.end();
    await sql.end();
  });

  it('a transaction scoped to tenant A sees only tenant A contacts', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantAId})`;
      return tx`SELECT * FROM contact`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(contactAId);
  });

  it('email lookup respects tenant isolation', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantBId})`;
      return tx`SELECT * FROM contact WHERE email = 'alice@example.test'`;
    });
    expect(rows).toHaveLength(0);
  });
});
