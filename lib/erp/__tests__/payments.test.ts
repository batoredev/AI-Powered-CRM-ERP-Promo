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
});
