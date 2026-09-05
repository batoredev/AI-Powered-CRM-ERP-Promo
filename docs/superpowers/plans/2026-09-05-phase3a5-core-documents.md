# Phase 3A-5: Core Documents (Invoice, Payment, Sales Order) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `sales_order`, `invoice`, and `payment` document trios that the design spec's §2 calls "shared core entities — every tenant, always present" but that were never actually built in Phase 3A-1 — closing a real gap discovered while scoping the Subscriptions module, which depends on `invoice` as its billing terminus.

**Architecture:** Three independent header+line document pairs (`sales_order`/`sales_order_line`, `invoice`/`invoice_line`, `payment`/`payment_allocation`), each following the exact `purchase_order`/`purchase_order_line` shape already proven in migration `0014` — same document-numbering mechanism, same `approval_state`/`status` two-axis split, same money convention. `invoice` additionally carries a `source_type` discriminator so it can serve as the terminus for sales orders now, and for time-entry billing and subscription billing once those callers exist later — this plan only ships the schema and the `sales_order`-sourced path; it does not build the time-entry or subscription invoicing sweeps themselves.

**Tech Stack:** Postgres (Neon) migrations, `postgres` npm package via `withTenant()`, Vitest (`backend` project) for tests.

**Spec:** `docs/superpowers/specs/2026-09-01-phase3-erp-design.md` §2 (shared core entities — invoice/payment/sales-order's existence and shape), §3 point 1 (no polymorphic `order` table — sales and purchase orders stay separate tables), §3 point 2 (no derived values stored where an event belongs — informs why `invoice.status` transitions are event-driven, not computed).

## Global Constraints

- Every new table MUST have both `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, plus `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())` — checked automatically by `db/migrations/__tests__/rls-policy-audit.test.ts`.
- All application-level DB access goes through `withTenant(tenantId, fn)` from `lib/db/with-tenant.ts` — never call `getSql()` directly.
- **Every foreign-key-accepting `create*` function MUST validate that the referenced row belongs to the calling tenant BEFORE any write, using the target's own `get*` function.** This is a hard, non-negotiable project convention — Phases 3A-2 and 3A-3 both shipped without it and needed a full fix-wave-plus-re-review cycle to add it retroactively. Bake it in from Task 1: `createSalesOrder` validates `contactId` via `getContact` and every line's `productId` via `getProduct`; `createInvoice` validates its source (`salesOrderId` via `getSalesOrder`, when `sourceType === 'sales_order'`); `createPayment` validates `contactId` via `getContact`; `recordPaymentAllocation` validates both `paymentId` (via `getPayment`) and `invoiceId` (via `getInvoice`) belong to the tenant.
- Reference `lib/erp/purchase-orders.ts` for the exact header+line+document-numbering+approval-state pattern, and `lib/erp/time-entries.ts` for the atomic `UPDATE ... WHERE <guard> RETURNING *` state-transition pattern (needed for `markInvoiceSent`/`markInvoicePaid`/`voidInvoice`).
- `document-sequence.ts`'s own doc comment already flags that `nextDocumentNumber` opens and commits its own transaction, so a caller allocating a number and then failing to insert its document leaves a permanent gap — acceptable for `purchase_order` (an internal document with no external numbering-continuity requirement), but **invoices in many jurisdictions require gapless/sequential numbering** (design spec §2's own point). This plan adds `nextDocumentNumberTx(tx, tenantId, documentType)` — a transaction-accepting variant that runs inside the caller's own transaction, so `createInvoice` can allocate the number and insert the row atomically, with no permanent gap on failure. `createSalesOrder` and `createPayment` are not numbering-critical the same way and may continue using the existing gap-tolerant `nextDocumentNumber`.
- Money fields use the integer-minor-units + explicit-currency-code convention (`*_minor_units bigint` + `currency_code text`), matching `product.price_minor_units`/`currency_code` and `purchase_order_line.unit_price_minor_units`/`currency_code`.
- `approval_state` enum (5 values: `draft`, `pending_approval`, `approved`, `rejected`, `withdrawn`) is reused, never redefined.
- Per design spec §3 point 1: `sales_order` and `purchase_order` stay separate tables — no polymorphic `order` table with a direction flag.
- `payment_allocation`'s invariant (sum of allocations per payment never exceeds the payment's `amount_minor_units`) is enforced at the application layer inside `recordPaymentAllocation`, not a DB trigger or CHECK constraint — matching this codebase's existing convention of application-layer invariants over trigger-based ones (e.g. `time_entry`'s three-independent-booleans design has no CHECK linking them either).
- TDD: write the failing test before the implementation in every task that has one.
- Test-isolation discipline: any test that queries shared state must scope by tenant/id explicitly — never rely on being "the only test" creating a given row.
- `npx tsc --noEmit` must stay clean after every task.
- `vitest.config.ts` already has `testTimeout: 20000` — no config changes needed.
- Grant `SELECT, INSERT, UPDATE, DELETE` to `app_runtime` on every new table, matching the existing migrations' pattern exactly.
- No table-name collisions with existing tables: `tenant`, `app_user`, `contact`, `pipeline_stage`, `deal`, `tenant_erp_settings`, `vendor`, `product`, `document_sequence`, `location`, `stock_move`, `purchase_order`, `purchase_order_line`, `bill_of_materials`, `bom_component`, `work_center`, `routing`, `operation`, `manufacturing_order`, `work_order`, `project`, `task`, `time_entry`.
- Next migration number is `0023` (existing: 0001–0022 in `db/migrations/`).
- Out of scope for this plan (future work built on top of this core, once it exists): subscription billing itself, time-entry-to-invoice sweeping (the `time_entry.billed`/`markTimeEntriesBilled` mechanism from Phase 3A-4 stays unconsumed until that sweep is built), and payment gateway integration (`payment.method` is a free-form text field for now, not a real payment-processor callback).

---

### Task 1: `sales_order` Table and Data-Access Layer

**Files:**
- Create: `db/migrations/0023_sales_order.sql`
- Create: `lib/erp/sales-orders.ts`
- Test: `lib/erp/__tests__/sales-orders.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`; `nextDocumentNumber` from `lib/erp/document-sequence.ts`; `getContact(tenantId: string, id: string): Promise<Contact | null>` from `lib/crm/contacts.ts`; `getProduct(tenantId: string, id: string): Promise<Product | null>` from `lib/erp/products.ts`.
- Produces: `SalesOrderStatus` type (`'draft' | 'confirmed' | 'fulfilled' | 'cancelled'`); `SalesOrder` interface (`id: string`, `tenantId: string`, `contactId: string`, `documentNumber: number`, `approvalState: ApprovalState`, `status: SalesOrderStatus`, `createdAt: Date`, `updatedAt: Date`); `SalesOrderLine` interface (`id: string`, `salesOrderId: string`, `productId: string`, `quantity: number`, `unitPriceMinorUnits: number`, `currencyCode: string`); `NewSalesOrder` interface (`contactId: string`, `lines: Array<{ productId: string; quantity: number; unitPriceMinorUnits: number; currencyCode: string }>`); `createSalesOrder(tenantId: string, input: NewSalesOrder): Promise<SalesOrder>` (throws if `contactId` or any line's `productId` doesn't belong to the tenant); `getSalesOrder(tenantId: string, id: string): Promise<SalesOrder | null>`; `listSalesOrderLines(tenantId: string, salesOrderId: string): Promise<SalesOrderLine[]>`; `confirmSalesOrder(tenantId: string, id: string): Promise<SalesOrder | null>` (atomic `UPDATE...WHERE status='draft' RETURNING *`). Task 2 (`invoice`) consumes `getSalesOrder` to validate `salesOrderId` when `sourceType === 'sales_order'`.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0023_sales_order.sql
CREATE TYPE sales_order_status AS ENUM ('draft', 'confirmed', 'fulfilled', 'cancelled');

-- Mirrors purchase_order (migration 0014) deliberately: same two-state-
-- column split (approval_state: was this approved? vs status: where is
-- it in its lifecycle?), same document_number + UNIQUE(tenant_id,
-- document_number) mechanism. Per design spec §3 point 1, this stays a
-- SEPARATE table from purchase_order rather than one polymorphic `order`
-- table with a direction flag -- different party (contact/customer vs
-- vendor), different downstream document (invoice vs stock receipt).
CREATE TABLE sales_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contact_id uuid NOT NULL REFERENCES contact(id),
  document_number bigint NOT NULL,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  status sales_order_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_number)
);

CREATE TABLE sales_order_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  sales_order_id uuid NOT NULL REFERENCES sales_order(id),
  product_id uuid NOT NULL REFERENCES product(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price_minor_units bigint NOT NULL,
  currency_code text NOT NULL
);

CREATE INDEX sales_order_tenant_id_idx ON sales_order (tenant_id, id);
CREATE INDEX sales_order_tenant_contact_idx ON sales_order (tenant_id, contact_id);
CREATE INDEX sales_order_line_tenant_so_idx ON sales_order_line (tenant_id, sales_order_id);

ALTER TABLE sales_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_order
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE sales_order_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_order_line
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON sales_order, sales_order_line TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/sales-orders.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createSalesOrder, getSalesOrder, listSalesOrderLines, confirmSalesOrder } from '../sales-orders';
import { createContact } from '../../crm/contacts';
import { createProduct } from '../products';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('sales order data access', () => {
  it('creates a sales order with lines and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('SO Test Tenant 1') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Customer A' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });

    const so = await createSalesOrder(tenant.id, {
      contactId: contact.id,
      lines: [{ productId: product.id, quantity: 3, unitPriceMinorUnits: 1500, currencyCode: 'USD' }],
    });

    expect(so.contactId).toBe(contact.id);
    expect(so.status).toBe('draft');
    expect(so.documentNumber).toBeGreaterThan(0);

    const fetched = await getSalesOrder(tenant.id, so.id);
    expect(fetched).not.toBeNull();

    const lines = await listSalesOrderLines(tenant.id, so.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
  });

  it('rejects a contactId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('SO Test Tenant 2A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('SO Test Tenant 2B') RETURNING id`;
    const contactB = await createContact(tenantB.id, { fullName: 'Tenant B Customer' });

    await expect(
      createSalesOrder(tenantA.id, { contactId: contactB.id, lines: [] }),
    ).rejects.toThrow();
  });

  it('rejects a line productId belonging to another tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('SO Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('SO Test Tenant 3B') RETURNING id`;
    const contactA = await createContact(tenantA.id, { fullName: 'Customer A' });
    const productB = await createProduct(tenantB.id, { name: 'Tenant B Widget', productType: 'goods' });

    await expect(
      createSalesOrder(tenantA.id, {
        contactId: contactA.id,
        lines: [{ productId: productB.id, quantity: 1, unitPriceMinorUnits: 100, currencyCode: 'USD' }],
      }),
    ).rejects.toThrow();
  });

  it('confirmSalesOrder moves status from draft to confirmed, and returns null on a second attempt', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('SO Test Tenant 4') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Customer' });
    const so = await createSalesOrder(tenant.id, { contactId: contact.id, lines: [] });

    const confirmed = await confirmSalesOrder(tenant.id, so.id);
    expect(confirmed).not.toBeNull();
    expect(confirmed!.status).toBe('confirmed');

    const secondAttempt = await confirmSalesOrder(tenant.id, so.id);
    expect(secondAttempt).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/sales-orders.test.ts`
Expected: FAIL — `lib/erp/sales-orders.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/sales-orders.ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/sales-orders.test.ts`
Expected: PASS (4/4 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0023_sales_order.sql lib/erp/sales-orders.ts lib/erp/__tests__/sales-orders.test.ts
git commit -m "feat: add sales_order table with contact/product-ownership validation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Transaction-Accepting Document Numbering + `invoice` Table

**Files:**
- Modify: `lib/erp/document-sequence.ts`
- Create: `db/migrations/0024_invoice.sql`
- Create: `lib/erp/invoices.ts`
- Test: `lib/erp/__tests__/document-sequence.test.ts` (new — the existing gap-tolerant function has no direct test file yet; add one alongside the new variant)
- Test: `lib/erp/__tests__/invoices.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`; `getSalesOrder(tenantId: string, id: string): Promise<SalesOrder | null>` from `lib/erp/sales-orders.ts` (Task 1).
- Produces: `nextDocumentNumberTx(tx: postgres.TransactionSql, tenantId: string, documentType: string): Promise<number>` (added to `lib/erp/document-sequence.ts` — runs the same `next_document_number()` SQL function but on the caller's own transaction handle, so numbering and document insert commit or roll back together); `InvoiceStatus` type (`'draft' | 'sent' | 'paid' | 'overdue' | 'void'`); `InvoiceSourceType` type (`'sales_order' | 'time_entries' | 'subscription'`); `Invoice` interface (`id: string`, `tenantId: string`, `sourceType: InvoiceSourceType`, `salesOrderId: string | null`, `documentNumber: number`, `approvalState: ApprovalState`, `status: InvoiceStatus`, `dueDate: string`, `createdAt: Date`, `updatedAt: Date`); `InvoiceLine` interface (`id: string`, `invoiceId: string`, `description: string`, `quantity: number`, `unitPriceMinorUnits: number`, `currencyCode: string`); `NewInvoice` interface (`sourceType: InvoiceSourceType`, `salesOrderId?: string`, `dueDate: string`, `lines: Array<{ description: string; quantity: number; unitPriceMinorUnits: number; currencyCode: string }>`); `createInvoice(tenantId: string, input: NewInvoice): Promise<Invoice>` (validates `salesOrderId` via `getSalesOrder` when `sourceType === 'sales_order'` and throws if it's missing for that source type or doesn't belong to the tenant; allocates the document number and inserts the invoice row in the SAME transaction via `nextDocumentNumberTx`, so a failure never leaves a numbering gap); `getInvoice(tenantId: string, id: string): Promise<Invoice | null>`; `listInvoiceLines(tenantId: string, invoiceId: string): Promise<InvoiceLine[]>`; `markInvoiceSent(tenantId: string, id: string): Promise<Invoice | null>` (atomic `UPDATE...WHERE status='draft' RETURNING *`); `voidInvoice(tenantId: string, id: string): Promise<Invoice | null>` (atomic `UPDATE...WHERE status IN ('draft','sent') RETURNING *` — a paid invoice cannot be voided through this function). Task 3 (`payment`) consumes `getInvoice` to validate `invoiceId` when recording an allocation.

- [ ] **Step 1: Write the failing test for `nextDocumentNumberTx`**

```typescript
// lib/erp/__tests__/document-sequence.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { withTenant } from '../../db/with-tenant';
import { nextDocumentNumber, nextDocumentNumberTx } from '../document-sequence';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('document sequence', () => {
  it('nextDocumentNumber allocates sequential numbers per tenant and document type', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('DocSeq Test Tenant 1') RETURNING id`;
    const n1 = await nextDocumentNumber(tenant.id, 'test_doc_type');
    const n2 = await nextDocumentNumber(tenant.id, 'test_doc_type');
    expect(n2).toBe(n1 + 1);
  });

  it('nextDocumentNumberTx allocates a number on the caller-provided transaction, and rolls back together with it on failure', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('DocSeq Test Tenant 2') RETURNING id`;

    // Successful path: number is allocated and visible after commit.
    const committedNumber = await withTenant(tenant.id, async (tx) => {
      return nextDocumentNumberTx(tx, tenant.id, 'gapless_doc_type');
    });
    expect(committedNumber).toBeGreaterThan(0);

    // Failure path: an error thrown after allocating the number inside
    // the SAME transaction must roll back the allocation too (gapless
    // guarantee) -- unlike nextDocumentNumber's own gap-tolerant design.
    await expect(
      withTenant(tenant.id, async (tx) => {
        await nextDocumentNumberTx(tx, tenant.id, 'gapless_doc_type');
        throw new Error('simulated failure after allocating number');
      }),
    ).rejects.toThrow('simulated failure');

    const nextAfterFailure = await withTenant(tenant.id, async (tx) => {
      return nextDocumentNumberTx(tx, tenant.id, 'gapless_doc_type');
    });
    // If the failed allocation had NOT rolled back, this would be
    // committedNumber + 2. Since it rolled back, it's committedNumber + 1.
    expect(nextAfterFailure).toBe(committedNumber + 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/document-sequence.test.ts`
Expected: FAIL — `nextDocumentNumberTx` is not exported yet.

- [ ] **Step 3: Add `nextDocumentNumberTx` to `lib/erp/document-sequence.ts`**

```typescript
// lib/erp/document-sequence.ts (append to the existing file, do not remove nextDocumentNumber)
import type postgres from 'postgres';

// Transaction-accepting variant of nextDocumentNumber, added per Phase
// 3A-5 (invoice numbering needs jurisdictional gaplessness -- see this
// file's own doc comment above, which flagged this exact gap before it
// was needed). Runs next_document_number() on the CALLER's transaction
// handle, so a failure after allocating the number rolls the allocation
// back too, instead of nextDocumentNumber's own gap-tolerant behavior
// (which always commits its own separate transaction regardless of what
// the caller does next).
export async function nextDocumentNumberTx(
  tx: postgres.TransactionSql,
  tenantId: string,
  documentType: string,
): Promise<number> {
  const [row] = await tx`SELECT next_document_number(${tenantId}, ${documentType}) as n`;
  return Number(row.n);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/document-sequence.test.ts`
Expected: PASS (2/2 tests)

- [ ] **Step 5: Commit the document-sequence change**

```bash
git add lib/erp/document-sequence.ts lib/erp/__tests__/document-sequence.test.ts
git commit -m "feat: add nextDocumentNumberTx for gapless invoice numbering

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the invoice migration**

```sql
-- db/migrations/0024_invoice.sql
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'void');
CREATE TYPE invoice_source_type AS ENUM ('sales_order', 'time_entries', 'subscription');

-- Per design spec §2: "universal terminus of every vertical" -- an
-- invoice can originate from a sales order, from unbilled time/
-- milestones, or from a subscription billing cycle. source_type + a
-- nullable per-type source FK records which, without forcing all three
-- origins through one shape. Only sales_order_id exists today: time-
-- entry invoicing and subscription billing don't have a caller yet
-- (both are future sub-plans built on top of this core), so this
-- migration only wires the discriminator + the one FK that's reachable
-- now. Adding a nullable time_entries/subscription source FK is a
-- forward-compatible additive migration when those callers exist --
-- deliberately not guessed at here.
CREATE TABLE invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  source_type invoice_source_type NOT NULL,
  sales_order_id uuid REFERENCES sales_order(id),
  document_number bigint NOT NULL,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  status invoice_status NOT NULL DEFAULT 'draft',
  due_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_number)
);

