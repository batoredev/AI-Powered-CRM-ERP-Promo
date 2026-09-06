# Phase 3A-6: Subscriptions Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the last remaining row of the design spec's module table — `plan`, `subscription`, `subscription_change_event`, `usage_record` — gated by `'recurring' IN billing_modes`, closing out Phase 3A entirely. Also builds `recurring_template`, a core shared entity the Subscriptions module depends on that was speced in Phase 3A-1 but never actually built — the same "missing core dependency" gap discovered and closed for `invoice`/`payment`/`sales_order` in Phase 3A-5.

**Architecture:** `recurring_template` is a generic, document-type-agnostic scheduling primitive (per the research's finding that QuickBooks applies it to transactions generally, not just subscriptions) — a `plan` attaches one to give itself a billing cadence. `subscription` binds a `contact` to a `plan`. Proration/upgrades/downgrades are never computed by editing the `subscription` row — they're recorded on an append-only `subscription_change_event` ledger, matching this project's `stock_move` precedent exactly. `usage_record` is a second, simpler append-only ledger for metered usage, with aggregation deferred to future scope.

**Tech Stack:** Postgres (Neon) migrations, `postgres` npm package via `withTenant()`, Vitest (`backend` project) for tests.

**Spec:** `docs/superpowers/specs/2026-09-01-phase3-erp-design.md` §4 (module table — Subscriptions gated by `'recurring' IN billing_modes`, depending on `recurring_template (core)`) and §3 point 2 (no derived values stored where an event belongs — the explicit "subscription proration is never computed by editing a subscription row" principle this plan's `subscription_change_event` table implements). `docs/superpowers/specs/research/2026-09-01-erp-market-research.md` §4 (Subscription/Recurring Billing — `RecurringTemplate`'s generic scheduling role, the `Plan`/`Subscription`/`ChangeEvent`/`UsageRecord` entity shape, unit+count billing periods, append-only usage/change events).

## Global Constraints

- Every new table MUST have both `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, plus `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())` — checked automatically by `db/migrations/__tests__/rls-policy-audit.test.ts`.
- All application-level DB access goes through `withTenant(tenantId, fn)` from `lib/db/with-tenant.ts` — never call `getSql()` directly.
- **Every foreign-key-accepting `create*` function MUST validate that the referenced row belongs to the calling tenant BEFORE any write, using the target's own `get*` function.** This is a hard, non-negotiable project convention — three prior phases (3A-2, 3A-3, and the Phase 3A-5 concurrency finding) shipped without full rigor here and needed fix waves. Bake it in from Task 1: `createPlan` validates `recurringTemplateId` via `getRecurringTemplate`; `createSubscription` validates `contactId` via `getContact` and `planId` via `getPlan`; `recordSubscriptionChangeEvent` validates `subscriptionId` via `getSubscription` and, when given, `previousPlanId`/`newPlanId` via `getPlan`; `recordUsage` validates `subscriptionId` via `getSubscription`.
- Reference `lib/erp/purchase-orders.ts` and `lib/erp/time-entries.ts` for the atomic `UPDATE ... WHERE <guard> RETURNING *` state-transition pattern (needed for `pauseSubscription`/`cancelSubscription`/`reactivateSubscription`), and `lib/erp/stock.ts` (`recordStockMove`/`getStockOnHand`) as the exact append-only-ledger pattern to replicate for `subscription_change_event` and `usage_record` — insert-only, no update/delete function, ever.
- **Billing period is a unit + count pair, never an enum of monthly/quarterly/annual** (Odoo's pattern, explicitly called out in the research) — `recurring_template.interval_unit` (`'weeks' | 'months' | 'years'`) + `recurring_template.interval_count` (integer) together express "every 3 months" or "every 2 weeks."
- **`recurring_template` is document-type-agnostic** — it generates *any* document type (a text field, e.g. `'invoice'`, `'sales_order'`), not just subscription invoices. This plan only builds the schema; no scheduler/cron job that actually reads `next_run_date` and generates a document exists yet — that's explicitly out of scope (see below).
- Money fields use the integer-minor-units + explicit-currency-code convention (`*_minor_units bigint` + `currency_code text`), matching `product.price_minor_units`/`currency_code`.
- `approval_state` enum (5 values: `draft`, `pending_approval`, `approved`, `rejected`, `withdrawn`) is reused, never redefined. Per the research's explicit approval-gate note: cancelling a subscription is an irreversible external action, so `subscription.approval_state` matters the same way `purchase_order.approval_state` does.
- `subscription_change_event` and `usage_record` are append-only event logs — **never** a derived/computed value stored on `subscription` itself, matching design spec §3 point 2's explicit principle (the same one that keeps `stock_move` the sole source of truth for on-hand quantity, never a `quantity_on_hand` column). No `updateSubscriptionChangeEvent`/`updateUsageRecord` functions exist, ever.
- Explicitly OUT OF SCOPE for this plan (do not build; deferred with a one-line reason each, not silently dropped):
  - `SubscriptionItem`/add-ons — a vertical-specific extension from the research, not in the design spec's approved module table.
  - `BillingCycle`/`PaymentAttempt`/`DunningPolicy` entities — same reason, research sketch not carried into the approved spec.
  - Metered/tiered/overage pricing shapes — `usage_record` only logs raw usage quantity; translating usage into a bill is future scope once an invoicing sweep exists.
  - Actual recurring document generation (the scheduler/cron job that reads `recurring_template.next_run_date` and creates a real `invoice`/`sales_order`) — this plan ships only the schema a future scheduler would read from.
  - Payment-retry policy — distinct from receivable dunning per the research; neither exists yet.
- TDD: write the failing test before the implementation in every task that has one.
- Test-isolation discipline: any test that queries shared state must scope by tenant/id explicitly — never rely on being "the only test" creating a given row.
- `npx tsc --noEmit` must stay clean after every task.
- `vitest.config.ts` already has `testTimeout: 20000` — no config changes needed.
- Grant `SELECT, INSERT, UPDATE, DELETE` to `app_runtime` on every new table, matching the existing migrations' pattern exactly.
- No table-name collisions with existing tables: `tenant`, `app_user`, `contact`, `pipeline_stage`, `deal`, `tenant_erp_settings`, `vendor`, `product`, `document_sequence`, `location`, `stock_move`, `purchase_order`, `purchase_order_line`, `bill_of_materials`, `bom_component`, `work_center`, `routing`, `operation`, `manufacturing_order`, `work_order`, `project`, `task`, `time_entry`, `sales_order`, `sales_order_line`, `invoice`, `invoice_line`, `payment`, `payment_allocation`.
- Next migration number is `0026` (existing: 0001–0025 in `db/migrations/`).

---

### Task 1: `recurring_template` Table and Data-Access Layer

**Files:**
- Create: `db/migrations/0026_recurring_template.sql`
- Create: `lib/erp/recurring-templates.ts`
- Test: `lib/erp/__tests__/recurring-templates.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`.
- Produces: `RecurringTemplateType` type (`'scheduled' | 'reminder' | 'unscheduled'`); `IntervalUnit` type (`'weeks' | 'months' | 'years'`); `ApprovalState` type (`'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn'`); `RecurringTemplate` interface (`id: string`, `tenantId: string`, `documentType: string`, `intervalUnit: IntervalUnit`, `intervalCount: number`, `nextRunDate: string`, `type: RecurringTemplateType`, `approvalState: ApprovalState`, `isActive: boolean`, `createdAt: Date`, `updatedAt: Date`); `NewRecurringTemplate` interface (`documentType: string`, `intervalUnit: IntervalUnit`, `intervalCount: number`, `nextRunDate: string`, `type: RecurringTemplateType`); `createRecurringTemplate(tenantId: string, input: NewRecurringTemplate): Promise<RecurringTemplate>` (no FK to validate — this table has no foreign keys); `getRecurringTemplate(tenantId: string, id: string): Promise<RecurringTemplate | null>`; `listRecurringTemplates(tenantId: string): Promise<RecurringTemplate[]>`; `deactivateRecurringTemplate(tenantId: string, id: string): Promise<RecurringTemplate | null>` (atomic `UPDATE...WHERE is_active=true RETURNING *`, sets `is_active=false`, returns `null` if already inactive). Task 2 (`plan`) consumes `getRecurringTemplate` to validate `recurringTemplateId`.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0026_recurring_template.sql
CREATE TYPE recurring_template_type AS ENUM ('scheduled', 'reminder', 'unscheduled');
CREATE TYPE interval_unit AS ENUM ('weeks', 'months', 'years');

-- Generalizes beyond subscriptions, per research §4.3: QuickBooks applies
-- recurring templates to transactions generally (recurring bills,
-- recurring journal entries, recurring POs), not only subscription
-- invoices -- this is why document_type is a free-text field naming
-- WHICH document this template would generate (e.g. 'invoice',
-- 'sales_order'), not a foreign key into any one document table. This
-- plan does not build the scheduler that reads next_run_date and
-- actually generates a document -- see this plan's Global Constraints.
--
-- type is the three-way "AI acts / AI proposes / human keeps it manual"
-- gradient from the research: 'scheduled' = fully automatic generation,
-- 'reminder' = human-prompted generation, 'unscheduled' = saved-but-
-- dormant draft. approval_state (shared enum) is independent of type --
-- a scheduled template can still require approval before its next
-- generated document goes out, matching this project's established
-- two-independent-axes pattern (e.g. purchase_order's approval_state
-- vs status).
--
-- interval_unit + interval_count together express "every N units" (e.g.
-- interval_unit='months', interval_count=3 means quarterly) -- per
-- research §4.1's explicit "billing period is a unit + numeric value
-- pair, not an enum of monthly/quarterly/annual" finding (Odoo's
-- pattern).
CREATE TABLE recurring_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  document_type text NOT NULL,
  interval_unit interval_unit NOT NULL,
  interval_count integer NOT NULL CHECK (interval_count > 0),
  next_run_date date NOT NULL,
  type recurring_template_type NOT NULL,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recurring_template_tenant_id_idx ON recurring_template (tenant_id, id);
CREATE INDEX recurring_template_tenant_active_idx ON recurring_template (tenant_id, is_active);

ALTER TABLE recurring_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_template FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_template
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON recurring_template TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/recurring-templates.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createRecurringTemplate, getRecurringTemplate, listRecurringTemplates, deactivateRecurringTemplate } from '../recurring-templates';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('recurring template data access', () => {
  it('creates a recurring template and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('RecTemplate Test Tenant 1') RETURNING id`;

    const template = await createRecurringTemplate(tenant.id, {
      documentType: 'invoice',
      intervalUnit: 'months',
      intervalCount: 3,
      nextRunDate: '2026-12-01',
      type: 'scheduled',
    });

    expect(template.documentType).toBe('invoice');
    expect(template.intervalUnit).toBe('months');
    expect(template.intervalCount).toBe(3);
    expect(template.isActive).toBe(true);
    expect(template.approvalState).toBe('draft');

    const fetched = await getRecurringTemplate(tenant.id, template.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.type).toBe('scheduled');
  });

  it('listRecurringTemplates returns only this tenant\'s templates', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('RecTemplate Test Tenant 2A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('RecTemplate Test Tenant 2B') RETURNING id`;

    await createRecurringTemplate(tenantA.id, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });
    await createRecurringTemplate(tenantB.id, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });

    const templatesA = await listRecurringTemplates(tenantA.id);
    expect(templatesA).toHaveLength(1);
  });

  it('deactivateRecurringTemplate moves is_active from true to false, and returns null on a second attempt', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('RecTemplate Test Tenant 3') RETURNING id`;
    const template = await createRecurringTemplate(tenant.id, { documentType: 'sales_order', intervalUnit: 'weeks', intervalCount: 2, nextRunDate: '2026-09-20', type: 'unscheduled' });

    const deactivated = await deactivateRecurringTemplate(tenant.id, template.id);
    expect(deactivated).not.toBeNull();
    expect(deactivated!.isActive).toBe(false);

    const secondAttempt = await deactivateRecurringTemplate(tenant.id, template.id);
    expect(secondAttempt).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/recurring-templates.test.ts`
Expected: FAIL — `lib/erp/recurring-templates.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/recurring-templates.ts
import { withTenant } from '../db/with-tenant';

export type RecurringTemplateType = 'scheduled' | 'reminder' | 'unscheduled';
export type IntervalUnit = 'weeks' | 'months' | 'years';
export type ApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn';

export interface RecurringTemplate {
  id: string;
  tenantId: string;
  documentType: string;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  nextRunDate: string;
  type: RecurringTemplateType;
  approvalState: ApprovalState;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewRecurringTemplate {
  documentType: string;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  nextRunDate: string;
  type: RecurringTemplateType;
}

function rowToRecurringTemplate(row: any): RecurringTemplate {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    documentType: row.document_type,
    intervalUnit: row.interval_unit,
    intervalCount: Number(row.interval_count),
    nextRunDate: row.next_run_date instanceof Date ? row.next_run_date.toISOString().slice(0, 10) : row.next_run_date,
    type: row.type,
    approvalState: row.approval_state,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createRecurringTemplate(tenantId: string, input: NewRecurringTemplate): Promise<RecurringTemplate> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO recurring_template (tenant_id, document_type, interval_unit, interval_count, next_run_date, type)
      VALUES (${tenantId}, ${input.documentType}, ${input.intervalUnit}, ${input.intervalCount}, ${input.nextRunDate}, ${input.type})
      RETURNING *
    `;
    return rowToRecurringTemplate(row);
  });
}

