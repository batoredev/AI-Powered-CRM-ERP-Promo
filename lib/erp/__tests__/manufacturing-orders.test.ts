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

  it('F2 regression: rejects a cross-tenant billOfMaterialsId before writing anything', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 9A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 9B') RETURNING id`;

    const otherFinishedGood = await createProduct(tenantB.id, { name: 'Tenant B Widget', productType: 'goods' });
    const otherPart = await createProduct(tenantB.id, { name: 'Tenant B Part', productType: 'goods' });
    const otherTenantBom = await createBom(tenantB.id, {
      productId: otherFinishedGood.id,
      name: 'Tenant B BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: otherPart.id, quantity: 1 }],
    });

    const finishedGood = await createProduct(tenantA.id, { name: 'Tenant A Widget', productType: 'goods' });
    const location = await createLocation(tenantA.id, { name: 'Tenant A Factory Floor' });

    await expect(
      createManufacturingOrder(tenantA.id, {
        productId: finishedGood.id,
        billOfMaterialsId: otherTenantBom.id,
        quantity: 1,
        targetLocationId: location.id,
      }),
    ).rejects.toThrow(/does not belong to this tenant/);
  });

  it('F5 regression: rejects a productId that does not match the BoM\'s own product', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 10') RETURNING id`;
    const productOne = await createProduct(tenant.id, { name: 'Product One', productType: 'goods' });
    const productTwo = await createProduct(tenant.id, { name: 'Product Two', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Part', productType: 'goods' });
    const bomForProductOne = await createBom(tenant.id, {
      productId: productOne.id,
      name: 'BoM for Product One',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const location = await createLocation(tenant.id, { name: 'Factory Floor' });

    await expect(
      createManufacturingOrder(tenant.id, {
        productId: productTwo.id,
        billOfMaterialsId: bomForProductOne.id,
        quantity: 1,
        targetLocationId: location.id,
      }),
    ).rejects.toThrow(/productId does not match/);
  });

  it('F4 regression: refuses to complete an MO whose BoM has a component that is itself manufacturable (two-level BoM)', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 11') RETURNING id`;

    const rawSteel = await createProduct(tenant.id, { name: 'Raw Steel', productType: 'goods' });
    const subAssembly = await createProduct(tenant.id, { name: 'Sub Assembly', productType: 'goods' });
    const finishedMachine = await createProduct(tenant.id, { name: 'Finished Machine', productType: 'goods' });

    // Sub Assembly is itself manufactured from Raw Steel.
    await createBom(tenant.id, {
      productId: subAssembly.id,
      name: 'Sub Assembly BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: rawSteel.id, quantity: 2 }],
    });

    // Finished Machine's BoM consumes Sub Assembly directly (one level).
    const machineBom = await createBom(tenant.id, {
      productId: finishedMachine.id,
      name: 'Finished Machine BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: subAssembly.id, quantity: 3 }],
    });

    const sourceLocation = await createLocation(tenant.id, { name: 'Raw Materials' });
    const targetLocation = await createLocation(tenant.id, { name: 'Finished Goods' });

    await recordStockMove(tenant.id, {
      productId: rawSteel.id,
      locationId: sourceLocation.id,
      quantity: 1000,
      movementType: 'receipt',
    });

    const mo = await createManufacturingOrder(tenant.id, {
      productId: finishedMachine.id,
      billOfMaterialsId: machineBom.id,
      quantity: 4,
      targetLocationId: targetLocation.id,
    });
    await planManufacturingOrder(tenant.id, mo.id);

    const result = await completeManufacturingOrder(tenant.id, mo.id, sourceLocation.id);
    expect(result).toBeNull();

    // Refused: no phantom consumption, no phantom receipt, MO stays planned.
    const stillPlanned = await getManufacturingOrder(tenant.id, mo.id);
    expect(stillPlanned!.status).toBe('planned');
    expect(await getStockOnHand(tenant.id, rawSteel.id, sourceLocation.id)).toBe(1000);
    expect(await getStockOnHand(tenant.id, subAssembly.id, sourceLocation.id)).toBe(0);
    expect(await getStockOnHand(tenant.id, finishedMachine.id, targetLocation.id)).toBe(0);
  });
});