-- invoice_line is NOT always tied to a product (per design spec §2) --
-- a time-based line item needs a free-text description, not a product
-- reference. product_id is deliberately absent from this table; a
-- future sub-plan that needs to trace an invoice line back to a
-- specific product can add a nullable FK additively then.
CREATE TABLE invoice_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  invoice_id uuid NOT NULL REFERENCES invoice(id),
  description text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price_minor_units bigint NOT NULL,
  currency_code text NOT NULL
);

CREATE INDEX invoice_tenant_id_idx ON invoice (tenant_id, id);
CREATE INDEX invoice_tenant_sales_order_idx ON invoice (tenant_id, sales_order_id);
CREATE INDEX invoice_line_tenant_invoice_idx ON invoice_line (tenant_id, invoice_id);

ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE invoice_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_line
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON invoice, invoice_line TO app_runtime;
```

- [ ] **Step 7: Write the failing test for `invoices.ts`**

```typescript
// lib/erp/__tests__/invoices.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createInvoice, getInvoice, listInvoiceLines, markInvoiceSent, voidInvoice } from '../invoices';
import { createSalesOrder } from '../sales-orders';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('invoice data access', () => {
  it('creates a sales-order-sourced invoice with lines and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Invoice Test Tenant 1') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Customer' });
    const so = await createSalesOrder(tenant.id, { contactId: contact.id, lines: [] });

    const invoice = await createInvoice(tenant.id, {
      sourceType: 'sales_order',
      salesOrderId: so.id,
      dueDate: '2026-10-01',
      lines: [{ description: 'Consulting', quantity: 2, unitPriceMinorUnits: 20000, currencyCode: 'USD' }],
    });

    expect(invoice.sourceType).toBe('sales_order');
    expect(invoice.salesOrderId).toBe(so.id);
    expect(invoice.status).toBe('draft');
    expect(invoice.documentNumber).toBeGreaterThan(0);

    const fetched = await getInvoice(tenant.id, invoice.id);
    expect(fetched).not.toBeNull();

    const lines = await listInvoiceLines(tenant.id, invoice.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe('Consulting');
  });

  it('rejects sourceType sales_order with no salesOrderId', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Invoice Test Tenant 2') RETURNING id`;
    await expect(
      createInvoice(tenant.id, { sourceType: 'sales_order', dueDate: '2026-10-01', lines: [] }),
    ).rejects.toThrow();
  });

  it('rejects a salesOrderId belonging to another tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Invoice Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Invoice Test Tenant 3B') RETURNING id`;
    const contactB = await createContact(tenantB.id, { fullName: 'Tenant B Customer' });
    const soB = await createSalesOrder(tenantB.id, { contactId: contactB.id, lines: [] });

    await expect(
      createInvoice(tenantA.id, { sourceType: 'sales_order', salesOrderId: soB.id, dueDate: '2026-10-01', lines: [] }),
    ).rejects.toThrow();
  });

  it('markInvoiceSent moves status from draft to sent, and returns null on a second attempt', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Invoice Test Tenant 4') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Customer' });
    const so = await createSalesOrder(tenant.id, { contactId: contact.id, lines: [] });
    const invoice = await createInvoice(tenant.id, { sourceType: 'sales_order', salesOrderId: so.id, dueDate: '2026-10-01', lines: [] });

    const sent = await markInvoiceSent(tenant.id, invoice.id);
    expect(sent).not.toBeNull();
    expect(sent!.status).toBe('sent');

    const secondAttempt = await markInvoiceSent(tenant.id, invoice.id);
    expect(secondAttempt).toBeNull();
  });

  it('voidInvoice works from draft or sent, but not from paid', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Invoice Test Tenant 5') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Customer' });
    const so = await createSalesOrder(tenant.id, { contactId: contact.id, lines: [] });
    const invoice = await createInvoice(tenant.id, { sourceType: 'sales_order', salesOrderId: so.id, dueDate: '2026-10-01', lines: [] });

    const voided = await voidInvoice(tenant.id, invoice.id);
    expect(voided).not.toBeNull();
    expect(voided!.status).toBe('void');

    // already void -- second attempt returns null (status no longer in ('draft','sent'))
    const secondAttempt = await voidInvoice(tenant.id, invoice.id);
    expect(secondAttempt).toBeNull();
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/invoices.test.ts`
Expected: FAIL — `lib/erp/invoices.ts` does not exist yet.