export async function getRecurringTemplate(tenantId: string, id: string): Promise<RecurringTemplate | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM recurring_template WHERE id = ${id}`;
    return rows.length > 0 ? rowToRecurringTemplate(rows[0]) : null;
  });
}

export async function listRecurringTemplates(tenantId: string): Promise<RecurringTemplate[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM recurring_template ORDER BY created_at DESC`;
    return rows.map(rowToRecurringTemplate);
  });
}

export async function deactivateRecurringTemplate(tenantId: string, id: string): Promise<RecurringTemplate | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE recurring_template
      SET is_active = false, updated_at = now()
      WHERE id = ${id} AND is_active = true
      RETURNING *
    `;
    return rows.length > 0 ? rowToRecurringTemplate(rows[0]) : null;
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/recurring-templates.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0026_recurring_template.sql lib/erp/recurring-templates.ts lib/erp/__tests__/recurring-templates.test.ts
git commit -m "feat: add recurring_template core entity

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `plan` and `subscription` Tables and Data-Access Layer

**Files:**
- Create: `db/migrations/0027_plan.sql`
- Create: `db/migrations/0028_subscription.sql`
- Create: `lib/erp/plans.ts`
- Create: `lib/erp/subscriptions.ts`
- Test: `lib/erp/__tests__/plans.test.ts`
- Test: `lib/erp/__tests__/subscriptions.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`; `getRecurringTemplate(tenantId: string, id: string): Promise<RecurringTemplate | null>` from `lib/erp/recurring-templates.ts` (Task 1); `getContact(tenantId: string, id: string): Promise<Contact | null>` from `lib/crm/contacts.ts`.
- Produces (`plans.ts`): `Plan` interface (`id: string`, `tenantId: string`, `name: string`, `priceMinorUnits: number`, `currencyCode: string`, `recurringTemplateId: string`, `createdAt: Date`, `updatedAt: Date`); `NewPlan` interface (`name: string`, `priceMinorUnits: number`, `currencyCode: string`, `recurringTemplateId: string`); `createPlan(tenantId: string, input: NewPlan): Promise<Plan>` (validates `recurringTemplateId` via `getRecurringTemplate`, throws if it doesn't belong to the tenant); `getPlan(tenantId: string, id: string): Promise<Plan | null>`; `listPlans(tenantId: string): Promise<Plan[]>`.
- Produces (`subscriptions.ts`): `SubscriptionStatus` type (`'active' | 'paused' | 'cancelled'`); `Subscription` interface (`id: string`, `tenantId: string`, `contactId: string`, `planId: string`, `status: SubscriptionStatus`, `anchorDate: string`, `approvalState: ApprovalState`, `createdAt: Date`, `updatedAt: Date`); `NewSubscription` interface (`contactId: string`, `planId: string`, `anchorDate: string`); `createSubscription(tenantId: string, input: NewSubscription): Promise<Subscription>` (validates `contactId` via `getContact` and `planId` via `getPlan` from Task 2's own `plans.ts`, throws on either cross-tenant mismatch); `getSubscription(tenantId: string, id: string): Promise<Subscription | null>`; `pauseSubscription(tenantId: string, id: string): Promise<Subscription | null>` (atomic `UPDATE...WHERE status='active' RETURNING *`); `cancelSubscription(tenantId: string, id: string): Promise<Subscription | null>` (atomic `UPDATE...WHERE status IN ('active','paused') RETURNING *`); `reactivateSubscription(tenantId: string, id: string): Promise<Subscription | null>` (atomic `UPDATE...WHERE status='paused' RETURNING *` — a cancelled subscription cannot be reactivated through this function). Task 3 (`subscription_change_event`, `usage_record`) consumes `getSubscription` and `getPlan` to validate FKs.

- [ ] **Step 1: Write the migrations**

```sql
-- db/migrations/0027_plan.sql
-- Per research §4.1: "Plan is separate from subscription" (Zoho Billing
-- models Plans in a product catalog, Subscriptions as customer-bound
-- instances). recurring_template_id gives the plan its billing cadence
-- via the generic core entity from Task 1 -- the plan does not carry
-- its own interval_unit/interval_count fields, since that would
-- duplicate what recurring_template already models.
CREATE TABLE plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  price_minor_units bigint NOT NULL,
  currency_code text NOT NULL,
  recurring_template_id uuid NOT NULL REFERENCES recurring_template(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX plan_tenant_id_idx ON plan (tenant_id, id);

ALTER TABLE plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plan
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON plan TO app_runtime;
```

```sql
-- db/migrations/0028_subscription.sql
CREATE TYPE subscription_status AS ENUM ('active', 'paused', 'cancelled');

-- contact_id reuses the existing CRM contact table per this project's
-- established "one record, not duplicated per module" principle (same
-- as project.contact_id from Phase 3A-4, sales_order.contact_id and
-- payment.contact_id from Phase 3A-5).
--
-- Two independent state axes, per this project's now-established
-- pattern (purchase_order's approval_state vs status; time_entry's
-- three independent booleans): approval_state (was cancelling this
-- subscription approved? -- per research's explicit approval-gate note,
-- cancelling a subscription is an irreversible external action) vs
-- status (is it currently active/paused/cancelled?). anchor_date is the
-- date the subscription started, used to compute billing cycles
-- (billing-cycle computation itself is future scope, not this plan).
CREATE TABLE subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contact_id uuid NOT NULL REFERENCES contact(id),
  plan_id uuid NOT NULL REFERENCES plan(id),
  status subscription_status NOT NULL DEFAULT 'active',
  anchor_date date NOT NULL,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_tenant_id_idx ON subscription (tenant_id, id);
CREATE INDEX subscription_tenant_contact_idx ON subscription (tenant_id, contact_id);
CREATE INDEX subscription_tenant_plan_idx ON subscription (tenant_id, plan_id);

ALTER TABLE subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON subscription TO app_runtime;
```

- [ ] **Step 2: Write the failing tests**

```typescript
// lib/erp/__tests__/plans.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createPlan, getPlan, listPlans } from '../plans';
import { createRecurringTemplate } from '../recurring-templates';

const ownerSql = postgres(process.env.DATABASE_URL!);

async function setupTemplate(tenantId: string) {
  return createRecurringTemplate(tenantId, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });
}

