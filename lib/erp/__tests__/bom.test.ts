import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createBom, getBom, listBomComponents } from '../bom';
import { createProduct } from '../products';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('bill of materials data access', () => {
  it('creates a BoM with components and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('BoM Test Tenant 1') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Widget Assembly', productType: 'goods' });
    const part1 = await createProduct(tenant.id, { name: 'Widget Frame', productType: 'goods' });
    const part2 = await createProduct(tenant.id, { name: 'Widget Screw', productType: 'goods' });

    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Standard Widget Assembly',
      bomType: 'manufacture',
      components: [
        { componentProductId: part1.id, quantity: 1 },
        { componentProductId: part2.id, quantity: 4 },
      ],
    });

    expect(bom.productId).toBe(finishedGood.id);
    expect(bom.bomType).toBe('manufacture');
    expect(bom.routingId).toBeNull();

    const fetched = await getBom(tenant.id, bom.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Standard Widget Assembly');

    const components = await listBomComponents(tenant.id, bom.id);
    expect(components).toHaveLength(2);
    expect(components.find((c) => c.componentProductId === part2.id)?.quantity).toBe(4);
  });

  it('allows a product to have multiple BoMs', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('BoM Test Tenant 2') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Gadget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Gadget Part', productType: 'goods' });

    const bomA = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Recipe A',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const bomB = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Recipe B',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 2 }],
    });

    expect(bomA.id).not.toBe(bomB.id);
    expect(bomA.productId).toBe(bomB.productId);
  });

  it('returns null from getBom for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('BoM Test Tenant 3') RETURNING id`;
    const result = await getBom(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