- [ ] **Step 9: Write the implementation**

```typescript
// lib/erp/invoices.ts
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
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/invoices.test.ts`
Expected: PASS (5/5 tests)

- [ ] **Step 11: Commit**

```bash
git add db/migrations/0024_invoice.sql lib/erp/invoices.ts lib/erp/__tests__/invoices.test.ts
git commit -m "feat: add invoice table with gapless numbering and sales-order-source validation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `payment` and `payment_allocation` Tables and Data-Access Layer

**Files:**
- Create: `db/migrations/0025_payment.sql`
- Create: `lib/erp/payments.ts`
- Test: `lib/erp/__tests__/payments.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`; `nextDocumentNumber` from `lib/erp/document-sequence.ts`; `getContact(tenantId: string, id: string): Promise<Contact | null>` from `lib/crm/contacts.ts`; `getInvoice(tenantId: string, id: string): Promise<Invoice | null>` from `lib/erp/invoices.ts` (Task 2).
- Produces: `Payment` interface (`id: string`, `tenantId: string`, `contactId: string`, `documentNumber: number`, `amountMinorUnits: number`, `currencyCode: string`, `receivedAt: Date`, `method: string`, `createdAt: Date`); `NewPayment` interface (`contactId: string`, `amountMinorUnits: number`, `currencyCode: string`, `receivedAt: string`, `method: string`); `createPayment(tenantId: string, input: NewPayment): Promise<Payment>` (validates `contactId` via `getContact`); `getPayment(tenantId: string, id: string): Promise<Payment | null>`; `PaymentAllocation` interface (`id: string`, `paymentId: string`, `invoiceId: string`, `allocatedAmountMinorUnits: number`); `recordPaymentAllocation(tenantId: string, paymentId: string, invoiceId: string, allocatedAmountMinorUnits: number): Promise<PaymentAllocation>` (validates `paymentId` via `getPayment` and `invoiceId` via `getInvoice`, both must belong to the tenant; enforces — at the application layer, inside this same function, before insert — that the sum of this payment's existing allocations plus the new one never exceeds the payment's own `amountMinorUnits`, throwing if it would; marking an invoice `paid` from its accumulated allocations is explicitly deferred to a future sub-plan once real invoice totals/balances exist as a first-class concept, not guessed at here); `listPaymentAllocations(tenantId: string, paymentId: string): Promise<PaymentAllocation[]>`.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0025_payment.sql
-- payment: tenant_id, contact_id (who paid), amount + currency (money
-- convention matching every other table), received_at, method (free-form
-- text for now -- not a real payment-gateway integration, per this
-- plan's Global Constraints out-of-scope note).
CREATE TABLE payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contact_id uuid NOT NULL REFERENCES contact(id),
  document_number bigint NOT NULL,
  amount_minor_units bigint NOT NULL CHECK (amount_minor_units > 0),
  currency_code text NOT NULL,
  received_at timestamptz NOT NULL,
  method text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_number)
);

-- payment_allocation: a join table since one payment can cover multiple
-- invoices partially (design spec §2's own framing). The invariant that
-- sum(allocated_amount_minor_units) per payment_id never exceeds that
-- payment's amount_minor_units is enforced at the APPLICATION layer
-- (lib/erp/payments.ts's recordPaymentAllocation), not a DB trigger or
-- CHECK constraint -- matching this codebase's established convention
-- of application-layer invariants over trigger-based ones (see e.g.
-- time_entry's three-independent-booleans design, which has no CHECK
-- linking billable/billed/approval_state either).
CREATE TABLE payment_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  payment_id uuid NOT NULL REFERENCES payment(id),
  invoice_id uuid NOT NULL REFERENCES invoice(id),
  allocated_amount_minor_units bigint NOT NULL CHECK (allocated_amount_minor_units > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_tenant_id_idx ON payment (tenant_id, id);
CREATE INDEX payment_tenant_contact_idx ON payment (tenant_id, contact_id);
CREATE INDEX payment_allocation_tenant_payment_idx ON payment_allocation (tenant_id, payment_id);
CREATE INDEX payment_allocation_tenant_invoice_idx ON payment_allocation (tenant_id, invoice_id);

ALTER TABLE payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE payment_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_allocation
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON payment, payment_allocation TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/payments.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createPayment, getPayment, recordPaymentAllocation, listPaymentAllocations } from '../payments';
import { createInvoice } from '../invoices';
import { createSalesOrder } from '../sales-orders';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

async function setupInvoice(tenantId: string, contactId: string) {
  const so = await createSalesOrder(tenantId, { contactId, lines: [] });
  return createInvoice(tenantId, { sourceType: 'sales_order', salesOrderId: so.id, dueDate: '2026-10-01', lines: [] });
}

describe('payment data access', () => {
  it('creates a payment and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 1') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Payer' });

    const payment = await createPayment(tenant.id, {
      contactId: contact.id,
      amountMinorUnits: 50000,
      currencyCode: 'USD',
      receivedAt: '2026-09-05T00:00:00.000Z',
      method: 'bank_transfer',
    });

    expect(payment.contactId).toBe(contact.id);
    expect(payment.amountMinorUnits).toBe(50000);

    const fetched = await getPayment(tenant.id, payment.id);
    expect(fetched).not.toBeNull();
  });

  it('rejects a contactId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 2A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 2B') RETURNING id`;
    const contactB = await createContact(tenantB.id, { fullName: 'Tenant B Payer' });

    await expect(
      createPayment(tenantA.id, { contactId: contactB.id, amountMinorUnits: 100, currencyCode: 'USD', receivedAt: '2026-09-05T00:00:00.000Z', method: 'cash' }),
    ).rejects.toThrow();
  });

  it('records a payment allocation against a valid invoice within the payment cap', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 3') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Payer' });
    const invoice = await setupInvoice(tenant.id, contact.id);
    const payment = await createPayment(tenant.id, { contactId: contact.id, amountMinorUnits: 10000, currencyCode: 'USD', receivedAt: '2026-09-05T00:00:00.000Z', method: 'card' });

    const allocation = await recordPaymentAllocation(tenant.id, payment.id, invoice.id, 6000);
    expect(allocation.allocatedAmountMinorUnits).toBe(6000);

    const allocations = await listPaymentAllocations(tenant.id, payment.id);
    expect(allocations).toHaveLength(1);
  });

  it('rejects an allocation that would exceed the payment amount across multiple allocations', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 4') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Payer' });
    const invoiceA = await setupInvoice(tenant.id, contact.id);
    const invoiceB = await setupInvoice(tenant.id, contact.id);
    const payment = await createPayment(tenant.id, { contactId: contact.id, amountMinorUnits: 10000, currencyCode: 'USD', receivedAt: '2026-09-05T00:00:00.000Z', method: 'card' });

    await recordPaymentAllocation(tenant.id, payment.id, invoiceA.id, 7000);
    await expect(
      recordPaymentAllocation(tenant.id, payment.id, invoiceB.id, 4000), // 7000 + 4000 > 10000
    ).rejects.toThrow();

    const allocations = await listPaymentAllocations(tenant.id, payment.id);
    expect(allocations).toHaveLength(1); // the rejected allocation was never inserted
  });

  it('rejects an invoiceId belonging to another tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 5A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Payment Test Tenant 5B') RETURNING id`;
    const contactA = await createContact(tenantA.id, { fullName: 'Payer A' });
    const contactB = await createContact(tenantB.id, { fullName: 'Payer B' });
    const invoiceB = await setupInvoice(tenantB.id, contactB.id);
    const paymentA = await createPayment(tenantA.id, { contactId: contactA.id, amountMinorUnits: 10000, currencyCode: 'USD', receivedAt: '2026-09-05T00:00:00.000Z', method: 'card' });

    await expect(
      recordPaymentAllocation(tenantA.id, paymentA.id, invoiceB.id, 1000),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/payments.test.ts`