describe('plan data access', () => {
  it('creates a plan and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Plan Test Tenant 1') RETURNING id`;
    const template = await setupTemplate(tenant.id);

    const plan = await createPlan(tenant.id, {
      name: 'Pro Monthly',
      priceMinorUnits: 2900,
      currencyCode: 'USD',
      recurringTemplateId: template.id,
    });

    expect(plan.name).toBe('Pro Monthly');
    expect(plan.recurringTemplateId).toBe(template.id);

    const fetched = await getPlan(tenant.id, plan.id);
    expect(fetched).not.toBeNull();
  });

  it('rejects a recurringTemplateId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Plan Test Tenant 2A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Plan Test Tenant 2B') RETURNING id`;
    const templateB = await setupTemplate(tenantB.id);

    await expect(
      createPlan(tenantA.id, { name: 'Should Fail', priceMinorUnits: 100, currencyCode: 'USD', recurringTemplateId: templateB.id }),
    ).rejects.toThrow();

    const plansA = await listPlans(tenantA.id);
    expect(plansA).toHaveLength(0);
  });
});
```

```typescript
// lib/erp/__tests__/subscriptions.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createSubscription, getSubscription, pauseSubscription, cancelSubscription, reactivateSubscription } from '../subscriptions';
import { createPlan } from '../plans';
import { createRecurringTemplate } from '../recurring-templates';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

