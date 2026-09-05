import { withTenant } from '../db/with-tenant';
import { nextDocumentNumberTx } from './document-sequence';
import { getContact } from '../crm/contacts';
import { getInvoice } from './invoices';

export interface Payment {
  id: string;
  tenantId: string;
  contactId: string;
  documentNumber: number;
  amountMinorUnits: number;
  currencyCode: string;
  receivedAt: Date;
  method: string;
  createdAt: Date;
}

export interface NewPayment {
  contactId: string;
  amountMinorUnits: number;
  currencyCode: string;
  receivedAt: string;
  method: string;
}

export interface PaymentAllocation {
  id: string;
  paymentId: string;
  invoiceId: string;
  allocatedAmountMinorUnits: number;
}

function rowToPayment(row: any): Payment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    documentNumber: Number(row.document_number),
    amountMinorUnits: Number(row.amount_minor_units),
    currencyCode: row.currency_code,
    receivedAt: row.received_at,
    method: row.method,
    createdAt: row.created_at,
  };
}

function rowToPaymentAllocation(row: any): PaymentAllocation {
  return {
    id: row.id,
    paymentId: row.payment_id,
    invoiceId: row.invoice_id,
    allocatedAmountMinorUnits: Number(row.allocated_amount_minor_units),
  };
}

export async function createPayment(tenantId: string, input: NewPayment): Promise<Payment> {
  // Validate contactId belongs to this tenant BEFORE any write -- see
  // Global Constraints' FK-validation requirement, and
  // lib/erp/invoices.ts's createInvoice for the reference shape.
  const contact = await getContact(tenantId, input.contactId);
  if (!contact) {
    throw new Error(`Invalid contact reference: ${input.contactId} does not belong to this tenant`);
  }

  return withTenant(tenantId, async (tx) => {
    // Numbering and insert share this transaction (nextDocumentNumberTx,
    // not nextDocumentNumber) so a failure never leaves a permanent gap
    // in payment numbers -- same convention as createInvoice.
    const documentNumber = await nextDocumentNumberTx(tx, tenantId, 'payment');

    const [row] = await tx`
      INSERT INTO payment (tenant_id, contact_id, document_number, amount_minor_units, currency_code, received_at, method)
      VALUES (${tenantId}, ${input.contactId}, ${documentNumber}, ${input.amountMinorUnits}, ${input.currencyCode}, ${input.receivedAt}, ${input.method})
      RETURNING *
    `;
    return rowToPayment(row);
  });
}

export async function getPayment(tenantId: string, id: string): Promise<Payment | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM payment WHERE id = ${id}`;
    return rows.length > 0 ? rowToPayment(rows[0]) : null;
  });
}

export async function recordPaymentAllocation(
  tenantId: string,
  paymentId: string,
  invoiceId: string,
  allocatedAmountMinorUnits: number,
): Promise<PaymentAllocation> {
  const payment = await getPayment(tenantId, paymentId);
  if (!payment) {
    throw new Error(`Invalid payment reference: ${paymentId} does not belong to this tenant`);
  }
  const invoice = await getInvoice(tenantId, invoiceId);
  if (!invoice) {
    throw new Error(`Invalid invoice reference: ${invoiceId} does not belong to this tenant`);
  }

  return withTenant(tenantId, async (tx) => {
    // Application-layer cap check, inside the SAME transaction as the
    // insert below, so a concurrent allocation against the same payment
    // can't race past the cap between the check and the insert.
    const existing = await tx`
      SELECT COALESCE(SUM(allocated_amount_minor_units), 0) AS total
      FROM payment_allocation
      WHERE payment_id = ${paymentId}
    `;
    const alreadyAllocated = Number(existing[0].total);
    if (alreadyAllocated + allocatedAmountMinorUnits > payment.amountMinorUnits) {
      throw new Error(
        `Allocation of ${allocatedAmountMinorUnits} would exceed payment ${paymentId}'s remaining balance ` +
          `(${payment.amountMinorUnits - alreadyAllocated} of ${payment.amountMinorUnits} remaining)`,
      );
    }

    const [row] = await tx`
      INSERT INTO payment_allocation (tenant_id, payment_id, invoice_id, allocated_amount_minor_units)
      VALUES (${tenantId}, ${paymentId}, ${invoiceId}, ${allocatedAmountMinorUnits})
      RETURNING *
    `;
    return rowToPaymentAllocation(row);
  });
}

export async function listPaymentAllocations(tenantId: string, paymentId: string): Promise<PaymentAllocation[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM payment_allocation WHERE payment_id = ${paymentId} ORDER BY created_at ASC`;
    return rows.map(rowToPaymentAllocation);
  });
}
