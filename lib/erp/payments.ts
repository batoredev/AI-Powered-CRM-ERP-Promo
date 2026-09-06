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
    // Row lock on the payment itself BEFORE the cap check, closing a race
    // that "same transaction" alone does not: under plain READ COMMITTED,
    // two concurrent recordPaymentAllocation calls against the same
    // payment_id could both run the SUM check, both see the pre-allocation
    // total, and both pass, over-allocating past the cap before either
    // commits (SUM is not a row lock). SELECT ... FOR UPDATE here forces
    // the second concurrent caller to block until the first transaction
    // commits or rolls back, so its subsequent SUM genuinely reflects the
    // first caller's just-inserted allocation. Found by final-review
    // adversarial reasoning during Phase 3A-5 Task 3's review. Note this
    // is NOT the same mechanism Phase 3A-2's receivePurchaseOrder fix
    // (commit 89a7ef1) used for its double-receive race -- that one used
    // an atomic UPDATE...WHERE status=...RETURNING * guard, not a row
    // lock. This is this codebase's first explicit FOR UPDATE (confirmed
    // via `grep -rn "FOR UPDATE" lib/` during the final whole-branch
    // review) -- a genuinely different tool for a genuinely different
    // problem shape (an aggregate invariant across sibling rows, not a
    // single-row status transition), not an application of an existing
    // house pattern.
    await tx`SELECT 1 FROM payment WHERE id = ${paymentId} FOR UPDATE`;

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