async function setupPlan(tenantId: string) {
  const template = await createRecurringTemplate(tenantId, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });
  return createPlan(tenantId, { name: 'Pro Monthly', priceMinorUnits: 2900, currencyCode: 'USD', recurringTemplateId: template.id });
}

describe('subscription data access', () => {
  it('creates a subscription and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Subscription Test Tenant 1') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Subscriber' });
    const plan = await setupPlan(tenant.id);

    const subscription = await createSubscription(tenant.id, { contactId: contact.id, planId: plan.id, anchorDate: '2026-09-06' });

    expect(subscription.contactId).toBe(contact.id);
    expect(subscription.status).toBe('active');
    expect(subscription.approvalState).toBe('draft');

    const fetched = await getSubscription(tenant.id, subscription.id);
    expect(fetched).not.toBeNull();
  });

  it('rejects a contactId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Subscription Test Tenant 2A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Subscription Test Tenant 2B') RETURNING id`;
    const contactB = await createContact(tenantB.id, { fullName: 'Tenant B Subscriber' });
    const planA = await setupPlan(tenantA.id);

    await expect(
      createSubscription(tenantA.id, { contactId: contactB.id, planId: planA.id, anchorDate: '2026-09-06' }),
    ).rejects.toThrow();
  });

  it('rejects a planId belonging to another tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Subscription Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Subscription Test Tenant 3B') RETURNING id`;
    const contactA = await createContact(tenantA.id, { fullName: 'Subscriber' });
    const planB = await setupPlan(tenantB.id);

    await expect(
      createSubscription(tenantA.id, { contactId: contactA.id, planId: planB.id, anchorDate: '2026-09-06' }),
    ).rejects.toThrow();
  });

  it('pause -> reactivate -> cancel transitions work, and each guard rejects the wrong prior state', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Subscription Test Tenant 4') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Subscriber' });
    const plan = await setupPlan(tenant.id);
    const subscription = await createSubscription(tenant.id, { contactId: contact.id, planId: plan.id, anchorDate: '2026-09-06' });

    // active -> paused
    const paused = await pauseSubscription(tenant.id, subscription.id);
    expect(paused).not.toBeNull();
    expect(paused!.status).toBe('paused');

    // already paused -- second pause attempt returns null
    const secondPause = await pauseSubscription(tenant.id, subscription.id);
    expect(secondPause).toBeNull();

    // paused -> active
    const reactivated = await reactivateSubscription(tenant.id, subscription.id);
    expect(reactivated).not.toBeNull();
    expect(reactivated!.status).toBe('active');

    // active -> cancelled
    const cancelled = await cancelSubscription(tenant.id, subscription.id);
    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe('cancelled');

    // cancelled subscription cannot be reactivated
    const reactivateAfterCancel = await reactivateSubscription(tenant.id, subscription.id);
    expect(reactivateAfterCancel).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/erp/__tests__/plans.test.ts lib/erp/__tests__/subscriptions.test.ts`
Expected: FAIL — `lib/erp/plans.ts` and `lib/erp/subscriptions.ts` do not exist yet.

- [ ] **Step 4: Write the implementations**

```typescript
// lib/erp/plans.ts
import { withTenant } from '../db/with-tenant';
import { getRecurringTemplate } from './recurring-templates';

