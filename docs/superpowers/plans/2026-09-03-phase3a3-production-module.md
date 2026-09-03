# Phase 3A-3: Production Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build bills of materials, routings/work centers, and the manufacturing-order lifecycle that lets a `goods_handling == 'production'` tenant convert raw components into finished goods, entirely on top of the existing stock ledger — no parallel inventory mechanism.

**Architecture:** Six new tables (`bill_of_materials`, `bom_component`, `work_center`, `routing`, `operation`, `manufacturing_order`, `work_order`) capture the production graph. `bill_of_materials` has an asymmetric relationship to `product` (many BoMs can produce one product) and to `routing` (0..1 routing per BoM, many BoMs can share one routing). `manufacturing_order` follows purchase_order's proven two-state-column pattern (`approval_state` + fulfillment `status`, never collapsed). Production consumption and output are ordinary `stock_move` rows — component consumption is an outbound move from a source location, finished-good receipt is an inbound move to the target location, exactly mirroring how Phase 3A-2 modeled procurement receipt, per the design spec's "WIP is just another location" principle. `completeManufacturingOrder` explicitly replicates the two hard lessons from Phase 3A-2's `receivePurchaseOrder` fix (see Global Constraints) rather than re-deriving them from scratch.

**Tech Stack:** Postgres (Neon) migrations, `postgres` npm package via `withTenant()`, Vitest (`backend` project) for tests.

