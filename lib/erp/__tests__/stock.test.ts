import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { recordStockMove, getStockOnHand } from '../stock';
import { createLocation } from '../locations';
import { createProduct } from '../products';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('stock ledger', () => {
  it('returns 0 on-hand for a product with no movements', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Stock Test Tenant 1') RETURNING id`;
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });

    const onHand = await getStockOnHand(tenant.id, product.id);
    expect(onHand).toBe(0);
  });

  it('increases on-hand after a receipt and decreases after a shipment, at a specific location', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Stock Test Tenant 2') RETURNING id`;
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const location = await createLocation(tenant.id, { name: 'Main Warehouse' });

    await recordStockMove(tenant.id, {
      productId: product.id,
      locationId: location.id,
      quantity: 100,
      movementType: 'receipt',
      reference: 'Initial stock',
    });

    let onHand = await getStockOnHand(tenant.id, product.id, location.id);
    expect(onHand).toBe(100);

    await recordStockMove(tenant.id, {
      productId: product.id,
      sourceLocationId: location.id,
      quantity: 30,
      movementType: 'shipment',
      reference: 'Order #1',
    });

    onHand = await getStockOnHand(tenant.id, product.id, location.id);
    expect(onHand).toBe(70);
  });

  it('tracks on-hand independently per location, and sums across locations when no locationId is given', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Stock Test Tenant 3') RETURNING id`;
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const locationA = await createLocation(tenant.id, { name: 'Warehouse A' });
    const locationB = await createLocation(tenant.id, { name: 'Warehouse B' });

    await recordStockMove(tenant.id, {
      productId: product.id,
      locationId: locationA.id,
      quantity: 50,
      movementType: 'receipt',
    });
    await recordStockMove(tenant.id, {
      productId: product.id,
      locationId: locationB.id,
      quantity: 20,
      movementType: 'receipt',
    });

    expect(await getStockOnHand(tenant.id, product.id, locationA.id)).toBe(50);
    expect(await getStockOnHand(tenant.id, product.id, locationB.id)).toBe(20);
    expect(await getStockOnHand(tenant.id, product.id)).toBe(70);
  });
});
