# Phase 3A-1: ERP Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational schema and data-access layer that every later ERP module (stock/procurement, production, projects/time, subscriptions) depends on: per-tenant feature toggles, vendors, products, document numbering, and a shared approval-state type.

**Architecture:** Five new Postgres tables (`tenant_erp_settings`, `vendor`, `product`, `document_sequence`) plus one enum type (`approval_state`), each following the exact FORCE-RLS + `tenant_isolation` policy pattern established in Phase 1A/2A, migrated via sequential numbered SQL files. A `lib/erp/` data-access layer mirrors `lib/crm/contacts.ts` and `lib/crm/deals.ts` exactly: typed interfaces, `rowToX` mappers, functions that go through `withTenant()`. No UI — this is schema + data layer only, matching Phase 2A's shape.

**Tech Stack:** Postgres (Neon) migrations, `postgres` npm package via `withTenant()`, Vitest (`backend` project, node environment) for tests.

**Spec:** `docs/superpowers/specs/2026-09-01-phase3-erp-design.md` (this plan implements §1, §2, and part of §4 — the toggle table and the two axis-independent core entities `vendor`/`product`; module tables like stock ledger, production, projects, and subscriptions are later sub-plans, not this one).

## Global Constraints

- Every new table MUST have both `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, plus a `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())` — this is checked automatically by the existing `db/migrations/__tests__/rls-policy-audit.test.ts` CI gate, which requires zero code changes to cover new tables (already generic over `pg_class`/`pg_policies`).
- All application-level DB access goes through `withTenant(tenantId, fn)` from `lib/db/with-tenant.ts` — never call `getSql()` directly for tenant-scoped data.
- Do not collide with existing table names: `tenant`, `app_user`, `contact`, `pipeline_stage`, `deal`.
- Next migration number is `0006` (existing: 0001–0005 in `db/migrations/`).
- TDD: write the failing test before the implementation in every task that has one.
- Test-isolation discipline: any test that queries shared state must scope by tenant/id explicitly — never rely on being "the only test" creating a given row (this bit the project once already in Phase 2A's `pipeline_stage` test).
- `npx tsc --noEmit` must stay clean after every task.
- Grant `SELECT, INSERT, UPDATE, DELETE` to `app_runtime` on every new table, matching the existing migrations' pattern exactly.

## Carried-forward deferral (from Phase 2A)

`db/migrations/0005_deal.sql` has a top-of-file comment recording that `deal`, `order`, and `invoice` need append-only history/versioning per design spec §8, deferred to "Phase 3 ERP or a dedicated hardening pass." This sub-plan (3A-1) does not create `order` or `invoice` — those land in a later Phase 3A sub-plan once the stock/procurement module is designed. **The deferral is not resolved here; it is carried forward again**, and the sub-plan that creates `order`/`invoice` must either implement append-only history or explicitly re-defer with a reason, not silently drop it a second time. Noting this now so it isn't lost between sub-plans.

---

### Task 1: `tenant_erp_settings` Table and Data-Access Layer

**Files:**
- Create: `db/migrations/0006_tenant_erp_settings.sql`
- Create: `lib/erp/settings.ts`
- Test: `lib/erp/__tests__/settings.test.ts`

**Interfaces:**
- Consumes: `withTenant<T>(tenantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>` from `lib/db/with-tenant.ts`.
- Produces: `ErpSettings` interface (`tenantId: string`, `goodsHandling: 'off' | 'basic_stock' | 'production'`, `billingModes: Array<'transactional' | 'effort_based' | 'recurring'>`, `updatedAt: Date`); `getErpSettings(tenantId: string): Promise<ErpSettings>` (creates a default row on first read if none exists — default `goodsHandling: 'off'`, `billingModes: []` — since every tenant needs a row to exist for later modules' gating queries to work, but a brand-new tenant hasn't configured anything yet); `updateErpSettings(tenantId: string, input: { goodsHandling?: 'off' | 'basic_stock' | 'production'; billingModes?: Array<'transactional' | 'effort_based' | 'recurring'> }): Promise<ErpSettings>`. Later tasks in this plan (and later sub-plans) call `getErpSettings` to decide gating; no other task in this plan modifies this file.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0006_tenant_erp_settings.sql
CREATE TYPE goods_handling_mode AS ENUM ('off', 'basic_stock', 'production');
CREATE TYPE billing_mode AS ENUM ('transactional', 'effort_based', 'recurring');

-- Per design spec (docs/superpowers/specs/2026-09-01-phase3-erp-design.md
-- §1): one row per tenant holds the two independently-toggleable axes.
-- goods_handling is a single value (a tenant is at one point on the
-- off -> basic_stock -> production spectrum at a time); billing_modes is
-- an array because a tenant can combine billing modes (e.g. a retailer
-- selling both one-off orders and subscriptions).
CREATE TABLE tenant_erp_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenant(id),
  goods_handling goods_handling_mode NOT NULL DEFAULT 'off',
  billing_modes billing_mode[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_erp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_erp_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_erp_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_erp_settings TO app_runtime;
```

- [ ] **Step 2: Apply the migration and verify RLS via the existing audit test**

Run: `npx vitest run db/migrations/__tests__/rls-policy-audit.test.ts`
Expected: all 4 tests pass, with `tenant_erp_settings` now included in the generic checks (no code change to that test file needed — confirm this is true by re-reading it if in doubt, do not add `tenant_erp_settings` to `EXEMPT_TABLES`).

- [ ] **Step 3: Write the failing test**

```typescript
// lib/erp/__tests__/settings.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { getErpSettings, updateErpSettings } from '../settings';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('tenant_erp_settings data access', () => {
  it('creates and returns default settings on first read for a new tenant', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('ERP Settings Test Tenant 1') RETURNING id`;
    const settings = await getErpSettings(tenant.id);

    expect(settings.tenantId).toBe(tenant.id);
    expect(settings.goodsHandling).toBe('off');
    expect(settings.billingModes).toEqual([]);
  });

  it('returns the same settings on a second read rather than creating a duplicate row', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('ERP Settings Test Tenant 2') RETURNING id`;
    await getErpSettings(tenant.id);
    await getErpSettings(tenant.id);

    const rows = await ownerSql`SELECT * FROM tenant_erp_settings WHERE tenant_id = ${tenant.id}`;
    expect(rows).toHaveLength(1);
  });

  it('updates goodsHandling and billingModes independently', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('ERP Settings Test Tenant 3') RETURNING id`;
    await getErpSettings(tenant.id);

    const updated = await updateErpSettings(tenant.id, {
      goodsHandling: 'basic_stock',
      billingModes: ['transactional', 'recurring'],
    });

    expect(updated.goodsHandling).toBe('basic_stock');
    expect(updated.billingModes).toEqual(['transactional', 'recurring']);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/settings.test.ts`
Expected: FAIL — `lib/erp/settings.ts` does not exist yet (module not found).

- [ ] **Step 5: Write the implementation**

```typescript
// lib/erp/settings.ts
import { withTenant } from '../db/with-tenant';

export type GoodsHandlingMode = 'off' | 'basic_stock' | 'production';
export type BillingMode = 'transactional' | 'effort_based' | 'recurring';

export interface ErpSettings {
  tenantId: string;
  goodsHandling: GoodsHandlingMode;
  billingModes: BillingMode[];
  updatedAt: Date;
}

function rowToErpSettings(row: any): ErpSettings {
  return {
    tenantId: row.tenant_id,
    goodsHandling: row.goods_handling,
    billingModes: row.billing_modes ?? [],
    updatedAt: row.updated_at,
  };
}

export async function getErpSettings(tenantId: string): Promise<ErpSettings> {
  return withTenant(tenantId, async (tx) => {
    const existing = await tx`SELECT * FROM tenant_erp_settings WHERE tenant_id = ${tenantId}`;
    if (existing.length > 0) {
      return rowToErpSettings(existing[0]);
    }
    const [created] = await tx`
      INSERT INTO tenant_erp_settings (tenant_id)
      VALUES (${tenantId})
      ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
      RETURNING *
    `;
    return rowToErpSettings(created);
  });
}

export async function updateErpSettings(
  tenantId: string,
  input: { goodsHandling?: GoodsHandlingMode; billingModes?: BillingMode[] },
): Promise<ErpSettings> {
  return withTenant(tenantId, async (tx) => {
    await tx`SELECT 1 FROM tenant_erp_settings WHERE tenant_id = ${tenantId}`;
    const [row] = await tx`
      UPDATE tenant_erp_settings
      SET
        goods_handling = COALESCE(${input.goodsHandling ?? null}, goods_handling),
        billing_modes = COALESCE(${input.billingModes ?? null}, billing_modes),
        updated_at = now()
      WHERE tenant_id = ${tenantId}
      RETURNING *
    `;
    return rowToErpSettings(row);
  });
}
```

Note the `ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id` in `getErpSettings`: this makes the create-on-first-read idempotent under concurrent calls (two simultaneous first reads for the same tenant would otherwise race on the `INSERT`, and the second would violate the primary key). `DO UPDATE SET tenant_id = EXCLUDED.tenant_id` is a no-op update (always the same value) used only to make `RETURNING *` return the existing row instead of erroring — this is the standard Postgres upsert-and-return pattern.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/settings.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 7: Commit**

```bash
git add db/migrations/0006_tenant_erp_settings.sql lib/erp/settings.ts lib/erp/__tests__/settings.test.ts
git commit -m "feat: add tenant_erp_settings table and data-access layer"
```

---

### Task 2: Shared `approval_state` Enum Type

**Files:**
- Create: `db/migrations/0007_approval_state.sql`

**Interfaces:**
- Consumes: nothing (standalone type definition).
- Produces: a Postgres enum type `approval_state` with values `'draft' | 'pending_approval' | 'approved' | 'rejected'`, usable as a column type by any future migration in later sub-plans (purchase orders, manufacturing orders, etc.) via `approval_state NOT NULL DEFAULT 'draft'`. No table in this plan uses it yet — `vendor` and `product` (Tasks 3–4) do not need an approval workflow themselves; this task exists purely to define the shared type now so later sub-plans reference one type instead of each redefining it (per design spec §2's approval_state requirement).

This task has no application code and no test file — it is a pure schema addition of a type with no rows to query yet. Verification is the migration applying cleanly and the type being queryable, not a `lib/erp/` function.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0007_approval_state.sql
-- Shared enum for any document type with an external side effect,
-- per design spec §2. Every future AI-creatable record (purchase
-- orders, manufacturing orders, etc.) gets an `approval_state
-- NOT NULL DEFAULT 'draft'` column using this type, so a Phase 5 agent
-- action always defaults to the least-privileged state per
-- .claude/rules/ai-systems.md's approval-gate requirement. No table
-- in Phase 3A-1 uses this column yet — it is defined here so later
-- sub-plans (procurement, production) reference one shared type
-- instead of each redefining it.
CREATE TYPE approval_state AS ENUM ('draft', 'pending_approval', 'approved', 'rejected');
```

- [ ] **Step 2: Verify the type exists and has the expected values**

Run this ad-hoc query against the dev database (using the same `postgres(process.env.DATABASE_URL!)` owner-connection pattern already used in `lib/erp/__tests__/settings.test.ts`) — either as a one-off `node -e` script or inline in a scratch test file you delete afterward, your choice:

```typescript
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!);
const rows = await sql`
  SELECT enumlabel FROM pg_enum
  JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
  WHERE pg_type.typname = 'approval_state'
  ORDER BY enumsortorder
`;
console.log(rows.map((r) => r.enumlabel));
// Expected: [ 'draft', 'pending_approval', 'approved', 'rejected' ]
await sql.end();
```

Expected: the four values print in the order listed above.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0007_approval_state.sql
git commit -m "feat: add shared approval_state enum type for future AI-actionable documents"
```

---

### Task 3: `vendor` Table and Data-Access Layer

**Files:**
- Create: `db/migrations/0008_vendor.sql`
- Create: `lib/erp/vendors.ts`
- Test: `lib/erp/__tests__/vendors.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`.
- Produces: `Vendor` interface (`id: string`, `tenantId: string`, `name: string`, `email: string | null`, `phone: string | null`, `paymentTermsDays: number | null`, `taxId: string | null`, `createdAt: Date`, `updatedAt: Date`); `NewVendor` interface (`name: string`, `email?: string`, `phone?: string`, `paymentTermsDays?: number`, `taxId?: string`); `createVendor(tenantId: string, input: NewVendor): Promise<Vendor>`; `getVendor(tenantId: string, id: string): Promise<Vendor | null>` (returns `null` on missing, matching `getContact`'s convention — never throws); `listVendors(tenantId: string): Promise<Vendor[]>`. This is a standalone table this sub-plan — no other task in this plan references `vendor` (procurement, which links `purchase_order` to `vendor`, is a later sub-plan).

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0008_vendor.sql
-- Separate from `contact` (Phase 2A) per explicit design decision in
-- docs/superpowers/specs/2026-09-01-phase3-erp-design.md §2: a vendor is
-- not a contact with a role flag, since vendor-specific fields
-- (payment terms, tax id) don't belong on the shared CRM contact.
CREATE TABLE vendor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  email text,
  phone text,
  payment_terms_days integer,
  tax_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_tenant_id_idx ON vendor (tenant_id, id);

ALTER TABLE vendor ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON vendor
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/vendors.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createVendor, getVendor, listVendors } from '../vendors';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('vendor data access', () => {
  it('creates a vendor with all fields and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Vendor Test Tenant 1') RETURNING id`;

    const vendor = await createVendor(tenant.id, {
      name: 'Acme Supplies',
      email: 'orders@acmesupplies.example',
      phone: '555-0100',
      paymentTermsDays: 30,
      taxId: 'TAX-12345',
    });

    expect(vendor.name).toBe('Acme Supplies');
    expect(vendor.paymentTermsDays).toBe(30);

    const fetched = await getVendor(tenant.id, vendor.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.taxId).toBe('TAX-12345');
  });

  it('returns null from getVendor for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Vendor Test Tenant 2') RETURNING id`;
    const result = await getVendor(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('lists only vendors belonging to the given tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Vendor Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Vendor Test Tenant 3B') RETURNING id`;

    await createVendor(tenantA.id, { name: 'Tenant A Vendor' });
    await createVendor(tenantB.id, { name: 'Tenant B Vendor' });

    const vendorsA = await listVendors(tenantA.id);
    expect(vendorsA.map((v) => v.name)).toEqual(['Tenant A Vendor']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/vendors.test.ts`
Expected: FAIL — `lib/erp/vendors.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/vendors.ts
import { withTenant } from '../db/with-tenant';

export interface Vendor {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  phone: string | null;
  paymentTermsDays: number | null;
  taxId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewVendor {
  name: string;
  email?: string;
  phone?: string;
  paymentTermsDays?: number;
  taxId?: string;
}

function rowToVendor(row: any): Vendor {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    paymentTermsDays: row.payment_terms_days,
    taxId: row.tax_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createVendor(tenantId: string, input: NewVendor): Promise<Vendor> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO vendor (tenant_id, name, email, phone, payment_terms_days, tax_id)
      VALUES (${tenantId}, ${input.name}, ${input.email ?? null}, ${input.phone ?? null}, ${input.paymentTermsDays ?? null}, ${input.taxId ?? null})
      RETURNING *
    `;
    return rowToVendor(row);
  });
}

export async function getVendor(tenantId: string, id: string): Promise<Vendor | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM vendor WHERE id = ${id}`;
    return rows.length > 0 ? rowToVendor(rows[0]) : null;
  });
}

