import { withTenant } from '../db/with-tenant';
import { nextDocumentNumber } from './document-sequence';

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