**Spec:** `docs/superpowers/specs/2026-09-01-phase3-erp-design.md` (§4's "Production" module row) and `docs/superpowers/specs/research/2026-09-01-erp-market-research.md` §3 (the entity/relationship model this plan implements directly: asymmetric BoM↔product and routing↔BoM cardinality, MO vs WorkOrder distinction, recursive BoM via component→product, WIP-as-location).

## Global Constraints

- Every new table MUST have both `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, plus a `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())` — checked automatically by the existing `db/migrations/__tests__/rls-policy-audit.test.ts` CI gate.
- All application-level DB access goes through `withTenant(tenantId, fn)` from `lib/db/with-tenant.ts` — never call `getSql()` directly.
- Mirror `lib/erp/locations.ts`, `lib/erp/vendors.ts`, and `lib/erp/purchase-orders.ts` exactly as reference patterns: typed interfaces, a `rowToX` mapper, functions via `withTenant()`.
- Do not collide with existing table names: `tenant`, `app_user`, `contact`, `pipeline_stage`, `deal`, `tenant_erp_settings`, `vendor`, `product`, `document_sequence`, `location`, `stock_move`, `purchase_order`, `purchase_order_line`.
- Next migration number is `0015` (existing: 0001–0014 in `db/migrations/`).
- `approval_state` enum has exactly 5 values (`draft`, `pending_approval`, `approved`, `rejected`, `withdrawn`) — reuse this type, never redefine it.
- `nextDocumentNumber(tenantId: string, documentType: string): Promise<number>` from `lib/erp/document-sequence.ts` is the sole way to generate a manufacturing order's document number, called with `documentType: 'manufacturing_order'`.
- **Two binding lessons from Phase 3A-2's final-review fix** (`lib/erp/purchase-orders.ts`'s `receivePurchaseOrder`, current on `main` as of commit `6bb6d33`) apply directly to this plan's `completeManufacturingOrder` (Task 5) and must be replicated, not re-derived:
  1. **Validate every location argument belongs to the tenant BEFORE any write.** `receivePurchaseOrder` calls `getLocation(tenantId, locationId)` first and returns `null` immediately if it comes back `null` — a cross-tenant or nonexistent location is rejected before any state change. `completeManufacturingOrder` takes TWO location arguments (a component source location and the MO's own target location) and must validate both this way before touching anything.
  2. **The state-flip UPDATE and every resulting `stock_move` insert must share ONE transaction.** `receivePurchaseOrder` runs `UPDATE ... WHERE status = 'submitted' RETURNING *` first inside a single `withTenant` call, and only if that UPDATE returns a row does it proceed — within the SAME transaction — to insert stock_move rows by inlining the INSERT directly on that transaction's `tx` handle (not by calling `recordStockMove`, which opens its own separate transaction). `completeManufacturingOrder` must follow this exact shape: one `withTenant` call, the status-flip UPDATE first, then every component-consumption and finished-good-receipt INSERT inlined on the same `tx`.
- Money is not a concern in this plan — no new table here has a money field (unlike `purchase_order_line`'s `unit_price_minor_units`), so the integer-minor-units convention doesn't apply to any new column.
- TDD: write the failing test before the implementation in every task that has one.
- Test-isolation discipline: any test that queries shared state must scope by tenant/id explicitly — never rely on being "the only test" creating a given row.
- `npx tsc --noEmit` must stay clean after every task.
- `vitest.config.ts` already has `testTimeout: 20000` — no config changes needed.
- Grant `SELECT, INSERT, UPDATE, DELETE` to `app_runtime` on every new table, matching the existing migrations' pattern exactly.

---

### Task 1: `bill_of_materials` and `bom_component` Tables

**Files:**
- Create: `db/migrations/0015_bill_of_materials.sql`
- Create: `lib/erp/bom.ts`
- Test: `lib/erp/__tests__/bom.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`.
- Produces: `BomType` type (`'manufacture' | 'kit'`); `BillOfMaterials` interface (`id: string`, `tenantId: string`, `productId: string`, `name: string`, `bomType: BomType`, `routingId: string | null`, `createdAt: Date`, `updatedAt: Date`); `BomComponent` interface (`id: string`, `billOfMaterialsId: string`, `componentProductId: string`, `quantity: number`); `NewBom` interface (`productId: string`, `name: string`, `bomType: BomType`, `components: Array<{ componentProductId: string; quantity: number }>`); `createBom(tenantId: string, input: NewBom): Promise<BillOfMaterials>` (inserts the BoM row with `routingId: null` — Task 3 adds routing attachment separately — and all components, mirroring `createPurchaseOrder`'s inline-lines-on-create pattern); `getBom(tenantId: string, id: string): Promise<BillOfMaterials | null>`; `listBomComponents(tenantId: string, billOfMaterialsId: string): Promise<BomComponent[]>`. Task 3 (routing) will `UPDATE bill_of_materials SET routing_id = ...` directly — no function needed here for that, since Task 3's `attachRouting` (defined in Task 3) does it. Task 4/5 (manufacturing_order) reference `bill_of_materials.id` as a foreign key and call `getBom`/`listBomComponents` to read what to produce/consume.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0015_bill_of_materials.sql
CREATE TYPE bom_type AS ENUM ('manufacture', 'kit');

-- A BoM belongs to exactly one product (the finished good it produces),
-- but a product may have MULTIPLE BoMs — e.g. two different recipes for
-- the same finished good (research §3.1's asymmetric cardinality). Do
-- not add a UNIQUE constraint on product_id.
--
-- routing_id is nullable and added here (rather than only on the routing
-- table) because a BoM has AT MOST ONE routing (0..1), while a routing
-- may be attached to MULTIPLE BoMs (research §3.1) — the FK belongs on
-- the "many" side pointing at the "one" side it's optional toward, which
-- is bill_of_materials -> routing here. Task 3 adds the actual
-- REFERENCES constraint once the routing table exists (this table is
-- created before routing in migration order), via a follow-up
-- ALTER TABLE in Task 3's own migration — do not add a routing_id column
-- referencing a table that doesn't exist yet.
CREATE TABLE bill_of_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  product_id uuid NOT NULL REFERENCES product(id),
  name text NOT NULL,
  bom_type bom_type NOT NULL DEFAULT 'manufacture',
  routing_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Recursive by reference, not by a self-FK on this table: a component's
-- component_product_id can itself be a product with its own
-- bill_of_materials row (research §3.1/§3.3 — "component may have its
-- own BoM"). Multi-level explosion is a read-time graph walk
-- (product -> its BoMs -> their components -> those products' BoMs...),
-- not a schema-level recursive FK here.
CREATE TABLE bom_component (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  bill_of_materials_id uuid NOT NULL REFERENCES bill_of_materials(id),
  component_product_id uuid NOT NULL REFERENCES product(id),
  quantity numeric NOT NULL CHECK (quantity > 0)
);

CREATE INDEX bom_tenant_product_idx ON bill_of_materials (tenant_id, product_id);
CREATE INDEX bom_component_tenant_bom_idx ON bom_component (tenant_id, bill_of_materials_id);

ALTER TABLE bill_of_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_of_materials FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bill_of_materials
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE bom_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_component FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bom_component
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON bill_of_materials, bom_component TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/bom.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createBom, getBom, listBomComponents } from '../bom';
import { createProduct } from '../products';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('bill of materials data access', () => {
  it('creates a BoM with components and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('BoM Test Tenant 1') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Widget Assembly', productType: 'goods' });
    const part1 = await createProduct(tenant.id, { name: 'Widget Frame', productType: 'goods' });
    const part2 = await createProduct(tenant.id, { name: 'Widget Screw', productType: 'goods' });

    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Standard Widget Assembly',
      bomType: 'manufacture',
      components: [
        { componentProductId: part1.id, quantity: 1 },
        { componentProductId: part2.id, quantity: 4 },
      ],
    });

    expect(bom.productId).toBe(finishedGood.id);
    expect(bom.bomType).toBe('manufacture');
    expect(bom.routingId).toBeNull();

    const fetched = await getBom(tenant.id, bom.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Standard Widget Assembly');

    const components = await listBomComponents(tenant.id, bom.id);
    expect(components).toHaveLength(2);
    expect(components.find((c) => c.componentProductId === part2.id)?.quantity).toBe(4);
  });

  it('allows a product to have multiple BoMs', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('BoM Test Tenant 2') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Gadget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Gadget Part', productType: 'goods' });

    const bomA = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Recipe A',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const bomB = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Recipe B',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 2 }],
    });

    expect(bomA.id).not.toBe(bomB.id);
    expect(bomA.productId).toBe(bomB.productId);
  });

  it('returns null from getBom for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('BoM Test Tenant 3') RETURNING id`;
    const result = await getBom(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/bom.test.ts`
Expected: FAIL — `lib/erp/bom.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/bom.ts
import { withTenant } from '../db/with-tenant';

export type BomType = 'manufacture' | 'kit';

export interface BillOfMaterials {
  id: string;
  tenantId: string;
  productId: string;
  name: string;
  bomType: BomType;
  routingId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BomComponent {
  id: string;
  billOfMaterialsId: string;
  componentProductId: string;
  quantity: number;
}

export interface NewBom {
  productId: string;
  name: string;
  bomType: BomType;
  components: Array<{ componentProductId: string; quantity: number }>;
}

function rowToBom(row: any): BillOfMaterials {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    name: row.name,
    bomType: row.bom_type,
    routingId: row.routing_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToBomComponent(row: any): BomComponent {
  return {
    id: row.id,
    billOfMaterialsId: row.bill_of_materials_id,
    componentProductId: row.component_product_id,
    quantity: Number(row.quantity),
  };
}

export async function createBom(tenantId: string, input: NewBom): Promise<BillOfMaterials> {
  return withTenant(tenantId, async (tx) => {
    const [bomRow] = await tx`
      INSERT INTO bill_of_materials (tenant_id, product_id, name, bom_type)
      VALUES (${tenantId}, ${input.productId}, ${input.name}, ${input.bomType})
      RETURNING *
    `;

    for (const component of input.components) {
      await tx`
        INSERT INTO bom_component (tenant_id, bill_of_materials_id, component_product_id, quantity)
        VALUES (${tenantId}, ${bomRow.id}, ${component.componentProductId}, ${component.quantity})
      `;
    }

    return rowToBom(bomRow);
  });
}

export async function getBom(tenantId: string, id: string): Promise<BillOfMaterials | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM bill_of_materials WHERE id = ${id}`;
    return rows.length > 0 ? rowToBom(rows[0]) : null;
  });
}

export async function listBomComponents(tenantId: string, billOfMaterialsId: string): Promise<BomComponent[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM bom_component WHERE bill_of_materials_id = ${billOfMaterialsId} ORDER BY id`;
    return rows.map(rowToBomComponent);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/bom.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0015_bill_of_materials.sql lib/erp/bom.ts lib/erp/__tests__/bom.test.ts
git commit -m "feat: add bill_of_materials and bom_component tables"
```

---

### Task 2: `work_center` Table and Data-Access Layer

**Files:**
- Create: `db/migrations/0016_work_center.sql`
- Create: `lib/erp/work-centers.ts`
- Test: `lib/erp/__tests__/work-centers.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`.
- Produces: `WorkCenter` interface (`id: string`, `tenantId: string`, `name: string`, `createdAt: Date`); `NewWorkCenter` interface (`name: string`); `createWorkCenter(tenantId: string, input: NewWorkCenter): Promise<WorkCenter>`; `getWorkCenter(tenantId: string, id: string): Promise<WorkCenter | null>`; `listWorkCenters(tenantId: string): Promise<WorkCenter[]>`. This is a trivial standalone table — a direct mirror of `lib/erp/locations.ts`. Task 3 (`operation`) references `work_center.id` as a foreign key.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0016_work_center.sql
-- A place/resource where a production operation happens (a machine, a
-- workstation, an assembly line). Deliberately minimal for this phase —
-- capacity/scheduling fields are a later extension per research §3.2
-- ("work centers and capacity... a shop doing simple assembly may not
-- need it" — so this table starts with just identity, not capacity).
CREATE TABLE work_center (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX work_center_tenant_id_idx ON work_center (tenant_id, id);

ALTER TABLE work_center ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_center FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON work_center
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON work_center TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/work-centers.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createWorkCenter, getWorkCenter, listWorkCenters } from '../work-centers';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('work center data access', () => {
  it('creates a work center and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Work Center Test Tenant 1') RETURNING id`;

    const workCenter = await createWorkCenter(tenant.id, { name: 'Assembly Line 1' });

    expect(workCenter.name).toBe('Assembly Line 1');

    const fetched = await getWorkCenter(tenant.id, workCenter.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Assembly Line 1');
  });

  it('returns null from getWorkCenter for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Work Center Test Tenant 2') RETURNING id`;
    const result = await getWorkCenter(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('lists only work centers belonging to the given tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Work Center Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Work Center Test Tenant 3B') RETURNING id`;

    await createWorkCenter(tenantA.id, { name: 'Tenant A Line' });
    await createWorkCenter(tenantB.id, { name: 'Tenant B Line' });

    const centersA = await listWorkCenters(tenantA.id);
    expect(centersA.map((c) => c.name)).toEqual(['Tenant A Line']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/work-centers.test.ts`
Expected: FAIL — `lib/erp/work-centers.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/work-centers.ts
import { withTenant } from '../db/with-tenant';

export interface WorkCenter {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
}

export interface NewWorkCenter {
  name: string;
}

function rowToWorkCenter(row: any): WorkCenter {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

export async function createWorkCenter(tenantId: string, input: NewWorkCenter): Promise<WorkCenter> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO work_center (tenant_id, name)
      VALUES (${tenantId}, ${input.name})
      RETURNING *
    `;
    return rowToWorkCenter(row);
  });
}

export async function getWorkCenter(tenantId: string, id: string): Promise<WorkCenter | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM work_center WHERE id = ${id}`;
    return rows.length > 0 ? rowToWorkCenter(rows[0]) : null;
  });
}

export async function listWorkCenters(tenantId: string): Promise<WorkCenter[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM work_center ORDER BY created_at ASC`;
    return rows.map(rowToWorkCenter);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/work-centers.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0016_work_center.sql lib/erp/work-centers.ts lib/erp/__tests__/work-centers.test.ts
git commit -m "feat: add work_center table and data-access layer"
```

---

### Task 3: `routing`/`operation` Tables and BoM Attachment

**Files:**
- Create: `db/migrations/0017_routing.sql`
- Create: `lib/erp/routing.ts`
- Test: `lib/erp/__tests__/routing.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`; `WorkCenter` (Task 2) via `work_center.id` FK; `BillOfMaterials` (Task 1) — this task's `attachRouting` function updates `bill_of_materials.routing_id`.
- Produces: `Routing` interface (`id: string`, `tenantId: string`, `name: string`, `createdAt: Date`); `Operation` interface (`id: string`, `routingId: string`, `workCenterId: string`, `sequence: number`, `name: string`, `durationMinutes: number`); `NewRouting` interface (`name: string`, `operations: Array<{ workCenterId: string; sequence: number; name: string; durationMinutes: number }>`); `createRouting(tenantId: string, input: NewRouting): Promise<Routing>` (inserts the routing and all operations, mirroring `createBom`'s inline pattern); `listOperations(tenantId: string, routingId: string): Promise<Operation[]>` (returns operations ordered by `sequence`); `attachRouting(tenantId: string, billOfMaterialsId: string, routingId: string): Promise<BillOfMaterials | null>` (sets `bill_of_materials.routing_id`, returns `null` if the BoM doesn't exist for this tenant — imports `BillOfMaterials`/`rowToBom`-equivalent mapping locally rather than importing `bom.ts`'s private `rowToBom`, since that function isn't exported; re-declare an equivalent local mapper or query+map inline). Task 5 (`planManufacturingOrder`) calls `listOperations` on the MO's BoM's routing (if any) to generate `work_order` rows.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0017_routing.sql
-- A routing defines an ordered list of operations. Per research §3.1: a
-- routing may be attached to MULTIPLE BoMs (the operations list is
-- reusable), while a BoM has AT MOST ONE routing (0..1) — the FK for
-- that relationship was added as a nullable column on bill_of_materials
-- in Task 1's migration (0015); this migration adds the REFERENCES
-- constraint now that the routing table exists.
CREATE TABLE routing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  routing_id uuid NOT NULL REFERENCES routing(id),
  work_center_id uuid NOT NULL REFERENCES work_center(id),
  sequence integer NOT NULL,
  name text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0)
);