export async function listVendors(tenantId: string): Promise<Vendor[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM vendor ORDER BY created_at DESC`;
    return rows.map(rowToVendor);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/vendors.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0008_vendor.sql lib/erp/vendors.ts lib/erp/__tests__/vendors.test.ts
git commit -m "feat: add vendor table and data-access layer"
```

---

### Task 4: `product` Table and Data-Access Layer

**Files:**
- Create: `db/migrations/0009_product.sql`
- Create: `lib/erp/products.ts`
- Test: `lib/erp/__tests__/products.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`.
- Produces: `ProductType` type (`'goods' | 'service' | 'non_inventoried'`); `Product` interface (`id: string`, `tenantId: string`, `name: string`, `productType: ProductType`, `sku: string | null`, `priceMinorUnits: number | null`, `currencyCode: string | null`, `createdAt: Date`, `updatedAt: Date`); `NewProduct` interface (`name: string`, `productType: ProductType`, `sku?: string`, `priceMinorUnits?: number`, `currencyCode?: string`); `createProduct(tenantId: string, input: NewProduct): Promise<Product>`; `getProduct(tenantId: string, id: string): Promise<Product | null>`; `listProducts(tenantId: string, filter?: { productType?: ProductType }): Promise<Product[]>`. Later sub-plans (stock ledger, procurement, production) reference `product.id` as a foreign key and read `productType` to decide whether a product participates in the stock ledger at all (per design spec §2: `product_type = 'service'` never touches stock) — but no later task in *this* plan depends on this file.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0009_product.sql
CREATE TYPE product_type AS ENUM ('goods', 'service', 'non_inventoried');

-- The type discriminator is the gate described in design spec §2: a
-- 'service' product never touches the stock ledger (a later sub-plan).
-- 'non_inventoried' covers goods sold without stock tracking (e.g. a
-- dropship/made-to-order item) — distinct from 'service' because it is
-- still a physical good, just not one this tenant stocks.
--
-- Price fields follow the integer-minor-units + explicit-currency-code
-- convention established in db/migrations/0005_deal.sql (design spec
-- §8's round-4 currency-handling fix). Both nullable: a product's price
-- may be set per-order-line instead of catalog-fixed, matching how
-- Phase 2A's deal.value_minor_units is nullable for the same reason.
CREATE TABLE product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  product_type product_type NOT NULL,
  sku text,
  price_minor_units bigint,
  currency_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

CREATE INDEX product_tenant_id_idx ON product (tenant_id, id);
CREATE INDEX product_tenant_type_idx ON product (tenant_id, product_type);

ALTER TABLE product ENABLE ROW LEVEL SECURITY;
ALTER TABLE product FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON product
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON product TO app_runtime;
```

Note: `UNIQUE (tenant_id, sku)` allows multiple `NULL` skus per tenant (Postgres treats `NULL` as distinct from any other `NULL` in a unique constraint), so products without a SKU don't collide with each other.

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/products.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createProduct, getProduct, listProducts } from '../products';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('product data access', () => {
  it('creates a goods product with SKU and price, reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Product Test Tenant 1') RETURNING id`;

    const product = await createProduct(tenant.id, {
      name: 'Widget',
      productType: 'goods',
      sku: 'WID-001',
      priceMinorUnits: 1999,
      currencyCode: 'USD',
    });

    expect(product.productType).toBe('goods');
    expect(product.sku).toBe('WID-001');

    const fetched = await getProduct(tenant.id, product.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.priceMinorUnits).toBe(1999);
  });

  it('creates a service product with no SKU or price', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Product Test Tenant 2') RETURNING id`;

    const product = await createProduct(tenant.id, {
      name: 'Consulting Hour',
      productType: 'service',
    });

    expect(product.productType).toBe('service');
    expect(product.sku).toBeNull();
    expect(product.priceMinorUnits).toBeNull();
  });

  it('returns null from getProduct for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Product Test Tenant 3') RETURNING id`;
    const result = await getProduct(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('listProducts filters by productType within the given tenant only', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Product Test Tenant 4') RETURNING id`;

    await createProduct(tenant.id, { name: 'Goods A', productType: 'goods' });
    await createProduct(tenant.id, { name: 'Service A', productType: 'service' });

    const goodsOnly = await listProducts(tenant.id, { productType: 'goods' });
    expect(goodsOnly.map((p) => p.name)).toEqual(['Goods A']);

    const all = await listProducts(tenant.id);
    expect(all).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/products.test.ts`
Expected: FAIL — `lib/erp/products.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/products.ts
import { withTenant } from '../db/with-tenant';

