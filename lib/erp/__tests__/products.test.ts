import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createProduct, getProduct, listProducts } from '../products';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('product data access', () => {
  it('creates a goods product with SKU and price, reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Product Test Tenant 1') RETURNING id`;

    const product = await createProduct(tenant.id, {
      name: 'Widget',
      productType: 'goods',
      sku: 'WID-001',
      priceMinorUnits: 1999,
      currencyCode: 'USD',
    });

    expect(product.productType).toBe('goods');
    expect(product.sku).toBe('WID-001');

    const fetched = await getProduct(tenant.id, product.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.priceMinorUnits).toBe(1999);
  });

  it('creates a service product with no SKU or price', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Product Test Tenant 2') RETURNING id`;

    const product = await createProduct(tenant.id, {
      name: 'Consulting Hour',
      productType: 'service',
    });

    expect(product.productType).toBe('service');
    expect(product.sku).toBeNull();
    expect(product.priceMinorUnits).toBeNull();
  });

  it('returns null from getProduct for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Product Test Tenant 3') RETURNING id`;
    const result = await getProduct(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('listProducts filters by productType within the given tenant only', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Product Test Tenant 4') RETURNING id`;

    await createProduct(tenant.id, { name: 'Goods A', productType: 'goods' });
    await createProduct(tenant.id, { name: 'Service A', productType: 'service' });

    const goodsOnly = await listProducts(tenant.id, { productType: 'goods' });
    expect(goodsOnly.map((p) => p.name)).toEqual(['Goods A']);

    const all = await listProducts(tenant.id);
    expect(all).toHaveLength(2);
  });
});