export interface Plan {
  id: string;
  tenantId: string;
  name: string;
  priceMinorUnits: number;
  currencyCode: string;
  recurringTemplateId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewPlan {
  name: string;
  priceMinorUnits: number;
  currencyCode: string;
  recurringTemplateId: string;
}

function rowToPlan(row: any): Plan {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    priceMinorUnits: Number(row.price_minor_units),
    currencyCode: row.currency_code,
    recurringTemplateId: row.recurring_template_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createPlan(tenantId: string, input: NewPlan): Promise<Plan> {
  const template = await getRecurringTemplate(tenantId, input.recurringTemplateId);
  if (!template) {
    throw new Error(`Invalid recurring template reference: ${input.recurringTemplateId} does not belong to this tenant`);
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO plan (tenant_id, name, price_minor_units, currency_code, recurring_template_id)
      VALUES (${tenantId}, ${input.name}, ${input.priceMinorUnits}, ${input.currencyCode}, ${input.recurringTemplateId})
      RETURNING *
    `;
    return rowToPlan(row);
  });
}

export async function getPlan(tenantId: string, id: string): Promise<Plan | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM plan WHERE id = ${id}`;
    return rows.length > 0 ? rowToPlan(rows[0]) : null;
  });
}

export async function listPlans(tenantId: string): Promise<Plan[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM plan ORDER BY created_at DESC`;
    return rows.map(rowToPlan);
  });
}
```

```typescript
// lib/erp/subscriptions.ts
import { withTenant } from '../db/with-tenant';
import { getContact } from '../crm/contacts';
import { getPlan } from './plans';

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';
export type ApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn';

export interface Subscription {
  id: string;
  tenantId: string;
  contactId: string;
  planId: string;
  status: SubscriptionStatus;
  anchorDate: string;
  approvalState: ApprovalState;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSubscription {
  contactId: string;
  planId: string;
  anchorDate: string;
}

function rowToSubscription(row: any): Subscription {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    planId: row.plan_id,
    status: row.status,
    anchorDate: row.anchor_date instanceof Date ? row.anchor_date.toISOString().slice(0, 10) : row.anchor_date,
    approvalState: row.approval_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createSubscription(tenantId: string, input: NewSubscription): Promise<Subscription> {
  const contact = await getContact(tenantId, input.contactId);
  if (!contact) {
    throw new Error(`Invalid contact reference: ${input.contactId} does not belong to this tenant`);
  }
  const plan = await getPlan(tenantId, input.planId);
  if (!plan) {
    throw new Error(`Invalid plan reference: ${input.planId} does not belong to this tenant`);
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO subscription (tenant_id, contact_id, plan_id, anchor_date)
      VALUES (${tenantId}, ${input.contactId}, ${input.planId}, ${input.anchorDate})
      RETURNING *
    `;
    return rowToSubscription(row);
  });
}

export async function getSubscription(tenantId: string, id: string): Promise<Subscription | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM subscription WHERE id = ${id}`;
    return rows.length > 0 ? rowToSubscription(rows[0]) : null;
  });
}

export async function pauseSubscription(tenantId: string, id: string): Promise<Subscription | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE subscription
      SET status = 'paused', updated_at = now()
      WHERE id = ${id} AND status = 'active'
      RETURNING *
    `;
    return rows.length > 0 ? rowToSubscription(rows[0]) : null;
  });
}