export type ProductType = 'goods' | 'service' | 'non_inventoried';

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  productType: ProductType;
  sku: string | null;
  priceMinorUnits: number | null;
  currencyCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProduct {
  name: string;
  productType: ProductType;
  sku?: string;
  priceMinorUnits?: number;
  currencyCode?: string;
}

function rowToProduct(row: any): Product {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    productType: row.product_type,
    sku: row.sku,
    priceMinorUnits: row.price_minor_units !== null ? Number(row.price_minor_units) : null,
    currencyCode: row.currency_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createProduct(tenantId: string, input: NewProduct): Promise<Product> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO product (tenant_id, name, product_type, sku, price_minor_units, currency_code)
      VALUES (${tenantId}, ${input.name}, ${input.productType}, ${input.sku ?? null}, ${input.priceMinorUnits ?? null}, ${input.currencyCode ?? null})
      RETURNING *
    `;
    return rowToProduct(row);
  });
}

export async function getProduct(tenantId: string, id: string): Promise<Product | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM product WHERE id = ${id}`;
    return rows.length > 0 ? rowToProduct(rows[0]) : null;
  });
}

export async function listProducts(
  tenantId: string,
  filter?: { productType?: ProductType },
): Promise<Product[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = filter?.productType
      ? await tx`SELECT * FROM product WHERE product_type = ${filter.productType} ORDER BY created_at DESC`
      : await tx`SELECT * FROM product ORDER BY created_at DESC`;
    return rows.map(rowToProduct);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/products.test.ts`
Expected: PASS (4/4 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0009_product.sql lib/erp/products.ts lib/erp/__tests__/products.test.ts
git commit -m "feat: add product table with type discriminator and data-access layer"
```

---

### Task 5: `document_sequence` Table and Atomic Increment Function

**Files:**
- Create: `db/migrations/0010_document_sequence.sql`
- Create: `lib/erp/document-sequence.ts`
- Test: `lib/erp/__tests__/document-sequence.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`.
- Produces: `nextDocumentNumber(tenantId: string, documentType: string): Promise<number>` — atomically allocates and returns the next sequence number for a given tenant + document type (e.g. `nextDocumentNumber(tenantId, 'invoice')` returns `1`, then `2`, then `3`, ...). Later sub-plans that create `invoice`, `purchase_order`, etc. call this to assign a human-readable sequential number at creation time. No other task in this plan depends on this file.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0010_document_sequence.sql
-- Per design spec §2: sequential numbering must be atomic and decided
-- now, since retrofitting gapless/sequential numbering after real
-- documents exist is not safely possible (many jurisdictions require
-- invoice numbers with no gaps). One row per (tenant, document_type)
-- pair holds the next number to hand out.
CREATE TABLE document_sequence (
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  document_type text NOT NULL,
  next_number bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, document_type)
);