ALTER TABLE bill_of_materials ADD CONSTRAINT bill_of_materials_routing_id_fkey
  FOREIGN KEY (routing_id) REFERENCES routing(id);

CREATE INDEX routing_tenant_id_idx ON routing (tenant_id, id);
CREATE INDEX operation_tenant_routing_idx ON operation (tenant_id, routing_id, sequence);

ALTER TABLE routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON routing
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON operation
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON routing, operation TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/routing.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createRouting, listOperations, attachRouting } from '../routing';
import { createWorkCenter } from '../work-centers';
import { createBom } from '../bom';
import { createProduct } from '../products';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('routing data access', () => {
  it('creates a routing with ordered operations and reads them back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Routing Test Tenant 1') RETURNING id`;
    const workCenter = await createWorkCenter(tenant.id, { name: 'Assembly Line' });

    const routing = await createRouting(tenant.id, {
      name: 'Standard Assembly Routing',
      operations: [
        { workCenterId: workCenter.id, sequence: 1, name: 'Attach frame', durationMinutes: 10 },
        { workCenterId: workCenter.id, sequence: 2, name: 'Install screws', durationMinutes: 5 },
      ],
    });

    expect(routing.name).toBe('Standard Assembly Routing');

    const operations = await listOperations(tenant.id, routing.id);
    expect(operations).toHaveLength(2);
    expect(operations.map((o) => o.name)).toEqual(['Attach frame', 'Install screws']);
  });

  it('attaches a routing to a BoM, and a routing can be attached to multiple BoMs', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Routing Test Tenant 2') RETURNING id`;
    const workCenter = await createWorkCenter(tenant.id, { name: 'Line 2' });
    const routing = await createRouting(tenant.id, {
      name: 'Shared Routing',
      operations: [{ workCenterId: workCenter.id, sequence: 1, name: 'Do the thing', durationMinutes: 15 }],
    });

    const finishedGoodA = await createProduct(tenant.id, { name: 'Product A', productType: 'goods' });
    const finishedGoodB = await createProduct(tenant.id, { name: 'Product B', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Shared Part', productType: 'goods' });

    const bomA = await createBom(tenant.id, {
      productId: finishedGoodA.id,
      name: 'BoM A',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const bomB = await createBom(tenant.id, {
      productId: finishedGoodB.id,
      name: 'BoM B',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });

    const updatedA = await attachRouting(tenant.id, bomA.id, routing.id);
    const updatedB = await attachRouting(tenant.id, bomB.id, routing.id);

    expect(updatedA).not.toBeNull();
    expect(updatedA!.routingId).toBe(routing.id);
    expect(updatedB).not.toBeNull();
    expect(updatedB!.routingId).toBe(routing.id);
  });

  it('attachRouting returns null for a nonexistent bill_of_materials id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Routing Test Tenant 3') RETURNING id`;
    const workCenter = await createWorkCenter(tenant.id, { name: 'Line 3' });
    const routing = await createRouting(tenant.id, {
      name: 'Routing 3',
      operations: [{ workCenterId: workCenter.id, sequence: 1, name: 'Step', durationMinutes: 5 }],
    });

    const result = await attachRouting(tenant.id, '00000000-0000-0000-0000-000000000000', routing.id);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/routing.test.ts`
Expected: FAIL — `lib/erp/routing.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/routing.ts
import { withTenant } from '../db/with-tenant';
import type { BillOfMaterials, BomType } from './bom';

export interface Routing {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
}

export interface Operation {
  id: string;
  routingId: string;
  workCenterId: string;
  sequence: number;
  name: string;
  durationMinutes: number;
}

export interface NewRouting {
  name: string;
  operations: Array<{ workCenterId: string; sequence: number; name: string; durationMinutes: number }>;
}

function rowToRouting(row: any): Routing {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

function rowToOperation(row: any): Operation {
  return {
    id: row.id,
    routingId: row.routing_id,
    workCenterId: row.work_center_id,
    sequence: row.sequence,
    name: row.name,
    durationMinutes: row.duration_minutes,
  };
}

// Local mapper, not imported from bom.ts: rowToBom there is a private,
// unexported helper (matching how every lib/erp/*.ts file keeps its
// row-mapper module-private). attachRouting needs the same shape to
// return an updated BillOfMaterials, so it re-declares an equivalent
// mapping here rather than reaching into bom.ts's internals.
function rowToBillOfMaterials(row: any): BillOfMaterials {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    name: row.name,
    bomType: row.bom_type as BomType,
    routingId: row.routing_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createRouting(tenantId: string, input: NewRouting): Promise<Routing> {
  return withTenant(tenantId, async (tx) => {
    const [routingRow] = await tx`
      INSERT INTO routing (tenant_id, name)
      VALUES (${tenantId}, ${input.name})
      RETURNING *
    `;

    for (const op of input.operations) {
      await tx`
        INSERT INTO operation (tenant_id, routing_id, work_center_id, sequence, name, duration_minutes)
        VALUES (${tenantId}, ${routingRow.id}, ${op.workCenterId}, ${op.sequence}, ${op.name}, ${op.durationMinutes})
      `;
    }

    return rowToRouting(routingRow);
  });
}

export async function listOperations(tenantId: string, routingId: string): Promise<Operation[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM operation WHERE routing_id = ${routingId} ORDER BY sequence ASC`;
    return rows.map(rowToOperation);
  });
}

export async function attachRouting(
  tenantId: string,
  billOfMaterialsId: string,
  routingId: string,
): Promise<BillOfMaterials | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE bill_of_materials
      SET routing_id = ${routingId}, updated_at = now()
      WHERE id = ${billOfMaterialsId}
      RETURNING *
    `;
    return rows.length > 0 ? rowToBillOfMaterials(rows[0]) : null;
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/routing.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0017_routing.sql lib/erp/routing.ts lib/erp/__tests__/routing.test.ts
git commit -m "feat: add routing and operation tables with BoM attachment"
```

---

### Task 4: `manufacturing_order` Table and Creation

**Files:**
- Create: `db/migrations/0018_manufacturing_order.sql`
- Create: `lib/erp/manufacturing-orders.ts`
- Test: `lib/erp/__tests__/manufacturing-orders.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`; `nextDocumentNumber(tenantId, documentType)` from `lib/erp/document-sequence.ts`, called with `documentType: 'manufacturing_order'`.
- Produces: `ManufacturingOrderStatus` type (`'draft' | 'planned' | 'in_progress' | 'completed' | 'cancelled'`); `ManufacturingOrder` interface (`id: string`, `tenantId: string`, `productId: string`, `billOfMaterialsId: string`, `quantity: number`, `targetLocationId: string`, `documentNumber: number`, `approvalState: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn'`, `status: ManufacturingOrderStatus`, `createdAt: Date`, `updatedAt: Date`); `NewManufacturingOrder` interface (`productId: string`, `billOfMaterialsId: string`, `quantity: number`, `targetLocationId: string`); `createManufacturingOrder(tenantId: string, input: NewManufacturingOrder): Promise<ManufacturingOrder>` (allocates `documentNumber` via `nextDocumentNumber`, inserts with `approvalState: 'draft'`, `status: 'draft'`, both explicit defaults matching `purchase_order`'s pattern); `getManufacturingOrder(tenantId: string, id: string): Promise<ManufacturingOrder | null>`. This task deliberately does NOT include `planManufacturingOrder` or `completeManufacturingOrder` — those are Task 5, since they depend on `work_order` (also Task 5) and on the two Phase-3A-2-postmortem-lesson patterns that deserve their own focused task and review.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0018_manufacturing_order.sql
CREATE TYPE manufacturing_order_status AS ENUM ('draft', 'planned', 'in_progress', 'completed', 'cancelled');

-- Same two-independent-state-columns principle as purchase_order
-- (Phase 3A-2, design spec §3 boundary call #3): approval_state answers
-- "was this approved" (defaults 'draft' so a future Phase 5 agent action
-- never auto-approves itself, per .claude/rules/ai-systems.md); status
-- answers "where is this in the production lifecycle". Collapsing them
-- would make "approved but not yet planned" and "planned without ever
-- being approved" indistinguishable from their opposites — exactly the
-- mistake purchase_order's own header comment already warns against.
CREATE TABLE manufacturing_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  product_id uuid NOT NULL REFERENCES product(id),
  bill_of_materials_id uuid NOT NULL REFERENCES bill_of_materials(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  target_location_id uuid NOT NULL REFERENCES location(id),
  document_number bigint NOT NULL,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  status manufacturing_order_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_number)
);

CREATE INDEX manufacturing_order_tenant_id_idx ON manufacturing_order (tenant_id, id);
CREATE INDEX manufacturing_order_tenant_product_idx ON manufacturing_order (tenant_id, product_id);

ALTER TABLE manufacturing_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing_order FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON manufacturing_order
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON manufacturing_order TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/manufacturing-orders.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createManufacturingOrder, getManufacturingOrder } from '../manufacturing-orders';
import { createBom } from '../bom';
import { createProduct } from '../products';
import { createLocation } from '../locations';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('manufacturing order data access', () => {
  it('creates a manufacturing order in draft/draft with a sequential document number', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 1') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Widget Part', productType: 'goods' });
    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Widget BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 2 }],
    });
    const location = await createLocation(tenant.id, { name: 'Factory Floor' });

    const mo = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 10,
      targetLocationId: location.id,
    });

    expect(mo.status).toBe('draft');
    expect(mo.approvalState).toBe('draft');
    expect(mo.documentNumber).toBe(1);
    expect(mo.quantity).toBe(10);
  });

  it('allocates sequential document numbers per tenant, in the manufacturing_order sequence distinct from purchase_order', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 2') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Widget Part', productType: 'goods' });
    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Widget BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const location = await createLocation(tenant.id, { name: 'Factory Floor' });

    const mo1 = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 1,
      targetLocationId: location.id,
    });
    const mo2 = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 1,
      targetLocationId: location.id,
    });

    expect(mo1.documentNumber).toBe(1);
    expect(mo2.documentNumber).toBe(2);
  });

  it('returns null from getManufacturingOrder for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 3') RETURNING id`;
    const result = await getManufacturingOrder(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/manufacturing-orders.test.ts`
