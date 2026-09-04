import { withTenant } from '../db/with-tenant';
import { nextDocumentNumber } from './document-sequence';
import { listOperations } from './routing';
import { getBom, listBomComponents } from './bom';
import { getLocation } from './locations';

export type ManufacturingOrderStatus = 'draft' | 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type ApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn';

export interface ManufacturingOrder {
  id: string;
  tenantId: string;
  productId: string;
  billOfMaterialsId: string;
  quantity: number;
  targetLocationId: string;
  documentNumber: number;
  approvalState: ApprovalState;
  status: ManufacturingOrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewManufacturingOrder {
  productId: string;
  billOfMaterialsId: string;
  quantity: number;
  targetLocationId: string;
}

export function rowToManufacturingOrder(row: any): ManufacturingOrder {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    billOfMaterialsId: row.bill_of_materials_id,
    quantity: Number(row.quantity),
    targetLocationId: row.target_location_id,
    documentNumber: Number(row.document_number),
    approvalState: row.approval_state,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createManufacturingOrder(
  tenantId: string,
  input: NewManufacturingOrder,
): Promise<ManufacturingOrder> {
  const documentNumber = await nextDocumentNumber(tenantId, 'manufacturing_order');

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO manufacturing_order (tenant_id, product_id, bill_of_materials_id, quantity, target_location_id, document_number)
      VALUES (${tenantId}, ${input.productId}, ${input.billOfMaterialsId}, ${input.quantity}, ${input.targetLocationId}, ${documentNumber})
      RETURNING *
    `;
    return rowToManufacturingOrder(row);
  });
}

export async function getManufacturingOrder(tenantId: string, id: string): Promise<ManufacturingOrder | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM manufacturing_order WHERE id = ${id}`;
    return rows.length > 0 ? rowToManufacturingOrder(rows[0]) : null;
  });
}

export type WorkOrderStatus = 'pending' | 'in_progress' | 'done';

export interface WorkOrder {
  id: string;
  manufacturingOrderId: string;
  operationId: string | null;
  status: WorkOrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

function rowToWorkOrder(row: any): WorkOrder {
  return {
    id: row.id,
    manufacturingOrderId: row.manufacturing_order_id,
    operationId: row.operation_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listWorkOrders(tenantId: string, manufacturingOrderId: string): Promise<WorkOrder[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM work_order WHERE manufacturing_order_id = ${manufacturingOrderId} ORDER BY created_at ASC`;
    return rows.map(rowToWorkOrder);
  });
}

export async function planManufacturingOrder(
  tenantId: string,
  manufacturingOrderId: string,
): Promise<ManufacturingOrder | null> {
  // Same atomic guard as submitPurchaseOrder: only a genuinely-draft MO
  // can be planned, and the WHERE clause makes this race-safe.
  const planned = await withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE manufacturing_order
      SET status = 'planned', updated_at = now()
      WHERE id = ${manufacturingOrderId} AND status = 'draft'
      RETURNING *
    `;
    return rows.length > 0 ? rowToManufacturingOrder(rows[0]) : null;
  });

  if (!planned) {
    return null;
  }

  const bom = await getBom(tenantId, planned.billOfMaterialsId);
  if (bom?.routingId) {
    const operations = await listOperations(tenantId, bom.routingId);
    for (const operation of operations) {
      await withTenant(tenantId, async (tx) => {
        await tx`
          INSERT INTO work_order (tenant_id, manufacturing_order_id, operation_id, status)
          VALUES (${tenantId}, ${manufacturingOrderId}, ${operation.id}, 'pending')
        `;
      });
    }
  }

  return planned;
}

export async function completeManufacturingOrder(
  tenantId: string,
  manufacturingOrderId: string,
  componentSourceLocationId: string,
): Promise<ManufacturingOrder | null> {
  // LESSON 1 (Phase 3A-2 postmortem, F1): validate every location
  // argument belongs to this tenant BEFORE any write, exactly like
  // receivePurchaseOrder's getLocation check. completeManufacturingOrder
  // takes two locations — the component source (this parameter) and the
  // MO's own targetLocationId (read below, before the transaction).
  const componentSource = await getLocation(tenantId, componentSourceLocationId);
  if (!componentSource) {
    return null;
  }

  const mo = await getManufacturingOrder(tenantId, manufacturingOrderId);
  if (!mo) {
    return null;
  }
  // The MO's targetLocationId was already validated as belonging to this
  // tenant at creation time (the FK + RLS on location(id) via
  // createManufacturingOrder's own withTenant call guarantee this), but
  // re-validate here defensively rather than assuming a value read off
  // an old row is still valid — getLocation is cheap and this is the
  // exact pattern the postmortem requires "before any write".
  const targetLocation = await getLocation(tenantId, mo.targetLocationId);
  if (!targetLocation) {
    return null;
  }

  const components = await listBomComponents(tenantId, mo.billOfMaterialsId);

  // LESSON 2 (Phase 3A-2 postmortem, F3): the status-flip UPDATE and
  // every resulting stock_move insert share ONE transaction — either
  // everything commits (status flips to 'completed' AND all component
  // consumption AND the finished-good receipt are recorded) or nothing
  // does. No partial "completed but under-consumed" states.
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE manufacturing_order
      SET status = 'completed', updated_at = now()
      WHERE id = ${manufacturingOrderId} AND status IN ('planned', 'in_progress')
      RETURNING *
    `;
    if (rows.length === 0) {
      return null;
    }
    const updatedMo = rowToManufacturingOrder(rows[0]);

    // Consume each BoM component (quantity per unit * MO quantity) as an
    // outbound stock_move from the component source location — inlined
    // on this tx, same shape as recordStockMove's own INSERT, per Lesson 2.
    for (const component of components) {
      const consumedQuantity = component.quantity * updatedMo.quantity;
      await tx`
        INSERT INTO stock_move (tenant_id, product_id, location_id, source_location_id, quantity, movement_type, reference)
        VALUES (${tenantId}, ${component.componentProductId}, ${null}, ${componentSourceLocationId}, ${consumedQuantity}, ${'shipment'}, ${`MO #${updatedMo.documentNumber}`})
      `;
    }

    // Receive the finished good into the MO's target location.
    await tx`
      INSERT INTO stock_move (tenant_id, product_id, location_id, source_location_id, quantity, movement_type, reference)
      VALUES (${tenantId}, ${updatedMo.productId}, ${updatedMo.targetLocationId}, ${null}, ${updatedMo.quantity}, ${'receipt'}, ${`MO #${updatedMo.documentNumber}`})
    `;

    return updatedMo;
  });
}
