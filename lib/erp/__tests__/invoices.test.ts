import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createInvoice, getInvoice, listInvoiceLines, markInvoiceSent, voidInvoice } from '../invoices';
import { createSalesOrder } from '../sales-orders';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('invoice data access', () => {
  it('creates a sales-order-sourced invoice with lines and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Invoice Test Tenant 1') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Customer' });
    const so = await createSalesOrder(tenant.id, { contactId: contact.id, lines: [] });

    const invoice = await createInvoice(tenant.id, {
      sourceType: 'sales_order',
      salesOrderId: so.id,
      dueDate: '2026-10-01',
      lines: [{ description: 'Consulting', quantity: 2, unitPriceMinorUnits: 20000, currencyCode: 'USD' }],
    });

    expect(invoice.sourceType).toBe('sales_order');
    expect(invoice.salesOrderId).toBe(so.id);
    expect(invoice.status).toBe('draft');
    expect(invoice.documentNumber).toBeGreaterThan(0);

    const fetched = await getInvoice(tenant.id, invoice.id);
    expect(fetched).not.toBeNull();

    const lines = await listInvoiceLines(tenant.id, invoice.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe('Consulting');
  });

  it('rejects sourceType sales_order with no salesOrderId', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Invoice Test Tenant 2') RETURNING id`;
    await expect(
      createInvoice(tenant.id, { sourceType: 'sales_order', dueDate: '2026-10-01', lines: [] }),
    ).rejects.toThrow();
  });

  it('rejects a salesOrderId belonging to another tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Invoice Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Invoice Test Tenant 3B') RETURNING id`;
    const contactB = await createContact(tenantB.id, { fullName: 'Tenant B Customer' });
    const soB = await createSalesOrder(tenantB.id, { contactId: contactB.id, lines: [] });

    await expect(
      createInvoice(tenantA.id, { sourceType: 'sales_order', salesOrderId: soB.id, dueDate: '2026-10-01', lines: [] }),
    ).rejects.toThrow();
  });

  it('markInvoiceSent moves status from draft to sent, and returns null on a second attempt', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Invoice Test Tenant 4') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Customer' });
    const so = await createSalesOrder(tenant.id, { contactId: contact.id, lines: [] });
    const invoice = await createInvoice(tenant.id, { sourceType: 'sales_order', salesOrderId: so.id, dueDate: '2026-10-01', lines: [] });

    const sent = await markInvoiceSent(tenant.id, invoice.id);
    expect(sent).not.toBeNull();
    expect(sent!.status).toBe('sent');

    const secondAttempt = await markInvoiceSent(tenant.id, invoice.id);
    expect(secondAttempt).toBeNull();
  });

  it('voidInvoice works from draft or sent, but not from paid', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Invoice Test Tenant 5') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Customer' });
    const so = await createSalesOrder(tenant.id, { contactId: contact.id, lines: [] });
    const invoice = await createInvoice(tenant.id, { sourceType: 'sales_order', salesOrderId: so.id, dueDate: '2026-10-01', lines: [] });

    const voided = await voidInvoice(tenant.id, invoice.id);
    expect(voided).not.toBeNull();
    expect(voided!.status).toBe('void');

    // already void -- second attempt returns null (status no longer in ('draft','sent'))
    const secondAttempt = await voidInvoice(tenant.id, invoice.id);
    expect(secondAttempt).toBeNull();
  });
});
