import { withTenant } from '../db/with-tenant';

export type ProductType = 'goods' | 'service' | 'non_inventoried';

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  productType: ProductType;
  sku: string | null;
  priceMinorUnits: number | null;
  currencyCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProduct {
  name: string;
  productType: ProductType;
  sku?: string;
  priceMinorUnits?: number;
  currencyCode?: string;
}

function rowToProduct(row: any): Product {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    productType: row.product_type,
    sku: row.sku,
    priceMinorUnits: row.price_minor_units !== null ? Number(row.price_minor_units) : null,
    currencyCode: row.currency_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createProduct(tenantId: string, input: NewProduct): Promise<Product> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO product (tenant_id, name, product_type, sku, price_minor_units, currency_code)
      VALUES (${tenantId}, ${input.name}, ${input.productType}, ${input.sku ?? null}, ${input.priceMinorUnits ?? null}, ${input.currencyCode ?? null})
      RETURNING *
    `;
    return rowToProduct(row);
  });
}

export async function getProduct(tenantId: string, id: string): Promise<Product | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM product WHERE id = ${id}`;
    return rows.length > 0 ? rowToProduct(rows[0]) : null;
  });
}

export async function listProducts(
  tenantId: string,
  filter?: { productType?: ProductType },
): Promise<Product[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = filter?.productType
      ? await tx`SELECT * FROM product WHERE product_type = ${filter.productType} ORDER BY created_at DESC`
      : await tx`SELECT * FROM product ORDER BY created_at DESC`;
    return rows.map(rowToProduct);
  });
}
