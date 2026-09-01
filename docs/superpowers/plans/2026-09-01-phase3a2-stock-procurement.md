# Phase 3A-2: Stock + Procurement Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the stock-movement ledger and purchase-order/receiving flow that gives the `basic_stock` goods-handling tier real inventory tracking, without ever storing a derived on-hand quantity.

**Architecture:** An append-only `stock_move` ledger (never a `quantity_on_hand` column) derives on-hand quantity at query time. `location` rows are just places stock can live — a single-location tenant has one row, a multi-location tenant has several; no schema difference between the two. `purchase_order`/`purchase_order_line` capture a commitment to a vendor; stock only increases when `receivePurchaseOrder` is called, which appends `stock_move` receipt rows and flips the PO's fulfillment `status` — kept deliberately separate from its `approval_state` column, since "was this approved" and "has this been received" are independent facts. Everything is schema + `lib/erp/` data layer only, no UI, matching Phase 3A-1's shape.

**Tech Stack:** Postgres (Neon) migrations, `postgres` npm package via `withTenant()`, Vitest (`backend` project) for tests.

**Spec:** `docs/superpowers/specs/2026-09-01-phase3-erp-design.md` (this plan implements the "Stock ledger", "Multi-location", and "Procurement" rows of §4's module table, and boundary calls #1 and #2 from §3 — no polymorphic order table, no derived values stored where an event belongs).

## Global Constraints

- Every new table MUST have both `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, plus a `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())` — checked automatically by the existing `db/migrations/__tests__/rls-policy-audit.test.ts` CI gate, zero code changes needed to cover new tables.
- All application-level DB access goes through `withTenant(tenantId, fn)` from `lib/db/with-tenant.ts` — never call `getSql()` directly.
- Mirror `lib/erp/vendors.ts` and `lib/erp/products.ts` exactly as the reference pattern: typed interfaces, a `rowToX(row: any): X` mapper, exported async functions that call `withTenant()`.
- Do not collide with existing table names: `tenant`, `app_user`, `contact`, `pipeline_stage`, `deal`, `tenant_erp_settings`, `vendor`, `product`, `document_sequence`.
- Next migration number is `0012` (existing: 0001–0011 in `db/migrations/`).
- `approval_state` (from `db/migrations/0007_approval_state.sql`, extended by `0011`) has exactly 5 values: `draft`, `pending_approval`, `approved`, `rejected`, `withdrawn` — reuse this type, never redefine it.
- `nextDocumentNumber(tenantId: string, documentType: string): Promise<number>` from `lib/erp/document-sequence.ts` is the sole way to generate a purchase order's document number — never a manually-incrementing field or a raw `COUNT(*) + 1` query.
- Money fields use the integer-minor-units + explicit-currency-code convention (`unit_price_minor_units bigint`, `currency_code text`), matching `product.price_minor_units`/`currency_code` and `deal.value_minor_units`/`currency_code`.
- TDD: write the failing test before the implementation in every task that has one.
- Test-isolation discipline: any test that queries shared state must scope by tenant/id explicitly — never rely on being "the only test" creating a given row.
- `npx tsc --noEmit` must stay clean after every task.
- `vitest.config.ts` already has `testTimeout: 20000` (added in 3A-1's final-review fix wave) — no config changes needed.
- Grant `SELECT, INSERT, UPDATE, DELETE` to `app_runtime` on every new table, matching the existing migrations' pattern exactly.

---

### Task 1: `location` Table and Data-Access Layer

**Files:**
- Create: `db/migrations/0012_location.sql`
- Create: `lib/erp/locations.ts`
- Test: `lib/erp/__tests__/locations.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`.
- Produces: `Location` interface (`id: string`, `tenantId: string`, `name: string`, `createdAt: Date`); `NewLocation` interface (`name: string`); `createLocation(tenantId: string, input: NewLocation): Promise<Location>`; `getLocation(tenantId: string, id: string): Promise<Location | null>`; `listLocations(tenantId: string): Promise<Location[]>`. Task 2 (`stock_move`) references `location.id` as a foreign key; Task 5 (`receivePurchaseOrder`) takes a `locationId` parameter that must be a real location for the tenant.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0012_location.sql
-- A place stock can live. Single-location tenants have exactly one row;
-- multi-location tenants have several — there is no separate schema for
-- "multi-location" (per design spec §4's module table), just more rows
-- in this same table. Stock quantity is always (product_id, location_id)
-- scoped, never global to a product — see stock_move in the next task.
CREATE TABLE location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX location_tenant_id_idx ON location (tenant_id, id);

ALTER TABLE location ENABLE ROW LEVEL SECURITY;
ALTER TABLE location FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON location
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON location TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/locations.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createLocation, getLocation, listLocations } from '../locations';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('location data access', () => {
  it('creates a location and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Location Test Tenant 1') RETURNING id`;

    const location = await createLocation(tenant.id, { name: 'Main Warehouse' });

    expect(location.name).toBe('Main Warehouse');

    const fetched = await getLocation(tenant.id, location.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Main Warehouse');
  });

  it('returns null from getLocation for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Location Test Tenant 2') RETURNING id`;
    const result = await getLocation(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('lists only locations belonging to the given tenant, supporting multiple locations per tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Location Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Location Test Tenant 3B') RETURNING id`;

    await createLocation(tenantA.id, { name: 'Warehouse North' });
    await createLocation(tenantA.id, { name: 'Warehouse South' });
    await createLocation(tenantB.id, { name: 'Other Tenant Warehouse' });

    const locationsA = await listLocations(tenantA.id);
    expect(locationsA.map((l) => l.name).sort()).toEqual(['Warehouse North', 'Warehouse South']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/locations.test.ts`
Expected: FAIL — `lib/erp/locations.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/locations.ts
import { withTenant } from '../db/with-tenant';

export interface Location {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
}

export interface NewLocation {
  name: string;
}

function rowToLocation(row: any): Location {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

export async function createLocation(tenantId: string, input: NewLocation): Promise<Location> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO location (tenant_id, name)
      VALUES (${tenantId}, ${input.name})
      RETURNING *
    `;
    return rowToLocation(row);
  });
}

export async function getLocation(tenantId: string, id: string): Promise<Location | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM location WHERE id = ${id}`;
    return rows.length > 0 ? rowToLocation(rows[0]) : null;
  });
}