ALTER TABLE document_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_sequence FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON document_sequence
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON document_sequence TO app_runtime;

-- Atomically allocates and returns the next number for (tenant,
-- document_type), creating the row on first use. SECURITY INVOKER
-- (the default) means this function runs as whichever role calls it —
-- app_runtime, subject to the same RLS policy above — never bypassing
-- tenant isolation. The UPSERT + RETURNING happens in one statement,
-- so concurrent callers for the same (tenant, document_type) are
-- serialized by Postgres's row-level locking on the UPDATE, not by
-- application-level locking.
CREATE FUNCTION next_document_number(p_tenant_id uuid, p_document_type text)
RETURNS bigint AS $$
DECLARE
  v_number bigint;
BEGIN
  INSERT INTO document_sequence (tenant_id, document_type, next_number)
  VALUES (p_tenant_id, p_document_type, 2)
  ON CONFLICT (tenant_id, document_type)
  DO UPDATE SET next_number = document_sequence.next_number + 1
  RETURNING (CASE WHEN document_sequence.next_number = 2 AND xmax = 0 THEN 1 ELSE document_sequence.next_number - 1 END)
  INTO v_number;
  RETURN v_number;
END;
$$ LANGUAGE plpgsql;
```

This is a genuinely tricky atomic-upsert-and-return pattern; the implementer should not need to modify it, but should understand what it does: **Step 2 verifies the exact behavior** below before moving on, because a subtly wrong version of this function would silently produce wrong invoice numbers.

- [ ] **Step 2: Verify the sequence behavior directly against the database**

Run this ad-hoc verification (same pattern as Task 2's type-check — either `node -e` or a scratch test file deleted afterward):

```typescript
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!);
const [tenant] = await sql`INSERT INTO tenant (name) VALUES ('Sequence Verify Tenant') RETURNING id`;