Expected: FAIL — `lib/erp/manufacturing-orders.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/manufacturing-orders.ts
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
```

Note: `rowToManufacturingOrder` is exported (unlike every other `rowToX` mapper in this codebase, which are module-private) specifically because Task 5 modifies this same file and needs to reuse it across `planManufacturingOrder`/`completeManufacturingOrder` — those functions live in this same file per Task 5's Files section, so this is a same-file convenience, not a cross-file export pattern to repeat elsewhere.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/manufacturing-orders.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0018_manufacturing_order.sql lib/erp/manufacturing-orders.ts lib/erp/__tests__/manufacturing-orders.test.ts
git commit -m "feat: add manufacturing_order table and creation"
```

---

### Task 5: `work_order` Table, Planning, and Completion

**Files:**
- Create: `db/migrations/0019_work_order.sql`
- Modify: `lib/erp/manufacturing-orders.ts`
- Modify: `lib/erp/__tests__/manufacturing-orders.test.ts`

**Interfaces:**
- Consumes: `rowToManufacturingOrder` (exported from this same file, Task 4); `listOperations(tenantId, routingId)` from `lib/erp/routing.ts`; `getBom(tenantId, id)` and `listBomComponents(tenantId, billOfMaterialsId)` from `lib/erp/bom.ts`; `getLocation(tenantId, id)` from `lib/erp/locations.ts` — the exact function `receivePurchaseOrder` uses for its pre-write validation (Global Constraints lesson 1).
- Produces: `WorkOrderStatus` type (`'pending' | 'in_progress' | 'done'`); `WorkOrder` interface (`id: string`, `manufacturingOrderId: string`, `operationId: string | null`, `status: WorkOrderStatus`, `createdAt: Date`, `updatedAt: Date`); `listWorkOrders(tenantId: string, manufacturingOrderId: string): Promise<WorkOrder[]>`; `planManufacturingOrder(tenantId: string, manufacturingOrderId: string): Promise<ManufacturingOrder | null>` — atomically flips `status` from `'draft'` to `'planned'` (same `UPDATE ... WHERE status = 'draft' RETURNING *` guard as `submitPurchaseOrder`), and if the MO's BoM has a `routingId`, generates one `work_order` row per operation in that routing (ordered by `sequence`), each `status: 'pending'`; if the BoM has no routing, no `work_order` rows are created (a valid MO with no operations to track — e.g. simple assembly with no formal routing) and planning still succeeds; `completeManufacturingOrder(tenantId: string, manufacturingOrderId: string, componentSourceLocationId: string): Promise<ManufacturingOrder | null>` — the stock-move-generating step, implementing both binding Global Constraints lessons.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0019_work_order.sql
CREATE TYPE work_order_status AS ENUM ('pending', 'in_progress', 'done');

-- "Perform this operation at this work center" for one specific
-- manufacturing order (research §3.1/§3.3: MO = "make N of this
-- product", WorkOrder = "perform this operation at this work center" —
-- two different entities). operation_id is nullable: an MO whose BoM
-- has no routing attached has no work orders at all (see
-- planManufacturingOrder in lib/erp/manufacturing-orders.ts) rather than
-- a work_order row with a null operation — so in practice this column
-- is always populated for any row that exists, but stays nullable
-- because a future "ad-hoc work order not tied to a routing operation"
-- use case is a real possibility this schema shouldn't foreclose.
CREATE TABLE work_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  manufacturing_order_id uuid NOT NULL REFERENCES manufacturing_order(id),
  operation_id uuid REFERENCES operation(id),
  status work_order_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_order_tenant_mo_idx ON work_order (tenant_id, manufacturing_order_id);

ALTER TABLE work_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_order
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON work_order TO app_runtime;
```