export async function listLocations(tenantId: string): Promise<Location[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM location ORDER BY created_at ASC`;
    return rows.map(rowToLocation);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/locations.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0012_location.sql lib/erp/locations.ts lib/erp/__tests__/locations.test.ts
git commit -m "feat: add location table and data-access layer"
```

---

### Task 2: `stock_move` Table and Ledger Functions

**Files:**
- Create: `db/migrations/0013_stock_move.sql`
- Create: `lib/erp/stock.ts`
- Test: `lib/erp/__tests__/stock.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`; `Location` from `lib/erp/locations.ts` (not imported directly, but `location.id` values are used in tests).
- Produces: `MovementType` type (`'receipt' | 'shipment' | 'adjustment' | 'transfer'`); `StockMove` interface (`id: string`, `tenantId: string`, `productId: string`, `locationId: string | null`, `sourceLocationId: string | null`, `quantity: number`, `movementType: MovementType`, `reference: string | null`, `createdAt: Date`); `NewStockMove` interface (`productId: string`, `locationId?: string`, `sourceLocationId?: string`, `quantity: number`, `movementType: MovementType`, `reference?: string`); `recordStockMove(tenantId: string, input: NewStockMove): Promise<StockMove>`; `getStockOnHand(tenantId: string, productId: string, locationId?: string): Promise<number>`. Task 5 (`receivePurchaseOrder`) calls `recordStockMove` once per PO line with `movementType: 'receipt'`.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0013_stock_move.sql
CREATE TYPE stock_movement_type AS ENUM ('receipt', 'shipment', 'adjustment', 'transfer');

-- The append-only movement ledger. Per design spec §3's boundary call #2:
-- stock quantity is NEVER a stored column on product — always derived by
-- summing stock_move rows at query time (see getStockOnHand in
-- lib/erp/stock.ts). Every quantity change is a row here, never an
-- UPDATE to an existing balance.
--
-- location_id is the destination (where stock arrives) and is nullable
-- for movements that leave the tenant's stock entirely (a shipment/sale
-- has no destination location within this tenant). source_location_id
-- is nullable for movements with no internal origin (a receipt from a
-- vendor has no source_location_id — it enters stock from outside).
-- Both nullable, but a row should have at least one of the two set;
-- application code enforces this (recordStockMove), not a DB constraint,
-- since a CHECK constraint here would need to special-case 'adjustment'
-- movements which may legitimately set only one side depending on
-- direction (a positive adjustment sets location_id, a negative
-- adjustment sets source_location_id).
CREATE TABLE stock_move (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  product_id uuid NOT NULL REFERENCES product(id),
  location_id uuid REFERENCES location(id),
  source_location_id uuid REFERENCES location(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  movement_type stock_movement_type NOT NULL,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stock_move_tenant_product_location_idx ON stock_move (tenant_id, product_id, location_id);
CREATE INDEX stock_move_tenant_product_source_idx ON stock_move (tenant_id, product_id, source_location_id);

ALTER TABLE stock_move ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_move FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON stock_move
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_move TO app_runtime;
```

Note: `quantity numeric NOT NULL CHECK (quantity > 0)` — quantity is always positive; direction is encoded by which of `location_id`/`source_location_id` is set, not by a signed number. This keeps `getStockOnHand`'s SUM logic simple (inbound rows add, outbound rows subtract) without depending on the application never inserting a negative-quantity row by mistake.

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/stock.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { recordStockMove, getStockOnHand } from '../stock';
import { createLocation } from '../locations';
import { createProduct } from '../products';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('stock ledger', () => {
  it('returns 0 on-hand for a product with no movements', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Stock Test Tenant 1') RETURNING id`;
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });

    const onHand = await getStockOnHand(tenant.id, product.id);
    expect(onHand).toBe(0);
  });

  it('increases on-hand after a receipt and decreases after a shipment, at a specific location', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Stock Test Tenant 2') RETURNING id`;
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const location = await createLocation(tenant.id, { name: 'Main Warehouse' });

    await recordStockMove(tenant.id, {
      productId: product.id,
      locationId: location.id,
      quantity: 100,
      movementType: 'receipt',
      reference: 'Initial stock',
    });

    let onHand = await getStockOnHand(tenant.id, product.id, location.id);
    expect(onHand).toBe(100);

    await recordStockMove(tenant.id, {
      productId: product.id,
      sourceLocationId: location.id,
      quantity: 30,
      movementType: 'shipment',
      reference: 'Order #1',
    });

    onHand = await getStockOnHand(tenant.id, product.id, location.id);
    expect(onHand).toBe(70);
  });

  it('tracks on-hand independently per location, and sums across locations when no locationId is given', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Stock Test Tenant 3') RETURNING id`;
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const locationA = await createLocation(tenant.id, { name: 'Warehouse A' });
    const locationB = await createLocation(tenant.id, { name: 'Warehouse B' });

    await recordStockMove(tenant.id, {
      productId: product.id,
      locationId: locationA.id,
      quantity: 50,
      movementType: 'receipt',
    });
    await recordStockMove(tenant.id, {
      productId: product.id,
      locationId: locationB.id,
      quantity: 20,
      movementType: 'receipt',
    });

    expect(await getStockOnHand(tenant.id, product.id, locationA.id)).toBe(50);
    expect(await getStockOnHand(tenant.id, product.id, locationB.id)).toBe(20);
    expect(await getStockOnHand(tenant.id, product.id)).toBe(70);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/stock.test.ts`
Expected: FAIL — `lib/erp/stock.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/stock.ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/stock.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0013_stock_move.sql lib/erp/stock.ts lib/erp/__tests__/stock.test.ts
git commit -m "feat: add stock_move ledger and derived on-hand quantity"
```

---

### Task 3: `purchase_order` and `purchase_order_line` Tables

**Files:**
- Create: `db/migrations/0014_purchase_order.sql`
- Create: `lib/erp/purchase-orders.ts`
- Test: `lib/erp/__tests__/purchase-orders.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`; `nextDocumentNumber(tenantId: string, documentType: string): Promise<number>` from `lib/erp/document-sequence.ts`, called with `documentType: 'purchase_order'`.
- Produces: `PurchaseOrderStatus` type (`'draft' | 'submitted' | 'received' | 'cancelled'`); `PurchaseOrder` interface (`id: string`, `tenantId: string`, `vendorId: string`, `documentNumber: number`, `approvalState: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn'`, `status: PurchaseOrderStatus`, `createdAt: Date`, `updatedAt: Date`); `PurchaseOrderLine` interface (`id: string`, `purchaseOrderId: string`, `productId: string`, `quantity: number`, `unitPriceMinorUnits: number`, `currencyCode: string`); `NewPurchaseOrder` interface (`vendorId: string`, `lines: Array<{ productId: string; quantity: number; unitPriceMinorUnits: number; currencyCode: string }>`); `createPurchaseOrder(tenantId: string, input: NewPurchaseOrder): Promise<PurchaseOrder>` (creates the PO in `status: 'draft'`, `approvalState: 'draft'`, allocates a `documentNumber` via `nextDocumentNumber`, and inserts all lines); `getPurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrder | null>`; `listPurchaseOrderLines(tenantId: string, purchaseOrderId: string): Promise<PurchaseOrderLine[]>`; `submitPurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrder | null>` (moves `status` from `'draft'` to `'submitted'`; returns `null` if the PO doesn't exist for this tenant or isn't currently `'draft'`). Task 5 (`receivePurchaseOrder`) reads a PO's `status` (must be `'submitted'`) and lines, then updates `status` to `'received'`.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0014_purchase_order.sql
CREATE TYPE purchase_order_status AS ENUM ('draft', 'submitted', 'received', 'cancelled');

-- Deliberately two separate state columns, per design spec §3's boundary
-- call #3 ("split states that look like one boolean but aren't"):
--   - approval_state (shared enum from 0007/0011): was this PO approved
--     by a human/policy? Defaults to 'draft' so a future Phase 5 agent
--     action never auto-approves itself.
--   - status: has this PO actually been fulfilled? Independent axis —
--     an approved PO can still be unsubmitted, and (in principle) a
--     submitted PO's approval could still be pending in a stricter
--     workflow. Collapsing these into one field would make "approved
--     but not yet received" and "received without ever being approved"
--     indistinguishable from their opposites.
CREATE TABLE purchase_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  vendor_id uuid NOT NULL REFERENCES vendor(id),
  document_number bigint NOT NULL,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  status purchase_order_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_number)
);

