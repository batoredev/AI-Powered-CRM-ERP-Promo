import { withTenant } from '../db/with-tenant';

export type MovementType = 'receipt' | 'shipment' | 'adjustment' | 'transfer';

export interface StockMove {
  id: string;
  tenantId: string;
  productId: string;
  locationId: string | null;
  sourceLocationId: string | null;
  quantity: number;
  movementType: MovementType;
  reference: string | null;
  createdAt: Date;
}

export interface NewStockMove {
  productId: string;
  locationId?: string;
  sourceLocationId?: string;
  quantity: number;
  movementType: MovementType;
  reference?: string;
}

function rowToStockMove(row: any): StockMove {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    locationId: row.location_id,
    sourceLocationId: row.source_location_id,
    quantity: Number(row.quantity),
    movementType: row.movement_type,
    reference: row.reference,
    createdAt: row.created_at,
  };
}

export async function recordStockMove(tenantId: string, input: NewStockMove): Promise<StockMove> {
  if (!input.locationId && !input.sourceLocationId) {
    throw new Error('recordStockMove requires at least one of locationId or sourceLocationId');
  }
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO stock_move (tenant_id, product_id, location_id, source_location_id, quantity, movement_type, reference)
      VALUES (${tenantId}, ${input.productId}, ${input.locationId ?? null}, ${input.sourceLocationId ?? null}, ${input.quantity}, ${input.movementType}, ${input.reference ?? null})
      RETURNING *
    `;
    return rowToStockMove(row);
  });
}

export async function getStockOnHand(tenantId: string, productId: string, locationId?: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const inboundRows = locationId
      ? await tx`SELECT COALESCE(SUM(quantity), 0) as total FROM stock_move WHERE product_id = ${productId} AND location_id = ${locationId}`
      : await tx`SELECT COALESCE(SUM(quantity), 0) as total FROM stock_move WHERE product_id = ${productId} AND location_id IS NOT NULL`;
    const outboundRows = locationId
      ? await tx`SELECT COALESCE(SUM(quantity), 0) as total FROM stock_move WHERE product_id = ${productId} AND source_location_id = ${locationId}`
      : await tx`SELECT COALESCE(SUM(quantity), 0) as total FROM stock_move WHERE product_id = ${productId} AND source_location_id IS NOT NULL`;

    const inbound = Number(inboundRows[0].total);
    const outbound = Number(outboundRows[0].total);
    return inbound - outbound;
  });
}
