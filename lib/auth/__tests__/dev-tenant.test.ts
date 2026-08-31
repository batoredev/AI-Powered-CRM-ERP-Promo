import { describe, it, expect, afterAll } from 'vitest';
import postgres from 'postgres';
import { getDevTenantId } from '../dev-tenant';

const setupSql = postgres(process.env.DATABASE_URL!);

describe('getDevTenantId', () => {
  afterAll(async () => {
    await setupSql.end();
  });

  it('returns a valid tenant id that exists in the database', async () => {
    const tenantId = await getDevTenantId();
    expect(tenantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const rows = await setupSql`SELECT id FROM tenant WHERE id = ${tenantId}`;
    expect(rows).toHaveLength(1);
  });

  it('returns the same tenant id on repeated calls (idempotent)', async () => {
    const first = await getDevTenantId();
    const second = await getDevTenantId();
    expect(first).toBe(second);
  });
});