export async function cancelSubscription(tenantId: string, id: string): Promise<Subscription | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE subscription
      SET status = 'cancelled', updated_at = now()
      WHERE id = ${id} AND status IN ('active', 'paused')
      RETURNING *
    `;
    return rows.length > 0 ? rowToSubscription(rows[0]) : null;
  });
}

export async function reactivateSubscription(tenantId: string, id: string): Promise<Subscription | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE subscription
      SET status = 'active', updated_at = now()
      WHERE id = ${id} AND status = 'paused'
      RETURNING *
    `;
    return rows.length > 0 ? rowToSubscription(rows[0]) : null;
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/erp/__tests__/plans.test.ts lib/erp/__tests__/subscriptions.test.ts`
Expected: PASS (2/2 plans tests, 4/4 subscriptions tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0027_plan.sql db/migrations/0028_subscription.sql lib/erp/plans.ts lib/erp/subscriptions.ts lib/erp/__tests__/plans.test.ts lib/erp/__tests__/subscriptions.test.ts
git commit -m "feat: add plan and subscription tables with FK-ownership validation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `subscription_change_event` and `usage_record` Tables and Data-Access Layer

**Files:**
- Create: `db/migrations/0029_subscription_change_event.sql`
- Create: `db/migrations/0030_usage_record.sql`
- Create: `lib/erp/subscription-change-events.ts`
- Create: `lib/erp/usage-records.ts`
- Test: `lib/erp/__tests__/subscription-change-events.test.ts`
- Test: `lib/erp/__tests__/usage-records.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`; `getSubscription(tenantId: string, id: string): Promise<Subscription | null>` from `lib/erp/subscriptions.ts` (Task 2); `getPlan(tenantId: string, id: string): Promise<Plan | null>` from `lib/erp/plans.ts` (Task 2).
- Produces (`subscription-change-events.ts`): `SubscriptionChangeEventType` type (`'upgrade' | 'downgrade' | 'cancellation' | 'reactivation'`); `SubscriptionChangeEvent` interface (`id: string`, `tenantId: string`, `subscriptionId: string`, `eventType: SubscriptionChangeEventType`, `effectiveDate: string`, `previousPlanId: string | null`, `newPlanId: string | null`, `createdAt: Date`); `NewSubscriptionChangeEvent` interface (`subscriptionId: string`, `eventType: SubscriptionChangeEventType`, `effectiveDate: string`, `previousPlanId?: string`, `newPlanId?: string`); `recordSubscriptionChangeEvent(tenantId: string, input: NewSubscriptionChangeEvent): Promise<SubscriptionChangeEvent>` (validates `subscriptionId` via `getSubscription`; validates `previousPlanId`/`newPlanId` via `getPlan` ONLY when each is given — both are optional since e.g. a `'cancellation'` event has neither; insert-only, no update/delete function ever, matching `stock_move`'s append-only-ledger precedent); `listSubscriptionChangeEvents(tenantId: string, subscriptionId: string): Promise<SubscriptionChangeEvent[]>`.
- Produces (`usage-records.ts`): `UsageRecord` interface (`id: string`, `tenantId: string`, `subscriptionId: string`, `quantity: number`, `recordedAt: Date`, `description: string | null`); `NewUsageRecord` interface (`subscriptionId: string`, `quantity: number`, `recordedAt: string`, `description?: string`); `recordUsage(tenantId: string, input: NewUsageRecord): Promise<UsageRecord>` (validates `subscriptionId` via `getSubscription`; insert-only, same append-only convention); `listUsageRecords(tenantId: string, subscriptionId: string): Promise<UsageRecord[]>`; `getTotalUsage(tenantId: string, subscriptionId: string): Promise<number>` (sums `quantity` across all usage records for the subscription — mirrors `getStockOnHand`'s derived-sum-at-query-time pattern from `lib/erp/stock.ts`; aggregation-at-cycle-close is explicitly future scope, this is just a raw running total).

- [ ] **Step 1: Write the migrations**

```sql
-- db/migrations/0029_subscription_change_event.sql
-- Append-only ledger, matching stock_move's precedent exactly (design
-- spec §3 point 2's explicit principle: "subscription proration is
-- never computed by editing a subscription row -- it's recorded on a
-- subscription_change_event row at the moment of the change"). No
-- update/delete function will ever exist for this table -- if a mistake
-- needs correcting, a new compensating event is recorded, the existing
-- one is never edited.
--
-- previous_plan_id / new_plan_id are BOTH nullable: an 'upgrade' or
-- 'downgrade' event has both (moving from one plan to another); a
-- 'cancellation' or 'reactivation' event may have neither, since those
-- are subscription-lifecycle events, not necessarily plan changes.
CREATE TYPE subscription_change_event_type AS ENUM ('upgrade', 'downgrade', 'cancellation', 'reactivation');