- [ ] **Step 2: Write the failing tests**

Add to `lib/erp/__tests__/manufacturing-orders.test.ts`:

```typescript
  it('planManufacturingOrder generates one work_order per routing operation, ordered by sequence', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 4') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Widget Part', productType: 'goods' });
    const workCenter = await createWorkCenter(tenant.id, { name: 'Line A' });
    const routing = await createRouting(tenant.id, {
      name: 'Widget Routing',
      operations: [
        { workCenterId: workCenter.id, sequence: 1, name: 'Cut', durationMinutes: 5 },
        { workCenterId: workCenter.id, sequence: 2, name: 'Assemble', durationMinutes: 10 },
      ],
    });
    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Widget BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    await attachRouting(tenant.id, bom.id, routing.id);
    const location = await createLocation(tenant.id, { name: 'Factory Floor' });

    const mo = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 5,
      targetLocationId: location.id,
    });

    const planned = await planManufacturingOrder(tenant.id, mo.id);
    expect(planned).not.toBeNull();
    expect(planned!.status).toBe('planned');

    const workOrders = await listWorkOrders(tenant.id, mo.id);
    expect(workOrders).toHaveLength(2);
    expect(workOrders.every((wo) => wo.status === 'pending')).toBe(true);
  });

  it('planManufacturingOrder succeeds with zero work orders when the BoM has no routing', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 5') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Simple Widget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Part', productType: 'goods' });
    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'No-Routing BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const location = await createLocation(tenant.id, { name: 'Factory Floor' });

    const mo = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 1,
      targetLocationId: location.id,
    });

    const planned = await planManufacturingOrder(tenant.id, mo.id);
    expect(planned).not.toBeNull();
    expect(planned!.status).toBe('planned');

    const workOrders = await listWorkOrders(tenant.id, mo.id);
    expect(workOrders).toHaveLength(0);
  });

  it('planManufacturingOrder returns null for an MO not currently in draft', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 6') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Part', productType: 'goods' });
    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const location = await createLocation(tenant.id, { name: 'Factory Floor' });
    const mo = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 1,
      targetLocationId: location.id,
    });

    await planManufacturingOrder(tenant.id, mo.id);
    const secondAttempt = await planManufacturingOrder(tenant.id, mo.id);
    expect(secondAttempt).toBeNull();
  });

  it('completeManufacturingOrder consumes components and receives the finished good, flipping status to completed', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 7') RETURNING id`;
    const finishedGood = await createProduct(tenant.id, { name: 'Widget', productType: 'goods' });
    const part = await createProduct(tenant.id, { name: 'Widget Part', productType: 'goods' });
    const bom = await createBom(tenant.id, {
      productId: finishedGood.id,
      name: 'Widget BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 3 }],
    });
    const componentSource = await createLocation(tenant.id, { name: 'Raw Materials' });
    const targetLocation = await createLocation(tenant.id, { name: 'Finished Goods' });

    // Seed component stock so consumption has something to draw down.
    await recordStockMove(tenant.id, {
      productId: part.id,
      locationId: componentSource.id,
      quantity: 100,
      movementType: 'receipt',
    });

    const mo = await createManufacturingOrder(tenant.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 5,
      targetLocationId: targetLocation.id,
    });
    await planManufacturingOrder(tenant.id, mo.id);

    const completed = await completeManufacturingOrder(tenant.id, mo.id, componentSource.id);
    expect(completed).not.toBeNull();
    expect(completed!.status).toBe('completed');

    // 5 units of finished good, each needing 3 of the component -> 15 consumed.
    expect(await getStockOnHand(tenant.id, part.id, componentSource.id)).toBe(85);
    expect(await getStockOnHand(tenant.id, finishedGood.id, targetLocation.id)).toBe(5);
  });

  it('completeManufacturingOrder rejects a componentSourceLocationId belonging to another tenant, with no state change', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 8A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('MO Test Tenant 8B') RETURNING id`;
    const otherTenantLocation = await createLocation(tenantB.id, { name: 'Tenant B Location' });

    const finishedGood = await createProduct(tenantA.id, { name: 'Widget', productType: 'goods' });
    const part = await createProduct(tenantA.id, { name: 'Part', productType: 'goods' });
    const bom = await createBom(tenantA.id, {
      productId: finishedGood.id,
      name: 'BoM',
      bomType: 'manufacture',
      components: [{ componentProductId: part.id, quantity: 1 }],
    });
    const targetLocation = await createLocation(tenantA.id, { name: 'Finished Goods' });
    const mo = await createManufacturingOrder(tenantA.id, {
      productId: finishedGood.id,
      billOfMaterialsId: bom.id,
      quantity: 1,
      targetLocationId: targetLocation.id,
    });
    await planManufacturingOrder(tenantA.id, mo.id);

    const result = await completeManufacturingOrder(tenantA.id, mo.id, otherTenantLocation.id);
    expect(result).toBeNull();

    const stillPlanned = await getManufacturingOrder(tenantA.id, mo.id);
    expect(stillPlanned!.status).toBe('planned');
    expect(await getStockOnHand(tenantA.id, finishedGood.id, targetLocation.id)).toBe(0);
  });
```

Add these imports to the top of `lib/erp/__tests__/manufacturing-orders.test.ts`:

```typescript
import { planManufacturingOrder, completeManufacturingOrder, listWorkOrders } from '../manufacturing-orders';
import { createWorkCenter } from '../work-centers';
import { createRouting, attachRouting } from '../routing';
import { recordStockMove, getStockOnHand } from '../stock';
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/manufacturing-orders.test.ts`
Expected: FAIL — `planManufacturingOrder`, `completeManufacturingOrder`, `listWorkOrders` are not exported from `lib/erp/manufacturing-orders.ts` yet.

- [ ] **Step 4: Write the implementation**

Add to `lib/erp/manufacturing-orders.ts` (imports at the top, functions at the bottom):

```typescript
import { listOperations } from './routing';
import { getBom, listBomComponents } from './bom';
import { getLocation } from './locations';
```

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/manufacturing-orders.test.ts`
Expected: PASS (8/8 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0019_work_order.sql lib/erp/manufacturing-orders.ts lib/erp/__tests__/manufacturing-orders.test.ts
git commit -m "feat: add work_order table, MO planning, and MO completion"
```

---

### Task 6: Full-Suite Verification

**Files:** none created or modified — verification only.

**Interfaces:** N/A.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every existing test (Phases 1A/2A/2B/3A-1/3A-2, unchanged) plus all new `lib/erp/__tests__/{bom,work-centers,routing,manufacturing-orders}.test.ts` files and the RLS audit test (now covering 7 additional tables: `bill_of_materials`, `bom_component`, `work_center`, `routing`, `operation`, `manufacturing_order`, `work_order`) pass with zero failures.

- [ ] **Step 2: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify no table-name or migration-number collisions**

Run: `ls db/migrations/*.sql`
Expected: exactly 19 files, numbered 0001 through 0019 with no gaps or duplicates, and the five new ones (0015–0019) match the table names in this plan with no collision against any existing table.

- [ ] **Step 4: Commit (only if Steps 1–2 required any fixes)**

```bash
git add -A
git commit -m "chore: verify phase 3a-3 full suite and type check"
```

If Steps 1–2 pass with no changes needed, skip this commit — there's nothing new to commit.
