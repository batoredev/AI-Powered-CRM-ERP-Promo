import { describe, it, expect } from 'vitest';
import { withTenant } from '../with-tenant';

describe('withTenant', () => {
  it('scopes queries to the given tenant', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const result = await withTenant(tenantId, async (tx) => {
      return tx`SELECT current_tenant_id() as id`;
    });
    expect(result[0].id).toBe(tenantId);
  });

  it('does not leak tenant context to a call without withTenant', async () => {
    const { getSql } = await import('../connection');
    const sql = getSql();
    const rows = await sql`SELECT current_tenant_id() as id`;
    expect(rows[0].id).toBeNull();
  });
});
