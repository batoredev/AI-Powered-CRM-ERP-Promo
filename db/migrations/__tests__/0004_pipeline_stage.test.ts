import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const sql = postgres(process.env.APP_RUNTIME_DATABASE_URL!);
const setupSql = postgres(process.env.DATABASE_URL!);

describe('pipeline_stage tenant isolation', () => {
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    const [tenantA] = await setupSql`INSERT INTO tenant (name) VALUES ('Stage Test Tenant A') RETURNING id`;
    const [tenantB] = await setupSql`INSERT INTO tenant (name) VALUES ('Stage Test Tenant B') RETURNING id`;
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    await setupSql`INSERT INTO pipeline_stage (tenant_id, name, sort_order) VALUES (${tenantAId}, 'Lead', 0), (${tenantAId}, 'Qualified', 1), (${tenantAId}, 'Won', 2)`;
    await setupSql`INSERT INTO pipeline_stage (tenant_id, name, sort_order) VALUES (${tenantBId}, 'Lead', 0)`;
  });

  afterAll(async () => {
    await setupSql`DELETE FROM pipeline_stage WHERE tenant_id IN (${tenantAId}, ${tenantBId})`;
    await setupSql`DELETE FROM tenant WHERE id IN (${tenantAId}, ${tenantBId})`;
    await setupSql.end();
    await sql.end();
  });

  it('tenant A sees exactly its 3 stages, in sort order', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantAId})`;
      return tx`SELECT name FROM pipeline_stage ORDER BY sort_order`;
    });
    expect(rows.map((r) => r.name)).toEqual(['Lead', 'Qualified', 'Won']);
  });

  it('the UNIQUE(tenant_id, name) constraint allows the same stage name across different tenants', async () => {
    // Both tenant A and tenant B have a 'Lead' stage — proves the unique
    // constraint is tenant-scoped, not global.
    const rows = await setupSql`SELECT tenant_id, name FROM pipeline_stage WHERE name = 'Lead'`;
    expect(rows).toHaveLength(2);
  });
});
