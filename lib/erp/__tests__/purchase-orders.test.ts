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

  it('receivePurchaseOrder is race-safe: two concurrent calls on the same submitted PO produce exactly one stock_move per line, not two', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 7') RETURNING id`;
    const vendor = await createVendor(tenant.id, { name: 'Acme Supplies' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const location = await createLocation(tenant.id, { name: 'Main Warehouse' });

    const po = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 25, unitPriceMinorUnits: 500, currencyCode: 'USD' }],
    });
    await submitPurchaseOrder(tenant.id, po.id);

    const [resultA, resultB] = await Promise.all([
      receivePurchaseOrder(tenant.id, po.id, location.id),
      receivePurchaseOrder(tenant.id, po.id, location.id),
    ]);

    const results = [resultA, resultB];
    const succeeded = results.filter((r) => r !== null);
    const failed = results.filter((r) => r === null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(succeeded[0]!.status).toBe('received');

    const onHand = await getStockOnHand(tenant.id, product.id, location.id);
    expect(onHand).toBe(25);
  });

  it('F1 regression: receivePurchaseOrder rejects a locationId belonging to another tenant, with no stock move written and status unchanged', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 8A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 8B') RETURNING id`;

    const vendorA = await createVendor(tenantA.id, { name: 'Acme Supplies' });
    const productA = await createProduct(tenantA.id, { name: 'Widget', productType: 'goods' });
    const locationB = await createLocation(tenantB.id, { name: 'Tenant B Warehouse' });

    const po = await createPurchaseOrder(tenantA.id, {
      vendorId: vendorA.id,
      lines: [{ productId: productA.id, quantity: 12, unitPriceMinorUnits: 500, currencyCode: 'USD' }],
    });
    await submitPurchaseOrder(tenantA.id, po.id);

    const result = await receivePurchaseOrder(tenantA.id, po.id, locationB.id);
    expect(result).toBeNull();

    // No stock move should have been created for tenant A's product.
    const onHand = await getStockOnHand(tenantA.id, productA.id);
    expect(onHand).toBe(0);

    // PO must still be submitted, not partially/fully received.
    const poAfter = await getPurchaseOrder(tenantA.id, po.id);
    expect(poAfter!.status).toBe('submitted');

    // Direct DB check: no stock_move row exists for tenant A referencing tenant B's location.
    const moves = await ownerSql`SELECT * FROM stock_move WHERE tenant_id = ${tenantA.id} AND location_id = ${locationB.id}`;
    expect(moves).toHaveLength(0);
  });

  it('F3 regression: receivePurchaseOrder with a nonexistent locationId leaves the PO in submitted status, not a partial received state', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 9') RETURNING id`;
    const vendor = await createVendor(tenant.id, { name: 'Acme Supplies' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });

    const po = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 8, unitPriceMinorUnits: 250, currencyCode: 'USD' }],
    });
    await submitPurchaseOrder(tenant.id, po.id);

    const nonexistentLocationId = '00000000-0000-0000-0000-000000000000';
    const result = await receivePurchaseOrder(tenant.id, po.id, nonexistentLocationId);
    expect(result).toBeNull();

    const poAfter = await getPurchaseOrder(tenant.id, po.id);
    expect(poAfter!.status).toBe('submitted');

    const onHand = await getStockOnHand(tenant.id, product.id);
    expect(onHand).toBe(0);

    // Retry with a valid location should now succeed cleanly (proves recoverability).
    const location = await createLocation(tenant.id, { name: 'Recovery Warehouse' });
    const retried = await receivePurchaseOrder(tenant.id, po.id, location.id);
    expect(retried).not.toBeNull();
    expect(retried!.status).toBe('received');

    const onHandAfterRetry = await getStockOnHand(tenant.id, product.id, location.id);
    expect(onHandAfterRetry).toBe(8);
  });
});