const first = await sql`SELECT next_document_number(${tenant.id}, 'invoice') as n`;
const second = await sql`SELECT next_document_number(${tenant.id}, 'invoice') as n`;
const third = await sql`SELECT next_document_number(${tenant.id}, 'invoice') as n`;
console.log(first[0].n, second[0].n, third[0].n);
// Expected: 1 2 3

// A different document_type for the same tenant starts its own sequence at 1
const otherType = await sql`SELECT next_document_number(${tenant.id}, 'purchase_order') as n`;
console.log(otherType[0].n);
// Expected: 1

await sql.end();
```

Expected: `1 2 3` then `1`. If the function instead prints `2 2 3` or similar (the classic off-by-one in this exact upsert pattern), the `CASE WHEN ... xmax = 0` branch is wrong — `xmax = 0` is Postgres's way of detecting "this row was just INSERTed, not UPDATEd," which is what distinguishes the first call (should return 1) from every subsequent call (should return `next_number - 1` after incrementing). Fix the migration and re-verify before proceeding; do not proceed with an unverified sequence function, since it directly determines whether later invoice/PO numbering is correct.

- [ ] **Step 3: Write the failing test**

```typescript
// lib/erp/__tests__/document-sequence.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { nextDocumentNumber } from '../document-sequence';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('document sequence data access', () => {
  it('returns 1, 2, 3 for successive calls with the same tenant and document type', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Doc Seq Test Tenant 1') RETURNING id`;

    const first = await nextDocumentNumber(tenant.id, 'invoice');
    const second = await nextDocumentNumber(tenant.id, 'invoice');
    const third = await nextDocumentNumber(tenant.id, 'invoice');

    expect([first, second, third]).toEqual([1, 2, 3]);
  });

  it('tracks separate sequences per document type for the same tenant', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Doc Seq Test Tenant 2') RETURNING id`;

    const invoiceFirst = await nextDocumentNumber(tenant.id, 'invoice');
    const poFirst = await nextDocumentNumber(tenant.id, 'purchase_order');

    expect(invoiceFirst).toBe(1);
    expect(poFirst).toBe(1);
  });

  it('tracks separate sequences per tenant for the same document type', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Doc Seq Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Doc Seq Test Tenant 3B') RETURNING id`;

    await nextDocumentNumber(tenantA.id, 'invoice');
    await nextDocumentNumber(tenantA.id, 'invoice');
    const tenantBFirst = await nextDocumentNumber(tenantB.id, 'invoice');

    expect(tenantBFirst).toBe(1);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/document-sequence.test.ts`
Expected: FAIL — `lib/erp/document-sequence.ts` does not exist yet.

- [ ] **Step 5: Write the implementation**

```typescript
// lib/erp/document-sequence.ts
import { withTenant } from '../db/with-tenant';

export async function nextDocumentNumber(tenantId: string, documentType: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`SELECT next_document_number(${tenantId}, ${documentType}) as n`;
    return Number(row.n);
  });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/document-sequence.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 7: Commit**

