import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { nextDocumentNumber } from '../document-sequence';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('document sequence data access', () => {
  it('returns 1, 2, 3 for successive calls with the same tenant and document type', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Doc Seq Test Tenant 1') RETURNING id`;

    const first = await nextDocumentNumber(tenant.id, 'invoice');
    const second = await nextDocumentNumber(tenant.id, 'invoice');
    const third = await nextDocumentNumber(tenant.id, 'invoice');

    expect([first, second, third]).toEqual([1, 2, 3]);
  });

  it('tracks separate sequences per document type for the same tenant', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Doc Seq Test Tenant 2') RETURNING id`;

    const invoiceFirst = await nextDocumentNumber(tenant.id, 'invoice');
    const poFirst = await nextDocumentNumber(tenant.id, 'purchase_order');

    expect(invoiceFirst).toBe(1);
    expect(poFirst).toBe(1);
  });

  it('tracks separate sequences per tenant for the same document type', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Doc Seq Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Doc Seq Test Tenant 3B') RETURNING id`;

    await nextDocumentNumber(tenantA.id, 'invoice');
    await nextDocumentNumber(tenantA.id, 'invoice');
    const tenantBFirst = await nextDocumentNumber(tenantB.id, 'invoice');

    expect(tenantBFirst).toBe(1);
  });
});
