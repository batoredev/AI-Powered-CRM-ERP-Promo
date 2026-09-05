import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createPayment, getPayment, recordPaymentAllocation, listPaymentAllocations } from '../payments';
import { createInvoice } from '../invoices';
import { createSalesOrder } from '../sales-orders';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

async function setupInvoice(tenantId: string, contactId: string) {
  const so = await createSalesOrder(tenantId, { contactId, lines: [] });
  return createInvoice(tenantId, { sourceType: 'sales_order', salesOrderId: so.id, dueDate: '2026-10-01', lines: [] });
}

describe('payment data access', () => {
  it('creates a payment and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 1') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Payer' });

    const payment = await createPayment(tenant.id, {
      contactId: contact.id,
      amountMinorUnits: 50000,
      currencyCode: 'USD',
      receivedAt: '2026-09-05T00:00:00.000Z',
      method: 'bank_transfer',
    });

    expect(payment.contactId).toBe(contact.id);
    expect(payment.amountMinorUnits).toBe(50000);

    const fetched = await getPayment(tenant.id, payment.id);
    expect(fetched).not.toBeNull();
  });

  it('rejects a contactId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 2A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 2B') RETURNING id`;
    const contactB = await createContact(tenantB.id, { fullName: 'Tenant B Payer' });

    await expect(
      createPayment(tenantA.id, { contactId: contactB.id, amountMinorUnits: 100, currencyCode: 'USD', receivedAt: '2026-09-05T00:00:00.000Z', method: 'cash' }),
    ).rejects.toThrow();
  });

  it('records a payment allocation against a valid invoice within the payment cap', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 3') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Payer' });
    const invoice = await setupInvoice(tenant.id, contact.id);
    const payment = await createPayment(tenant.id, { contactId: contact.id, amountMinorUnits: 10000, currencyCode: 'USD', receivedAt: '2026-09-05T00:00:00.000Z', method: 'card' });

    const allocation = await recordPaymentAllocation(tenant.id, payment.id, invoice.id, 6000);
    expect(allocation.allocatedAmountMinorUnits).toBe(6000);

    const allocations = await listPaymentAllocations(tenant.id, payment.id);
    expect(allocations).toHaveLength(1);
  });

  it('rejects an allocation that would exceed the payment amount across multiple allocations', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 4') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Payer' });
    const invoiceA = await setupInvoice(tenant.id, contact.id);
    const invoiceB = await setupInvoice(tenant.id, contact.id);
    const payment = await createPayment(tenant.id, { contactId: contact.id, amountMinorUnits: 10000, currencyCode: 'USD', receivedAt: '2026-09-05T00:00:00.000Z', method: 'card' });

    await recordPaymentAllocation(tenant.id, payment.id, invoiceA.id, 7000);
    await expect(
      recordPaymentAllocation(tenant.id, payment.id, invoiceB.id, 4000), // 7000 + 4000 > 10000
    ).rejects.toThrow();

    const allocations = await listPaymentAllocations(tenant.id, payment.id);
    expect(allocations).toHaveLength(1); // the rejected allocation was never inserted
  });

  it('rejects an invoiceId belonging to another tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 5A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 5B') RETURNING id`;
    const contactA = await createContact(tenantA.id, { fullName: 'Payer A' });
    const contactB = await createContact(tenantB.id, { fullName: 'Payer B' });
    const invoiceB = await setupInvoice(tenantB.id, contactB.id);
    const paymentA = await createPayment(tenantA.id, { contactId: contactA.id, amountMinorUnits: 10000, currencyCode: 'USD', receivedAt: '2026-09-05T00:00:00.000Z', method: 'card' });

    await expect(
      recordPaymentAllocation(tenantA.id, paymentA.id, invoiceB.id, 1000),
    ).rejects.toThrow();
  });

  it('does not allow two concurrent allocations to together exceed the payment cap (row-lock race probe)', async () => {
    // Targets the race the Task 3 final review flagged: without a row
    // lock on `payment`, two concurrent recordPaymentAllocation calls
    // against the SAME payment could both read the pre-allocation SUM,
    // both pass the cap check, and both insert -- over-allocating past the
    // cap. The SELECT ... FOR UPDATE added to recordPaymentAllocation is
    // meant to serialize concurrent callers on the same payment row.
    //
    // Caveat, confirmed empirically 2026-09-05: this specific
    // Promise.allSettled probe passes with the row lock in place, but it
    // ALSO passed with the row lock temporarily removed during
    // verification -- i.e. this test does not reliably reproduce the
    // race. This is NOT because of shared-connection scheduling (the
    // pool grants each concurrent withTenant call its own physical
    // connection via sql.begin() -- see lib/db/connection.ts's max: 10
    // pool), but more likely ordinary async/event-loop timing: each
    // call does two separate withTenant round trips (getPayment,
    // getInvoice) that commit and release BEFORE the allocation
    // transaction even opens, so the two calls' actual critical
    // sections don't reliably line up in a single run the way a true
    // concurrent-client race would. The row lock is still correct defense-in-depth
    // (a real race under true concurrent load -- e.g. two separate
    // processes -- remains closed by it), but this particular test
    // should not be read as empirical proof the fix is load-bearing; it
    // only proves the happy-path invariant (allocations never exceed the
    // cap) holds under this harness's execution model. A genuine
    // multi-connection/multi-process concurrency test would be needed to
    // actually falsify the lock's necessity.
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 6') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Payer' });
    const invoiceA = await setupInvoice(tenant.id, contact.id);
    const invoiceB = await setupInvoice(tenant.id, contact.id);
    const payment = await createPayment(tenant.id, { contactId: contact.id, amountMinorUnits: 10000, currencyCode: 'USD', receivedAt: '2026-09-05T00:00:00.000Z', method: 'card' });

    // Two allocations of 7000 each against a 10000 cap: individually valid,
    // but together (14000) exceed it -- exactly the scenario a check-then-
    // insert race (without a row lock) would let both through.
    const results = await Promise.allSettled([
      recordPaymentAllocation(tenant.id, payment.id, invoiceA.id, 7000),
      recordPaymentAllocation(tenant.id, payment.id, invoiceB.id, 7000),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Confirm the DB itself never held both allocations at once -- the
    // real invariant, not just that one promise rejected.
    const allocations = await listPaymentAllocations(tenant.id, payment.id);
    expect(allocations).toHaveLength(1);
    const totalAllocated = allocations.reduce((sum, a) => sum + a.allocatedAmountMinorUnits, 0);
    expect(totalAllocated).toBeLessThanOrEqual(10000);
  });
});