```bash
git add db/migrations/0010_document_sequence.sql lib/erp/document-sequence.ts lib/erp/__tests__/document-sequence.test.ts
git commit -m "feat: add document_sequence table with atomic per-tenant numbering"
```

---

### Task 6: Full-Suite Verification

**Files:** none created or modified — verification only.

**Interfaces:** N/A.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every existing test (Phase 1A/2A/2B backend + Phase 2B components, unchanged) plus all new `lib/erp/__tests__/*.test.ts` files and the RLS audit test (now covering 4 additional tables: `tenant_erp_settings`, `vendor`, `product`, `document_sequence`) pass with zero failures.

- [ ] **Step 2: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify no table-name or migration-number collisions**

Run: `ls db/migrations/*.sql`
Expected: exactly 10 files, numbered 0001 through 0010 with no gaps or duplicates, and the five new ones (0006–0010) match the table names in this plan (`tenant_erp_settings`, `approval_state` type only, `vendor`, `product`, `document_sequence`) with no collision against `contact`, `pipeline_stage`, `deal`, `tenant`, `app_user`.

- [ ] **Step 4: Commit (only if Steps 1–2 required any fixes)**

```bash
git add -A
git commit -m "chore: verify phase 3a-1 full suite and type check"
```

If Steps 1–2 pass with no changes needed, skip this commit — there's nothing new to commit.