CREATE TABLE purchase_order_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  purchase_order_id uuid NOT NULL REFERENCES purchase_order(id),
  product_id uuid NOT NULL REFERENCES product(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price_minor_units bigint NOT NULL,
  currency_code text NOT NULL
);

CREATE INDEX purchase_order_tenant_id_idx ON purchase_order (tenant_id, id);
CREATE INDEX purchase_order_tenant_vendor_idx ON purchase_order (tenant_id, vendor_id);
CREATE INDEX purchase_order_line_tenant_po_idx ON purchase_order_line (tenant_id, purchase_order_id);

ALTER TABLE purchase_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE purchase_order_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_line
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_order, purchase_order_line TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/purchase-orders.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createPurchaseOrder, getPurchaseOrder, listPurchaseOrderLines, submitPurchaseOrder } from '../purchase-orders';
import { createVendor } from '../vendors';
import { createProduct } from '../products';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('purchase order data access', () => {
  it('creates a purchase order with lines, in draft status with a sequential document number', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 1') RETURNING id`;
    const vendor = await createVendor(tenant.id, { name: 'Acme Supplies' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });

    const po = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 10, unitPriceMinorUnits: 500, currencyCode: 'USD' }],
    });

    expect(po.status).toBe('draft');
    expect(po.approvalState).toBe('draft');
    expect(po.documentNumber).toBe(1);

    const lines = await listPurchaseOrderLines(tenant.id, po.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(10);
    expect(lines[0].unitPriceMinorUnits).toBe(500);
  });

  it('allocates sequential document numbers per tenant', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 2') RETURNING id`;
    const vendor = await createVendor(tenant.id, { name: 'Acme Supplies' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });

    const po1 = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 1, unitPriceMinorUnits: 100, currencyCode: 'USD' }],
    });
    const po2 = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 1, unitPriceMinorUnits: 100, currencyCode: 'USD' }],
    });

    expect(po1.documentNumber).toBe(1);
    expect(po2.documentNumber).toBe(2);
  });

  it('submitPurchaseOrder moves status from draft to submitted, and returns null for a PO not in draft', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 3') RETURNING id`;
    const vendor = await createVendor(tenant.id, { name: 'Acme Supplies' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });

    const po = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 1, unitPriceMinorUnits: 100, currencyCode: 'USD' }],
    });

    const submitted = await submitPurchaseOrder(tenant.id, po.id);
    expect(submitted).not.toBeNull();
    expect(submitted!.status).toBe('submitted');

    const secondAttempt = await submitPurchaseOrder(tenant.id, po.id);
    expect(secondAttempt).toBeNull();
  });

  it('getPurchaseOrder returns null for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 4') RETURNING id`;
    const result = await getPurchaseOrder(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/purchase-orders.test.ts`
