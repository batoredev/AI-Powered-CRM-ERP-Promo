import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { getErpSettings, updateErpSettings } from '../settings';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('tenant_erp_settings data access', () => {
  it('creates and returns default settings on first read for a new tenant', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('ERP Settings Test Tenant 1') RETURNING id`;
    const settings = await getErpSettings(tenant.id);

    expect(settings.tenantId).toBe(tenant.id);
    expect(settings.goodsHandling).toBe('off');
    expect(settings.billingModes).toEqual([]);
  });

  it('returns the same settings on a second read rather than creating a duplicate row', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('ERP Settings Test Tenant 2') RETURNING id`;
    await getErpSettings(tenant.id);
    await getErpSettings(tenant.id);

    const rows = await ownerSql`SELECT * FROM tenant_erp_settings WHERE tenant_id = ${tenant.id}`;
    expect(rows).toHaveLength(1);
  });

  it('updates goodsHandling and billingModes independently', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('ERP Settings Test Tenant 3') RETURNING id`;
    await getErpSettings(tenant.id);

    const updated = await updateErpSettings(tenant.id, {
      goodsHandling: 'basic_stock',
      billingModes: ['transactional', 'recurring'],
    });

    expect(updated.goodsHandling).toBe('basic_stock');
    expect(updated.billingModes).toEqual(['transactional', 'recurring']);
  });

  it('succeeds when called on a brand-new tenant without a prior getErpSettings call', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('ERP Settings Test Tenant 4') RETURNING id`;

    const updated = await updateErpSettings(tenant.id, {
      goodsHandling: 'production',
      billingModes: ['effort_based'],
    });

    expect(updated.tenantId).toBe(tenant.id);
    expect(updated.goodsHandling).toBe('production');
    expect(updated.billingModes).toEqual(['effort_based']);

    const rows = await ownerSql`SELECT * FROM tenant_erp_settings WHERE tenant_id = ${tenant.id}`;
    expect(rows).toHaveLength(1);
  });
});
