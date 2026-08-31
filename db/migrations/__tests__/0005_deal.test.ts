import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const sql = postgres(process.env.APP_RUNTIME_DATABASE_URL!);
const setupSql = postgres(process.env.DATABASE_URL!);

describe('deal tenant isolation and foreign keys', () => {
  let tenantAId: string;
  let contactAId: string;
  let stageAId: string;
  let dealAId: string;

  beforeAll(async () => {
    const [tenantA] = await setupSql`INSERT INTO tenant (name) VALUES ('Deal Test Tenant A') RETURNING id`;
    tenantAId = tenantA.id;
    const [contactA] = await setupSql`INSERT INTO contact (tenant_id, full_name) VALUES (${tenantAId}, 'Deal Contact') RETURNING id`;
    contactAId = contactA.id;
    const [stageA] = await setupSql`INSERT INTO pipeline_stage (tenant_id, name, sort_order) VALUES (${tenantAId}, 'Lead', 0) RETURNING id`;
    stageAId = stageA.id;
    const [dealA] = await setupSql`INSERT INTO deal (tenant_id, contact_id, pipeline_stage_id, title, value_minor_units, currency_code) VALUES (${tenantAId}, ${contactAId}, ${stageAId}, 'Big Deal', 500000, 'USD') RETURNING id`;
    dealAId = dealA.id;
  });

  afterAll(async () => {
    await setupSql`DELETE FROM deal WHERE tenant_id = ${tenantAId}`;
    await setupSql`DELETE FROM pipeline_stage WHERE tenant_id = ${tenantAId}`;
    await setupSql`DELETE FROM contact WHERE tenant_id = ${tenantAId}`;
    await setupSql`DELETE FROM tenant WHERE id = ${tenantAId}`;
    await setupSql.end();
    await sql.end();
  });

  it('a tenant-scoped query sees the deal with correct value fields', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantAId})`;
      return tx`SELECT title, value_minor_units, currency_code FROM deal WHERE id = ${dealAId}`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].value_minor_units).toBe('500000'); // the `postgres` driver returns bigint columns as strings by default (verified against live output)
    expect(rows[0].currency_code).toBe('USD');
  });

  it('a zero-context query sees nothing', async () => {
    const rows = await sql.begin(async (tx) => {
      return tx`SELECT * FROM deal WHERE id = ${dealAId}`;
    });
    expect(rows).toHaveLength(0);
  });
});
