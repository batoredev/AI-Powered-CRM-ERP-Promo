import { withTenant } from '../db/with-tenant';
import { nextDocumentNumber } from './document-sequence';
import { getContact } from '../crm/contacts';
import { getProduct } from './products';

export type SalesOrderStatus = 'draft' | 'confirmed' | 'fulfilled' | 'cancelled';
export type ApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn';

export interface SalesOrder {
  id: string;
  tenantId: string;
  contactId: string;
  documentNumber: number;
  approvalState: ApprovalState;
  status: SalesOrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesOrderLine {
  id: string;
  salesOrderId: string;
  productId: string;
  quantity: number;
  unitPriceMinorUnits: number;
  currencyCode: string;
}

export interface NewSalesOrder {
  contactId: string;
  lines: Array<{ productId: string; quantity: number; unitPriceMinorUnits: number; currencyCode: string }>;
}

function rowToSalesOrder(row: any): SalesOrder {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    documentNumber: Number(row.document_number),
    approvalState: row.approval_state,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSalesOrderLine(row: any): SalesOrderLine {
  return {
    id: row.id,
    salesOrderId: row.sales_order_id,
    productId: row.product_id,
    quantity: Number(row.quantity),
    unitPriceMinorUnits: Number(row.unit_price_minor_units),
    currencyCode: row.currency_code,
  };
}

export async function createSalesOrder(tenantId: string, input: NewSalesOrder): Promise<SalesOrder> {
  const contact = await getContact(tenantId, input.contactId);
  if (!contact) {
    throw new Error(`Invalid contact reference: ${input.contactId} does not belong to this tenant`);
  }
  for (const line of input.lines) {
    const product = await getProduct(tenantId, line.productId);
    if (!product) {
      throw new Error(`Invalid product reference: ${line.productId} does not belong to this tenant`);
    }
  }

  const documentNumber = await nextDocumentNumber(tenantId, 'sales_order');

  return withTenant(tenantId, async (tx) => {
    const [soRow] = await tx`
      INSERT INTO sales_order (tenant_id, contact_id, document_number)
      VALUES (${tenantId}, ${input.contactId}, ${documentNumber})
      RETURNING *
    `;

    for (const line of input.lines) {
      await tx`
        INSERT INTO sales_order_line (tenant_id, sales_order_id, product_id, quantity, unit_price_minor_units, currency_code)
        VALUES (${tenantId}, ${soRow.id}, ${line.productId}, ${line.quantity}, ${line.unitPriceMinorUnits}, ${line.currencyCode})
      `;
    }

    return rowToSalesOrder(soRow);
  });
}

export async function getSalesOrder(tenantId: string, id: string): Promise<SalesOrder | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM sales_order WHERE id = ${id}`;
    return rows.length > 0 ? rowToSalesOrder(rows[0]) : null;
  });
}

export async function listSalesOrderLines(tenantId: string, salesOrderId: string): Promise<SalesOrderLine[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM sales_order_line WHERE sales_order_id = ${salesOrderId} ORDER BY id`;
    return rows.map(rowToSalesOrderLine);
  });
}

export async function confirmSalesOrder(tenantId: string, id: string): Promise<SalesOrder | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE sales_order
      SET status = 'confirmed', updated_at = now()
      WHERE id = ${id} AND status = 'draft'
      RETURNING *
    `;
    return rows.length > 0 ? rowToSalesOrder(rows[0]) : null;
  });
}
