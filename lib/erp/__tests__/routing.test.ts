// lib/erp/__tests__/routing.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createRouting, listOperations, attachRouting } from '../routing';
import { createWorkCenter } from '../work-centers';
import { createBom } from '../bom';
import { createProduct } from '../products';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('routing data access', () => {
  it('creates a routing with ordered operations and reads them back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Routing Test Tenant 1') RETURNING id`;
    const workCenter = await createWorkCenter(tenant.id, { name: 'Assembly Line' });

    const routing = await createRouting(tenant.id, {
      name: 'Standard Assembly Routing',
      operations: [
        { workCenterId: workCenter.id, sequence: 1, name: 'Attach frame', durationMinutes: 10 },
        { workCenterId: workCenter.id, sequence: 2, name: 'Install screws', durationMinutes: 5 },
      ],
    });

    expect(routing.name).toBe('Standard Assembly Routing');

    const operations = await listOperations(tenant.id, routing.id);
    expect(operations).toHaveLength(2);
    expect(operations.map((o) => o.name)).toEqual(['Attach frame', 'Install screws']);
  });

  it('attaches a routing to a BoM, and a routing can be attached to multiple BoMs', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Routing Test Tenant 2') RETURNING id`;
    const workCenter = await createWorkCenter(tenant.id, { name: 'Line 2' });
    const routing = await createRouting(tenant.id, {
      name: 'Shared Routing',
      operations: [{ workCenterId: workCenter.id, sequence: 1, name: 'Do the thing', durationMinutes: 15 }],
    });

    const finishedGoodA = await createProduct(tenant.id, { name: 'Product A', productType: 'goods' });
    const finishedGoodB = await createProduct(tenant.id, { name: 'Product B', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Shared Part', productType: 'goods' });

    const bomA = await createBom(tenant.id, {
      productId: finishedGoodA.id,
      name: 'BoM A',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const bomB = await createBom(tenant.id, {
      productId: finishedGoodB.id,
      name: 'BoM B',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });

    const updatedA = await attachRouting(tenant.id, bomA.id, routing.id);
    const updatedB = await attachRouting(tenant.id, bomB.id, routing.id);

    expect(updatedA).not.toBeNull();
    expect(updatedA!.routingId).toBe(routing.id);
    expect(updatedB).not.toBeNull();
    expect(updatedB!.routingId).toBe(routing.id);
  });

  it('attachRouting returns null for a nonexistent bill_of_materials id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Routing Test Tenant 3') RETURNING id`;
    const workCenter = await createWorkCenter(tenant.id, { name: 'Line 3' });
    const routing = await createRouting(tenant.id, {
      name: 'Routing 3',
      operations: [{ workCenterId: workCenter.id, sequence: 1, name: 'Step', durationMinutes: 5 }],
    });

    const result = await attachRouting(tenant.id, '00000000-0000-0000-0000-000000000000', routing.id);
    expect(result).toBeNull();
  });

  it('F3 regression: attachRouting returns null for a cross-tenant routingId', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Routing Test Tenant 4A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Routing Test Tenant 4B') RETURNING id`;

    const workCenterB = await createWorkCenter(tenantB.id, { name: 'Tenant B Line' });
    const otherTenantRouting = await createRouting(tenantB.id, {
      name: 'Tenant B Routing',
      operations: [{ workCenterId: workCenterB.id, sequence: 1, name: 'Step', durationMinutes: 5 }],
    });

    const finishedGood = await createProduct(tenantA.id, { name: 'Tenant A Product', productType: 'goods' });
    const part = await createProduct(tenantA.id, { name: 'Tenant A Part', productType: 'goods' });
    const bom = await createBom(tenantA.id, {
      productId: finishedGood.id,
      name: 'Tenant A BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });

    const result = await attachRouting(tenantA.id, bom.id, otherTenantRouting.id);
    expect(result).toBeNull();
  });
});