CREATE TABLE subscription_change_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  subscription_id uuid NOT NULL REFERENCES subscription(id),
  event_type subscription_change_event_type NOT NULL,
  effective_date date NOT NULL,
  previous_plan_id uuid REFERENCES plan(id),
  new_plan_id uuid REFERENCES plan(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_change_event_tenant_sub_idx ON subscription_change_event (tenant_id, subscription_id);

ALTER TABLE subscription_change_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_change_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription_change_event
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_change_event TO app_runtime;
```

```sql
-- db/migrations/0030_usage_record.sql
-- Append-only event stream, per research §4.3's explicit framing:
-- "usage records are an append-only event stream, aggregated at cycle
-- close." This migration ships the raw event log only -- aggregation
-- into a billed quantity per cycle, and translating usage into a bill
-- via metered/tiered/overage pricing, are both explicitly future scope
-- (see this plan's Global Constraints out-of-scope list).
CREATE TABLE usage_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  subscription_id uuid NOT NULL REFERENCES subscription(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  recorded_at timestamptz NOT NULL,
  description text
);

CREATE INDEX usage_record_tenant_sub_idx ON usage_record (tenant_id, subscription_id);

ALTER TABLE usage_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_record FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON usage_record
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON usage_record TO app_runtime;
```

- [ ] **Step 2: Write the failing tests**

```typescript
// lib/erp/__tests__/subscription-change-events.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { recordSubscriptionChangeEvent, listSubscriptionChangeEvents } from '../subscription-change-events';
import { createSubscription } from '../subscriptions';
import { createPlan } from '../plans';
import { createRecurringTemplate } from '../recurring-templates';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

async function setupSubscription(tenantId: string) {
  const contact = await createContact(tenantId, { fullName: 'Subscriber' });
  const template = await createRecurringTemplate(tenantId, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });
  const plan = await createPlan(tenantId, { name: 'Pro Monthly', priceMinorUnits: 2900, currencyCode: 'USD', recurringTemplateId: template.id });
  const subscription = await createSubscription(tenantId, { contactId: contact.id, planId: plan.id, anchorDate: '2026-09-06' });
  return { subscription, plan };
}

describe('subscription change event data access', () => {
  it('records an upgrade event with both plan references and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('ChangeEvent Test Tenant 1') RETURNING id`;
    const { subscription, plan: oldPlan } = await setupSubscription(tenant.id);
    const template2 = await createRecurringTemplate(tenant.id, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });
    const newPlan = await createPlan(tenant.id, { name: 'Enterprise Monthly', priceMinorUnits: 9900, currencyCode: 'USD', recurringTemplateId: template2.id });

    const event = await recordSubscriptionChangeEvent(tenant.id, {
      subscriptionId: subscription.id,
      eventType: 'upgrade',
      effectiveDate: '2026-09-10',
      previousPlanId: oldPlan.id,
      newPlanId: newPlan.id,
    });

    expect(event.eventType).toBe('upgrade');
    expect(event.previousPlanId).toBe(oldPlan.id);
    expect(event.newPlanId).toBe(newPlan.id);

    const events = await listSubscriptionChangeEvents(tenant.id, subscription.id);
    expect(events).toHaveLength(1);
  });

  it('records a cancellation event with neither plan reference', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('ChangeEvent Test Tenant 2') RETURNING id`;
    const { subscription } = await setupSubscription(tenant.id);

    const event = await recordSubscriptionChangeEvent(tenant.id, {
      subscriptionId: subscription.id,
      eventType: 'cancellation',
      effectiveDate: '2026-09-15',
    });

    expect(event.previousPlanId).toBeNull();
    expect(event.newPlanId).toBeNull();
  });

  it('rejects a subscriptionId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('ChangeEvent Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('ChangeEvent Test Tenant 3B') RETURNING id`;
    const { subscription: subscriptionB } = await setupSubscription(tenantB.id);

    await expect(
      recordSubscriptionChangeEvent(tenantA.id, { subscriptionId: subscriptionB.id, eventType: 'cancellation', effectiveDate: '2026-09-15' }),
    ).rejects.toThrow();
  });

  it('rejects a newPlanId belonging to another tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('ChangeEvent Test Tenant 4A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('ChangeEvent Test Tenant 4B') RETURNING id`;
    const { subscription: subscriptionA } = await setupSubscription(tenantA.id);
    const { plan: planB } = await setupSubscription(tenantB.id);

    await expect(
      recordSubscriptionChangeEvent(tenantA.id, { subscriptionId: subscriptionA.id, eventType: 'upgrade', effectiveDate: '2026-09-15', newPlanId: planB.id }),
    ).rejects.toThrow();
  });
});
```

```typescript
// lib/erp/__tests__/usage-records.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { recordUsage, listUsageRecords, getTotalUsage } from '../usage-records';
import { createSubscription } from '../subscriptions';
import { createPlan } from '../plans';
import { createRecurringTemplate } from '../recurring-templates';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

async function setupSubscription(tenantId: string) {
  const contact = await createContact(tenantId, { fullName: 'Subscriber' });
  const template = await createRecurringTemplate(tenantId, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });
  const plan = await createPlan(tenantId, { name: 'Metered Plan', priceMinorUnits: 0, currencyCode: 'USD', recurringTemplateId: template.id });
  return createSubscription(tenantId, { contactId: contact.id, planId: plan.id, anchorDate: '2026-09-06' });
}

describe('usage record data access', () => {
  it('records usage and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('UsageRecord Test Tenant 1') RETURNING id`;
    const subscription = await setupSubscription(tenant.id);

    const record = await recordUsage(tenant.id, {
      subscriptionId: subscription.id,
      quantity: 150,
      recordedAt: '2026-09-06T12:00:00.000Z',
      description: 'API calls',
    });

    expect(record.quantity).toBe(150);

    const records = await listUsageRecords(tenant.id, subscription.id);
    expect(records).toHaveLength(1);
  });

  it('getTotalUsage sums quantity across all usage records for a subscription', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('UsageRecord Test Tenant 2') RETURNING id`;
    const subscription = await setupSubscription(tenant.id);

    await recordUsage(tenant.id, { subscriptionId: subscription.id, quantity: 100, recordedAt: '2026-09-01T00:00:00.000Z' });
    await recordUsage(tenant.id, { subscriptionId: subscription.id, quantity: 50, recordedAt: '2026-09-02T00:00:00.000Z' });

    const total = await getTotalUsage(tenant.id, subscription.id);
    expect(total).toBe(150);
  });

  it('rejects a subscriptionId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('UsageRecord Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('UsageRecord Test Tenant 3B') RETURNING id`;
    const subscriptionB = await setupSubscription(tenantB.id);

    await expect(
      recordUsage(tenantA.id, { subscriptionId: subscriptionB.id, quantity: 10, recordedAt: '2026-09-06T00:00:00.000Z' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/erp/__tests__/subscription-change-events.test.ts lib/erp/__tests__/usage-records.test.ts`
Expected: FAIL — `lib/erp/subscription-change-events.ts` and `lib/erp/usage-records.ts` do not exist yet.

- [ ] **Step 4: Write the implementations**

```typescript
// lib/erp/subscription-change-events.ts
import { withTenant } from '../db/with-tenant';
import { getSubscription } from './subscriptions';
import { getPlan } from './plans';

export type SubscriptionChangeEventType = 'upgrade' | 'downgrade' | 'cancellation' | 'reactivation';

export interface SubscriptionChangeEvent {
  id: string;
  tenantId: string;
  subscriptionId: string;
  eventType: SubscriptionChangeEventType;
  effectiveDate: string;
  previousPlanId: string | null;
  newPlanId: string | null;
  createdAt: Date;
}

export interface NewSubscriptionChangeEvent {
  subscriptionId: string;
  eventType: SubscriptionChangeEventType;
  effectiveDate: string;
  previousPlanId?: string;
  newPlanId?: string;
}

function rowToSubscriptionChangeEvent(row: any): SubscriptionChangeEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subscriptionId: row.subscription_id,
    eventType: row.event_type,
    effectiveDate: row.effective_date instanceof Date ? row.effective_date.toISOString().slice(0, 10) : row.effective_date,
    previousPlanId: row.previous_plan_id,
    newPlanId: row.new_plan_id,
    createdAt: row.created_at,
  };
}

export async function recordSubscriptionChangeEvent(
  tenantId: string,
  input: NewSubscriptionChangeEvent,
): Promise<SubscriptionChangeEvent> {
  const subscription = await getSubscription(tenantId, input.subscriptionId);
  if (!subscription) {
    throw new Error(`Invalid subscription reference: ${input.subscriptionId} does not belong to this tenant`);
  }
  if (input.previousPlanId) {
    const previousPlan = await getPlan(tenantId, input.previousPlanId);
    if (!previousPlan) {
      throw new Error(`Invalid previous plan reference: ${input.previousPlanId} does not belong to this tenant`);
    }
  }
  if (input.newPlanId) {
    const newPlan = await getPlan(tenantId, input.newPlanId);
    if (!newPlan) {
      throw new Error(`Invalid new plan reference: ${input.newPlanId} does not belong to this tenant`);
    }
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO subscription_change_event (tenant_id, subscription_id, event_type, effective_date, previous_plan_id, new_plan_id)
      VALUES (${tenantId}, ${input.subscriptionId}, ${input.eventType}, ${input.effectiveDate}, ${input.previousPlanId ?? null}, ${input.newPlanId ?? null})
      RETURNING *
    `;
    return rowToSubscriptionChangeEvent(row);
  });
}

export async function listSubscriptionChangeEvents(tenantId: string, subscriptionId: string): Promise<SubscriptionChangeEvent[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM subscription_change_event WHERE subscription_id = ${subscriptionId} ORDER BY created_at ASC`;
    return rows.map(rowToSubscriptionChangeEvent);
  });
}
```

```typescript
// lib/erp/usage-records.ts
import { withTenant } from '../db/with-tenant';
import { getSubscription } from './subscriptions';

export interface UsageRecord {
  id: string;
  tenantId: string;
  subscriptionId: string;
  quantity: number;
  recordedAt: Date;
  description: string | null;
}

export interface NewUsageRecord {
  subscriptionId: string;
  quantity: number;
  recordedAt: string;
  description?: string;
}

function rowToUsageRecord(row: any): UsageRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subscriptionId: row.subscription_id,
    quantity: Number(row.quantity),
    recordedAt: row.recorded_at,
    description: row.description,
  };
}