Expected: FAIL — `lib/erp/purchase-orders.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/purchase-orders.ts
import { withTenant } from '../db/with-tenant';
import { nextDocumentNumber } from './document-sequence';

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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/purchase-orders.test.ts`
Expected: PASS (4/4 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0014_purchase_order.sql lib/erp/purchase-orders.ts lib/erp/__tests__/purchase-orders.test.ts
git commit -m "feat: add purchase order and line tables with sequential numbering"
```

---

### Task 4: `receivePurchaseOrder` — Stock Increases on Receipt

**Files:**
- Modify: `lib/erp/purchase-orders.ts`
- Modify: `lib/erp/__tests__/purchase-orders.test.ts`

**Interfaces:**
- Consumes: `recordStockMove(tenantId: string, input: NewStockMove): Promise<StockMove>` from `lib/erp/stock.ts`; `getStockOnHand` from `lib/erp/stock.ts` (used in the test, not the implementation); `listPurchaseOrderLines` and `getPurchaseOrder` (both defined in Task 3, same file).
- Produces: `receivePurchaseOrder(tenantId: string, purchaseOrderId: string, locationId: string): Promise<PurchaseOrder | null>` — returns `null` if the PO doesn't exist for this tenant or isn't currently `'submitted'` (matching `submitPurchaseOrder`'s established null-on-invalid-state convention); on success, creates one `stock_move` receipt row per PO line and updates the PO's `status` to `'received'`.

- [ ] **Step 1: Write the failing test**

Add to `lib/erp/__tests__/purchase-orders.test.ts`:

```typescript
  it('receivePurchaseOrder creates stock moves for each line and increases on-hand quantity', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 5') RETURNING id`;
    const vendor = await createVendor(tenant.id, { name: 'Acme Supplies' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const location = await createLocation(tenant.id, { name: 'Main Warehouse' });

    const po = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 25, unitPriceMinorUnits: 500, currencyCode: 'USD' }],
    });
    await submitPurchaseOrder(tenant.id, po.id);

    const received = await receivePurchaseOrder(tenant.id, po.id, location.id);
    expect(received).not.toBeNull();
    expect(received!.status).toBe('received');

    const onHand = await getStockOnHand(tenant.id, product.id, location.id);
    expect(onHand).toBe(25);
  });

  it('receivePurchaseOrder returns null for a PO that is still in draft (never submitted)', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('PO Test Tenant 6') RETURNING id`;
    const vendor = await createVendor(tenant.id, { name: 'Acme Supplies' });
    const product = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const location = await createLocation(tenant.id, { name: 'Main Warehouse' });

    const po = await createPurchaseOrder(tenant.id, {
      vendorId: vendor.id,
      lines: [{ productId: product.id, quantity: 5, unitPriceMinorUnits: 100, currencyCode: 'USD' }],
    });

    const result = await receivePurchaseOrder(tenant.id, po.id, location.id);
    expect(result).toBeNull();
  });
```

Add the two new imports this test needs to the top of the file:

```typescript
import { receivePurchaseOrder } from '../purchase-orders';
import { createLocation } from '../locations';
import { getStockOnHand } from '../stock';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/purchase-orders.test.ts`
Expected: FAIL — `receivePurchaseOrder` is not exported from `lib/erp/purchase-orders.ts` yet.

- [ ] **Step 3: Write the implementation**

Add to `lib/erp/purchase-orders.ts` (add the import at the top, function at the bottom):

```typescript
import { recordStockMove } from './stock';
```

```typescript
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
```

Note: the initial `getPurchaseOrder`/status check and the final `UPDATE ... WHERE status = 'submitted'` both check the same condition. This is deliberate, not redundant: the first check is a fast-fail before doing any stock-move work; the final `WHERE status = 'submitted'` in the UPDATE is what actually prevents a race between two concurrent `receivePurchaseOrder` calls for the same PO from both succeeding and double-recording stock — only one UPDATE can match `status = 'submitted'` before the first one flips it to `'received'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/purchase-orders.test.ts`
Expected: PASS (6/6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/erp/purchase-orders.ts lib/erp/__tests__/purchase-orders.test.ts
git commit -m "feat: add receivePurchaseOrder to increase stock on receipt"
```

---

### Task 5: Full-Suite Verification

**Files:** none created or modified — verification only.

**Interfaces:** N/A.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every existing test (Phases 1A/2A/2B/3A-1, unchanged) plus all new `lib/erp/__tests__/locations.test.ts`, `lib/erp/__tests__/stock.test.ts`, `lib/erp/__tests__/purchase-orders.test.ts`, and the RLS audit test (now covering 4 additional tables: `location`, `stock_move`, `purchase_order`, `purchase_order_line`) pass with zero failures.

- [ ] **Step 2: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify no table-name or migration-number collisions**

Run: `ls db/migrations/*.sql`
Expected: exactly 14 files, numbered 0001 through 0014 with no gaps or duplicates, and the three new ones (0012–0014) match the table names in this plan (`location`, `stock_move`, `purchase_order`/`purchase_order_line`) with no collision against any existing table.

- [ ] **Step 4: Commit (only if Steps 1–2 required any fixes)**

```bash
git add -A
git commit -m "chore: verify phase 3a-2 full suite and type check"
```

If Steps 1–2 pass with no changes needed, skip this commit — there's nothing new to commit.
