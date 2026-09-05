import { withTenant } from '../db/with-tenant';
import { nextDocumentNumberTx } from './document-sequence';
import { getSalesOrder } from './sales-orders';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';
export type InvoiceSourceType = 'sales_order' | 'time_entries' | 'subscription';
export type ApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn';

export interface Invoice {
  id: string;
  tenantId: string;
  sourceType: InvoiceSourceType;
  salesOrderId: string | null;
  documentNumber: number;
  approvalState: ApprovalState;
  status: InvoiceStatus;
  dueDate: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPriceMinorUnits: number;
  currencyCode: string;
}

export interface NewInvoice {
  sourceType: InvoiceSourceType;
  salesOrderId?: string;
  dueDate: string;
  lines: Array<{ description: string; quantity: number; unitPriceMinorUnits: number; currencyCode: string }>;
}

function rowToInvoice(row: any): Invoice {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sourceType: row.source_type,
    salesOrderId: row.sales_order_id,
    documentNumber: Number(row.document_number),
    approvalState: row.approval_state,
    status: row.status,
    dueDate: row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToInvoiceLine(row: any): InvoiceLine {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    description: row.description,
    quantity: Number(row.quantity),
    unitPriceMinorUnits: Number(row.unit_price_minor_units),
    currencyCode: row.currency_code,
  };
}

export async function createInvoice(tenantId: string, input: NewInvoice): Promise<Invoice> {
  // Validate salesOrderId belongs to this tenant BEFORE any write -- see
  // Global Constraints' FK-validation requirement, and
  // lib/erp/sales-orders.ts's createSalesOrder for the reference shape.
  if (input.sourceType === 'sales_order') {
    if (!input.salesOrderId) {
      throw new Error('salesOrderId is required when sourceType is "sales_order"');
    }
    const salesOrder = await getSalesOrder(tenantId, input.salesOrderId);
    if (!salesOrder) {
      throw new Error(`Invalid sales order reference: ${input.salesOrderId} does not belong to this tenant`);
    }
  }

  return withTenant(tenantId, async (tx) => {
    // Numbering and insert share this transaction (nextDocumentNumberTx,
    // not nextDocumentNumber) so a failure never leaves a permanent gap
    // in invoice numbers -- see this plan's Global Constraints.
    const documentNumber = await nextDocumentNumberTx(tx, tenantId, 'invoice');

    const [invRow] = await tx`
      INSERT INTO invoice (tenant_id, source_type, sales_order_id, document_number, due_date)
      VALUES (${tenantId}, ${input.sourceType}, ${input.salesOrderId ?? null}, ${documentNumber}, ${input.dueDate})
      RETURNING *
    `;

    for (const line of input.lines) {
      await tx`
        INSERT INTO invoice_line (tenant_id, invoice_id, description, quantity, unit_price_minor_units, currency_code)
        VALUES (${tenantId}, ${invRow.id}, ${line.description}, ${line.quantity}, ${line.unitPriceMinorUnits}, ${line.currencyCode})
      `;
    }

    return rowToInvoice(invRow);
  });
}

export async function getInvoice(tenantId: string, id: string): Promise<Invoice | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM invoice WHERE id = ${id}`;
    return rows.length > 0 ? rowToInvoice(rows[0]) : null;
  });
}

export async function listInvoiceLines(tenantId: string, invoiceId: string): Promise<InvoiceLine[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM invoice_line WHERE invoice_id = ${invoiceId} ORDER BY id`;
    return rows.map(rowToInvoiceLine);
  });
}

export async function markInvoiceSent(tenantId: string, id: string): Promise<Invoice | null> {
  // Atomic UPDATE ... WHERE status = 'draft' RETURNING * guard -- same
  // race-safe pattern as submitPurchaseOrder in lib/erp/purchase-orders.ts.
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE invoice
      SET status = 'sent', updated_at = now()
      WHERE id = ${id} AND status = 'draft'
      RETURNING *
    `;
    return rows.length > 0 ? rowToInvoice(rows[0]) : null;
  });
}

export async function voidInvoice(tenantId: string, id: string): Promise<Invoice | null> {
  // Atomic UPDATE ... WHERE status IN ('draft', 'sent') RETURNING * guard --
  // a paid invoice cannot be voided through this function.
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE invoice
      SET status = 'void', updated_at = now()
      WHERE id = ${id} AND status IN ('draft', 'sent')
      RETURNING *
    `;
    return rows.length > 0 ? rowToInvoice(rows[0]) : null;
  });
}
