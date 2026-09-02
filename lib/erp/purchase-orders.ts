import { withTenant } from '../db/with-tenant';
import { nextDocumentNumber } from './document-sequence';
import { recordStockMove } from './stock';

export type PurchaseOrderStatus = 'draft' | 'submitted' | 'received' | 'cancelled';
export type ApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn';

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  vendorId: string;
  documentNumber: number;
  approvalState: ApprovalState;
  status: PurchaseOrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  productId: string;
  quantity: number;
  unitPriceMinorUnits: number;
  currencyCode: string;
}

export interface NewPurchaseOrder {
  vendorId: string;
  lines: Array<{ productId: string; quantity: number; unitPriceMinorUnits: number; currencyCode: string }>;
}

function rowToPurchaseOrder(row: any): PurchaseOrder {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    vendorId: row.vendor_id,
    documentNumber: Number(row.document_number),
    approvalState: row.approval_state,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPurchaseOrderLine(row: any): PurchaseOrderLine {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    productId: row.product_id,
    quantity: Number(row.quantity),
    unitPriceMinorUnits: Number(row.unit_price_minor_units),
    currencyCode: row.currency_code,
  };
}

export async function createPurchaseOrder(tenantId: string, input: NewPurchaseOrder): Promise<PurchaseOrder> {
  const documentNumber = await nextDocumentNumber(tenantId, 'purchase_order');

  return withTenant(tenantId, async (tx) => {
    const [poRow] = await tx`
      INSERT INTO purchase_order (tenant_id, vendor_id, document_number)
      VALUES (${tenantId}, ${input.vendorId}, ${documentNumber})
      RETURNING *
    `;

    for (const line of input.lines) {
      await tx`
        INSERT INTO purchase_order_line (tenant_id, purchase_order_id, product_id, quantity, unit_price_minor_units, currency_code)
        VALUES (${tenantId}, ${poRow.id}, ${line.productId}, ${line.quantity}, ${line.unitPriceMinorUnits}, ${line.currencyCode})
      `;
    }

    return rowToPurchaseOrder(poRow);
  });
}

export async function getPurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrder | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM purchase_order WHERE id = ${id}`;
    return rows.length > 0 ? rowToPurchaseOrder(rows[0]) : null;
  });
}

export async function listPurchaseOrderLines(tenantId: string, purchaseOrderId: string): Promise<PurchaseOrderLine[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM purchase_order_line WHERE purchase_order_id = ${purchaseOrderId} ORDER BY id`;
    return rows.map(rowToPurchaseOrderLine);
  });
}

export async function submitPurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrder | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE purchase_order
      SET status = 'submitted', updated_at = now()
      WHERE id = ${id} AND status = 'draft'
      RETURNING *
    `;
    return rows.length > 0 ? rowToPurchaseOrder(rows[0]) : null;
  });
}

export async function receivePurchaseOrder(
  tenantId: string,
  purchaseOrderId: string,
  locationId: string,
): Promise<PurchaseOrder | null> {
  const po = await getPurchaseOrder(tenantId, purchaseOrderId);
  if (!po || po.status !== 'submitted') {
    return null;
  }

  const lines = await listPurchaseOrderLines(tenantId, purchaseOrderId);
  for (const line of lines) {
    await recordStockMove(tenantId, {
      productId: line.productId,
      locationId,
      quantity: line.quantity,
      movementType: 'receipt',
      reference: `PO #${po.documentNumber}`,
    });
  }

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE purchase_order
      SET status = 'received', updated_at = now()
      WHERE id = ${purchaseOrderId} AND status = 'submitted'
      RETURNING *
    `;
    return rows.length > 0 ? rowToPurchaseOrder(rows[0]) : null;
  });
}