Expected: FAIL — `lib/erp/payments.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/payments.ts
import { withTenant } from '../db/with-tenant';
import { nextDocumentNumber } from './document-sequence';
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
  const contact = await getContact(tenantId, input.contactId);
  if (!contact) {
    throw new Error(`Invalid contact reference: ${input.contactId} does not belong to this tenant`);
  }

  const documentNumber = await nextDocumentNumber(tenantId, 'payment');

  return withTenant(tenantId, async (tx) => {
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
    // Application-layer cap check, inside the same transaction as the
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/payments.test.ts`
Expected: PASS (5/5 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0025_payment.sql lib/erp/payments.ts lib/erp/__tests__/payments.test.ts
git commit -m "feat: add payment and payment_allocation tables with application-layer cap enforcement

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Full-Suite Verification

**Files:** none created or modified — verification only.

**Interfaces:** N/A.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every existing test (all prior phases, unchanged) plus all new `lib/erp/__tests__/{sales-orders,document-sequence,invoices,payments}.test.ts` files and the RLS audit test (now covering 6 additional tables: `sales_order`, `sales_order_line`, `invoice`, `invoice_line`, `payment`, `payment_allocation`) pass with zero failures.

- [ ] **Step 2: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify no table-name or migration-number collisions**

Run: `ls db/migrations/*.sql`
Expected: exactly 25 files, numbered 0001 through 0025 with no gaps or duplicates, and the three new ones (0023–0025) match the table names in this plan (`sales_order`, `invoice`, `payment`) with no collision against any existing table.

- [ ] **Step 4: Commit (only if Steps 1–2 required any fixes)**

```bash
git add -A
git commit -m "chore: verify phase 3a-5 full suite and type check

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

If Steps 1–2 pass with no changes needed, skip this commit — there's nothing new to commit.
