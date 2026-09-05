import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { withTenant } from '../../db/with-tenant';
import { nextDocumentNumber, nextDocumentNumberTx } from '../document-sequence';

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

  it('nextDocumentNumberTx allocates a number on the caller-provided transaction, and rolls back together with it on failure', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Doc Seq Test Tenant 4') RETURNING id`;

    // Successful path: number is allocated and visible after commit.
    const committedNumber = await withTenant(tenant.id, async (tx) => {
      return nextDocumentNumberTx(tx, tenant.id, 'gapless_doc_type');
    });
    expect(committedNumber).toBeGreaterThan(0);

    // Failure path: an error thrown after allocating the number inside
    // the SAME transaction must roll back the allocation too (gapless
    // guarantee) -- unlike nextDocumentNumber's own gap-tolerant design.
    await expect(
      withTenant(tenant.id, async (tx) => {
        await nextDocumentNumberTx(tx, tenant.id, 'gapless_doc_type');
        throw new Error('simulated failure after allocating number');
      }),
    ).rejects.toThrow('simulated failure');

    const nextAfterFailure = await withTenant(tenant.id, async (tx) => {
      return nextDocumentNumberTx(tx, tenant.id, 'gapless_doc_type');
    });
    // If the failed allocation had NOT rolled back, this would be
    // committedNumber + 2. Since it rolled back, it's committedNumber + 1.
    expect(nextAfterFailure).toBe(committedNumber + 1);
  });
});
