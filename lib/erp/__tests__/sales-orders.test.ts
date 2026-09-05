import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createSalesOrder, getSalesOrder, listSalesOrderLines, confirmSalesOrder } from '../sales-orders';
import { createContact } from '../../crm/contacts';
import { createProduct } from '../products';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('sales order data access', () => {
  it('creates a sales order with lines and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('SO Test Tenant 1') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Customer A' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });

    const so = await createSalesOrder(tenant.id, {
      contactId: contact.id,
      lines: [{ productId: product.id, quantity: 3, unitPriceMinorUnits: 1500, currencyCode: 'USD' }],
    });

    expect(so.contactId).toBe(contact.id);
    expect(so.status).toBe('draft');
    expect(so.documentNumber).toBeGreaterThan(0);

    const fetched = await getSalesOrder(tenant.id, so.id);
    expect(fetched).not.toBeNull();

    const lines = await listSalesOrderLines(tenant.id, so.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
  });

  it('rejects a contactId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('SO Test Tenant 2A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('SO Test Tenant 2B') RETURNING id`;
    const contactB = await createContact(tenantB.id, { fullName: 'Tenant B Customer' });

    await expect(
      createSalesOrder(tenantA.id, { contactId: contactB.id, lines: [] }),
    ).rejects.toThrow();
  });

  it('rejects a line productId belonging to another tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('SO Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('SO Test Tenant 3B') RETURNING id`;
    const contactA = await createContact(tenantA.id, { fullName: 'Customer A' });
    const productB = await createProduct(tenantB.id, { name: 'Tenant B Widget', productType: 'goods' });

    await expect(
      createSalesOrder(tenantA.id, {
        contactId: contactA.id,
        lines: [{ productId: productB.id, quantity: 1, unitPriceMinorUnits: 100, currencyCode: 'USD' }],
      }),
    ).rejects.toThrow();
  });

  it('confirmSalesOrder moves status from draft to confirmed, and returns null on a second attempt', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('SO Test Tenant 4') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Customer' });
    const so = await createSalesOrder(tenant.id, { contactId: contact.id, lines: [] });

    const confirmed = await confirmSalesOrder(tenant.id, so.id);
    expect(confirmed).not.toBeNull();
    expect(confirmed!.status).toBe('confirmed');

    const secondAttempt = await confirmSalesOrder(tenant.id, so.id);
    expect(secondAttempt).toBeNull();
  });
});
