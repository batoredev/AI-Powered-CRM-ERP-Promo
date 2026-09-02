import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createPurchaseOrder, getPurchaseOrder, listPurchaseOrderLines, submitPurchaseOrder } from '../purchase-orders';
import { createVendor } from '../vendors';
import { createProduct } from '../products';
import { receivePurchaseOrder } from '../purchase-orders';
import { createLocation } from '../locations';
import { getStockOnHand } from '../stock';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('purchase order data access', () => {
  it('creates a purchase order with lines, in draft status with a sequential document number', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 1') RETURNING id`;
    const vendor = await createVendor(tenant.id, { name: 'Acme Supplies' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });

    const po = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 10, unitPriceMinorUnits: 500, currencyCode: 'USD' }],
    });

    expect(po.status).toBe('draft');
    expect(po.approvalState).toBe('draft');
    expect(po.documentNumber).toBe(1);

    const lines = await listPurchaseOrderLines(tenant.id, po.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(10);
    expect(lines[0].unitPriceMinorUnits).toBe(500);
  });

  it('allocates sequential document numbers per tenant', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 2') RETURNING id`;
    const vendor = await createVendor(tenant.id, { name: 'Acme Supplies' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });

    const po1 = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 1, unitPriceMinorUnits: 100, currencyCode: 'USD' }],
    });
    const po2 = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 1, unitPriceMinorUnits: 100, currencyCode: 'USD' }],
    });

    expect(po1.documentNumber).toBe(1);
    expect(po2.documentNumber).toBe(2);
  });

  it('submitPurchaseOrder moves status from draft to submitted, and returns null for a PO not in draft', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 3') RETURNING id`;
    const vendor = await createVendor(tenant.id, { name: 'Acme Supplies' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });

    const po = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 1, unitPriceMinorUnits: 100, currencyCode: 'USD' }],
    });

    const submitted = await submitPurchaseOrder(tenant.id, po.id);
    expect(submitted).not.toBeNull();
    expect(submitted!.status).toBe('submitted');

    const secondAttempt = await submitPurchaseOrder(tenant.id, po.id);
    expect(secondAttempt).toBeNull();
  });

  it('getPurchaseOrder returns null for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 4') RETURNING id`;
    const result = await getPurchaseOrder(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('receivePurchaseOrder creates stock moves for each line and increases on-hand quantity', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 5') RETURNING id`;
    const vendor = await createVendor(tenant.id, { name: 'Acme Supplies' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const location = await createLocation(tenant.id, { name: 'Main Warehouse' });

    const po = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 25, unitPriceMinorUnits: 500, currencyCode: 'USD' }],
    });
    await submitPurchaseOrder(tenant.id, po.id);

    const received = await receivePurchaseOrder(tenant.id, po.id, location.id);
    expect(received).not.toBeNull();
    expect(received!.status).toBe('received');

    const onHand = await getStockOnHand(tenant.id, product.id, location.id);
    expect(onHand).toBe(25);
  });

  it('receivePurchaseOrder returns null for a PO that is still in draft (never submitted)', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 6') RETURNING id`;
    const vendor = await createVendor(tenant.id, { name: 'Acme Supplies' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const location = await createLocation(tenant.id, { name: 'Main Warehouse' });

    const po = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 5, unitPriceMinorUnits: 100, currencyCode: 'USD' }],
    });

    const result = await receivePurchaseOrder(tenant.id, po.id, location.id);
    expect(result).toBeNull();
  });
});