export async function recordUsage(tenantId: string, input: NewUsageRecord): Promise<UsageRecord> {
  const subscription = await getSubscription(tenantId, input.subscriptionId);
  if (!subscription) {
    throw new Error(`Invalid subscription reference: ${input.subscriptionId} does not belong to this tenant`);
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO usage_record (tenant_id, subscription_id, quantity, recorded_at, description)
      VALUES (${tenantId}, ${input.subscriptionId}, ${input.quantity}, ${input.recordedAt}, ${input.description ?? null})
      RETURNING *
    `;
    return rowToUsageRecord(row);
  });
}

export async function listUsageRecords(tenantId: string, subscriptionId: string): Promise<UsageRecord[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM usage_record WHERE subscription_id = ${subscriptionId} ORDER BY recorded_at ASC`;
    return rows.map(rowToUsageRecord);
  });
}

export async function getTotalUsage(tenantId: string, subscriptionId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT COALESCE(SUM(quantity), 0) as total FROM usage_record WHERE subscription_id = ${subscriptionId}`;
    return Number(rows[0].total);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/erp/__tests__/subscription-change-events.test.ts lib/erp/__tests__/usage-records.test.ts`
Expected: PASS (4/4 subscription-change-events tests, 3/3 usage-records tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0029_subscription_change_event.sql db/migrations/0030_usage_record.sql lib/erp/subscription-change-events.ts lib/erp/usage-records.ts lib/erp/__tests__/subscription-change-events.test.ts lib/erp/__tests__/usage-records.test.ts
git commit -m "feat: add subscription_change_event and usage_record append-only ledgers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Full-Suite Verification

**Files:** none created or modified — verification only.

**Interfaces:** N/A.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every existing test (all prior phases, unchanged) plus all new `lib/erp/__tests__/{recurring-templates,plans,subscriptions,subscription-change-events,usage-records}.test.ts` files and the RLS audit test (now covering 5 additional tables: `recurring_template`, `plan`, `subscription`, `subscription_change_event`, `usage_record`) pass with zero failures.

- [ ] **Step 2: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify no table-name or migration-number collisions**

Run: `ls db/migrations/*.sql`
Expected: exactly 30 files, numbered 0001 through 0030 with no gaps or duplicates, and the five new ones (0026–0030) match the table names in this plan (`recurring_template`, `plan`, `subscription`, `subscription_change_event`, `usage_record`) with no collision against any existing table.

- [ ] **Step 4: Commit (only if Steps 1–2 required any fixes)**

```bash
git add -A
git commit -m "chore: verify phase 3a-6 full suite and type check

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

If Steps 1–2 pass with no changes needed, skip this commit — there's nothing new to commit.
