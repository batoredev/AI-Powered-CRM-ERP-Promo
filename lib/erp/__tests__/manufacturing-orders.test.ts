import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createManufacturingOrder, getManufacturingOrder } from '../manufacturing-orders';
import { createBom } from '../bom';
import { createProduct } from '../products';
import { createLocation } from '../locations';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('manufacturing order data access', () => {
  it('creates a manufacturing order in draft/draft with a sequential document number', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 1') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Widget Part', productType: 'goods' });
    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Widget BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 2 }],
    });
    const location = await createLocation(tenant.id, { name: 'Factory Floor' });

    const mo = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 10,
      targetLocationId: location.id,
    });

    expect(mo.status).toBe('draft');
    expect(mo.approvalState).toBe('draft');
    expect(mo.documentNumber).toBe(1);
    expect(mo.quantity).toBe(10);
  });

  it('allocates sequential document numbers per tenant, in the manufacturing_order sequence distinct from purchase_order', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 2') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Widget Part', productType: 'goods' });
    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Widget BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const location = await createLocation(tenant.id, { name: 'Factory Floor' });

    const mo1 = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 1,
      targetLocationId: location.id,
    });
    const mo2 = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 1,
      targetLocationId: location.id,
    });

    expect(mo1.documentNumber).toBe(1);
    expect(mo2.documentNumber).toBe(2);
  });

  it('returns null from getManufacturingOrder for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 3') RETURNING id`;
    const result = await getManufacturingOrder(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
