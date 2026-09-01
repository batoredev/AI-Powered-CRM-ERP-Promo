// lib/erp/__tests__/vendors.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createVendor, getVendor, listVendors } from '../vendors';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('vendor data access', () => {
  it('creates a vendor with all fields and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Vendor Test Tenant 1') RETURNING id`;

    const vendor = await createVendor(tenant.id, {
      name: 'Acme Supplies',
      email: 'orders@acmesupplies.example',
      phone: '555-0100',
      paymentTermsDays: 30,
      taxId: 'TAX-12345',
    });

    expect(vendor.name).toBe('Acme Supplies');
    expect(vendor.paymentTermsDays).toBe(30);

    const fetched = await getVendor(tenant.id, vendor.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.taxId).toBe('TAX-12345');
  });

  it('returns null from getVendor for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Vendor Test Tenant 2') RETURNING id`;
    const result = await getVendor(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('lists only vendors belonging to the given tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Vendor Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Vendor Test Tenant 3B') RETURNING id`;

    await createVendor(tenantA.id, { name: 'Tenant A Vendor' });
    await createVendor(tenantB.id, { name: 'Tenant B Vendor' });

    const vendorsA = await listVendors(tenantA.id);
    expect(vendorsA.map((v) => v.name)).toEqual(['Tenant A Vendor']);
  });
});
