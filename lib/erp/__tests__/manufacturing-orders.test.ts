import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createManufacturingOrder, getManufacturingOrder } from '../manufacturing-orders';
import { planManufacturingOrder, completeManufacturingOrder, listWorkOrders } from '../manufacturing-orders';
import { createBom } from '../bom';
import { createProduct } from '../products';
import { createLocation } from '../locations';
import { createWorkCenter } from '../work-centers';
import { createRouting, attachRouting } from '../routing';
import { recordStockMove, getStockOnHand } from '../stock';

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

  it('planManufacturingOrder generates one work_order per routing operation, ordered by sequence', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 4') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Widget Part', productType: 'goods' });
    const workCenter = await createWorkCenter(tenant.id, { name: 'Line A' });
    const routing = await createRouting(tenant.id, {
      name: 'Widget Routing',
      operations: [
        { workCenterId: workCenter.id, sequence: 1, name: 'Cut', durationMinutes: 5 },
        { workCenterId: workCenter.id, sequence: 2, name: 'Assemble', durationMinutes: 10 },
      ],
    });
    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Widget BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    await attachRouting(tenant.id, bom.id, routing.id);
    const location = await createLocation(tenant.id, { name: 'Factory Floor' });

    const mo = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 5,
      targetLocationId: location.id,
    });

    const planned = await planManufacturingOrder(tenant.id, mo.id);
    expect(planned).not.toBeNull();
    expect(planned!.status).toBe('planned');

    const workOrders = await listWorkOrders(tenant.id, mo.id);
    expect(workOrders).toHaveLength(2);
    expect(workOrders.every((wo) => wo.status === 'pending')).toBe(true);
  });

  it('planManufacturingOrder succeeds with zero work orders when the BoM has no routing', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 5') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Simple Widget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Part', productType: 'goods' });
    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'No-Routing BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const location = await createLocation(tenant.id, { name: 'Factory Floor' });

    const mo = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 1,
      targetLocationId: location.id,
    });

    const planned = await planManufacturingOrder(tenant.id, mo.id);
    expect(planned).not.toBeNull();
    expect(planned!.status).toBe('planned');

    const workOrders = await listWorkOrders(tenant.id, mo.id);
    expect(workOrders).toHaveLength(0);
  });

  it('planManufacturingOrder returns null for an MO not currently in draft', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 6') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Part', productType: 'goods' });
    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const location = await createLocation(tenant.id, { name: 'Factory Floor' });
    const mo = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 1,
      targetLocationId: location.id,
    });

    await planManufacturingOrder(tenant.id, mo.id);
    const secondAttempt = await planManufacturingOrder(tenant.id, mo.id);
    expect(secondAttempt).toBeNull();
  });

  it('completeManufacturingOrder consumes components and receives the finished good, flipping status to completed', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 7') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Widget Part', productType: 'goods' });
    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Widget BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 3 }],
    });
    const componentSource = await createLocation(tenant.id, { name: 'Raw Materials' });
    const targetLocation = await createLocation(tenant.id, { name: 'Finished Goods' });

    // Seed component stock so consumption has something to draw down.
    await recordStockMove(tenant.id, {
      productId: part.id,
      locationId: componentSource.id,
      quantity: 100,
      movementType: 'receipt',
    });

    const mo = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 5,
      targetLocationId: targetLocation.id,
    });
    await planManufacturingOrder(tenant.id, mo.id);

    const completed = await completeManufacturingOrder(tenant.id, mo.id, componentSource.id);
    expect(completed).not.toBeNull();
    expect(completed!.status).toBe('completed');

    // 5 units of finished good, each needing 3 of the component -> 15 consumed.
    expect(await getStockOnHand(tenant.id, part.id, componentSource.id)).toBe(85);
    expect(await getStockOnHand(tenant.id, finishedGood.id, targetLocation.id)).toBe(5);
  });

  it('completeManufacturingOrder rejects a componentSourceLocationId belonging to another tenant, with no state change', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 8A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 8B') RETURNING id`;
    const otherTenantLocation = await createLocation(tenantB.id, { name: 'Tenant B Location' });

    const finishedGood = await createProduct(tenantA.id, { name: 'Widget', productType: 'goods' });
    const part = await createProduct(tenantA.id, { name: 'Part', productType: 'goods' });
    const bom = await createBom(tenantA.id, {
      productId: finishedGood.id,
      name: 'BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const targetLocation = await createLocation(tenantA.id, { name: 'Finished Goods' });
    const mo = await createManufacturingOrder(tenantA.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 1,
      targetLocationId: targetLocation.id,
    });
    await planManufacturingOrder(tenantA.id, mo.id);

    const result = await completeManufacturingOrder(tenantA.id, mo.id, otherTenantLocation.id);
    expect(result).toBeNull();

    const stillPlanned = await getManufacturingOrder(tenantA.id, mo.id);
    expect(stillPlanned!.status).toBe('planned');
    expect(await getStockOnHand(tenantA.id, finishedGood.id, targetLocation.id)).toBe(0);
  });
});
