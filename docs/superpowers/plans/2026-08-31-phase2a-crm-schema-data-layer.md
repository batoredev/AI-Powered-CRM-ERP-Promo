# Phase 2A: CRM Schema + Data Access Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `contact`, `deal`, and `pipeline_stage` tables (all tenant-scoped, forced RLS, following Phase 1A's proven pattern), plus a typed TypeScript data-access layer and the CRM tool contract the future AI agent will consume in Phase 5 — all server-side, no UI.

**Architecture:** Three new host-core tables (§6.0 of the design spec — not plugin-owned), each following the exact `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy pattern established in `db/migrations/0002_tenant_user_role.sql`. All access goes through `withTenant()` (Phase 1A's chokepoint) — no new bypass paths. A typed repository module (`lib/crm/contacts.ts`, `lib/crm/deals.ts`) wraps raw SQL in typed functions; a separate `lib/crm/tool-contract.ts` defines the JSON-schema tool definitions the AI agent runtime will register in Phase 5, so that phase isn't guessing at an interface.

**Tech Stack:** Same as Phase 1A — TypeScript strict mode, `postgres` npm client, Vitest, real Neon database for tests (no mocking of Postgres — this project tests against the real thing, per Phase 1A's established pattern).

**Spec:** `docs/superpowers/specs/2026-08-29-ai-crm-erp-platform-design.md` (§8 Data Model, §6.0 host-core/plugin boundary). Companion: `docs/superpowers/specs/2026-08-29-execution-team-structure.md` (Phase 2 task table).

## Global Constraints

- **Every new tenant-scoped table gets `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + a `tenant_isolation` policy** scoped to `current_tenant_id()`, exactly matching `db/migrations/0002_tenant_user_role.sql`'s pattern. No exceptions — Phase 1A's CI gate (`db/migrations/__tests__/rls-policy-audit.test.ts`) will fail the build if this is missed, which is the intended enforcement.
- **Every composite index leads with `tenant_id`** (established convention, design spec §8).
- **All data access goes through `withTenant()`** (`lib/db/with-tenant.ts`) — never call `getSql()` directly for tenant-scoped queries (per that file's own docstring warning added in Phase 1A's final review).
- **TypeScript strict mode**, no `any`.
- **No secrets in code or committed to git.**
- **Every task ends with passing tests before moving to the next task.**
- **Test cleanup discipline**: every test that inserts rows must clean them up in `afterAll`, scoped precisely to the IDs it created — Phase 1A's final review caught a real bug (32 accumulated junk rows) from a test that skipped this. Do not repeat it.

---

## Task 1: Contact Table

**Files:**
- Create: `db/migrations/0003_contact.sql`
- Test: `db/migrations/__tests__/0003_contact.test.ts`

**Interfaces:**
- Consumes: `app_runtime` role, `current_tenant_id()` function (Task 3, Phase 1A), `withTenant()` (Task 5, Phase 1A).
- Produces: a `contact` table — the shared entity CRM and ERP both reference (design spec §8: "shared across CRM+ERP — one record, not duplicated per module"). Later tasks in this plan (`deal`) reference `contact(id)`.

- [ ] **Step 1: Write the migration**

`db/migrations/0003_contact.sql`:
```sql
CREATE TABLE contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  full_name text NOT NULL,
  email text,
  phone text,
  company text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contact_tenant_id_idx ON contact (tenant_id, id);
CREATE INDEX contact_tenant_email_idx ON contact (tenant_id, email) WHERE email IS NOT NULL;

ALTER TABLE contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contact
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON contact TO app_runtime;
```

- [ ] **Step 2: Run the migration against the dev database**

Run: `node -e "const postgres=require('postgres'); require('dotenv').config({path:'.env.local'}); const sql=postgres(process.env.DATABASE_URL); sql.file('db/migrations/0003_contact.sql').then(()=>{console.log('OK');return sql.end();}).catch(e=>{console.error(e.message);process.exit(1);})"`
Expected: prints `OK`.

- [ ] **Step 3: Write the failing isolation test**

`db/migrations/__tests__/0003_contact.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const sql = postgres(process.env.APP_RUNTIME_DATABASE_URL!);
const setupSql = postgres(process.env.DATABASE_URL!);

describe('contact tenant isolation', () => {
  let tenantAId: string;
  let tenantBId: string;
  let contactAId: string;

  beforeAll(async () => {
    const [tenantA] = await setupSql`INSERT INTO tenant (name) VALUES ('Contact Test Tenant A') RETURNING id`;
    const [tenantB] = await setupSql`INSERT INTO tenant (name) VALUES ('Contact Test Tenant B') RETURNING id`;
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    const [contactA] = await setupSql`INSERT INTO contact (tenant_id, full_name, email) VALUES (${tenantAId}, 'Alice Test', 'alice@example.test') RETURNING id`;
    contactAId = contactA.id;
    await setupSql`INSERT INTO contact (tenant_id, full_name, email) VALUES (${tenantBId}, 'Bob Test', 'bob@example.test')`;
  });

  afterAll(async () => {
    await setupSql`DELETE FROM contact WHERE tenant_id IN (${tenantAId}, ${tenantBId})`;
    await setupSql`DELETE FROM tenant WHERE id IN (${tenantAId}, ${tenantBId})`;
    await setupSql.end();
    await sql.end();
  });

  it('a transaction scoped to tenant A sees only tenant A contacts', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantAId})`;
      return tx`SELECT * FROM contact`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(contactAId);
  });

  it('email lookup respects tenant isolation', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantBId})`;
      return tx`SELECT * FROM contact WHERE email = 'alice@example.test'`;
    });
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run db/migrations/__tests__/0003_contact.test.ts`
Expected: FAILs (table doesn't exist yet if Step 2 wasn't run, or passes if it was — if Step 2 already ran, this step instead just confirms the test file is wired correctly; note this in your report either way).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run db/migrations/__tests__/0003_contact.test.ts`
Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0003_contact.sql db/migrations/__tests__/0003_contact.test.ts
git commit -m "feat: add contact table with forced RLS"
```

---

## Task 2: Pipeline Stage Table

**Files:**
- Create: `db/migrations/0004_pipeline_stage.sql`
- Test: `db/migrations/__tests__/0004_pipeline_stage.test.ts`

**Interfaces:**
- Consumes: same as Task 1.
- Produces: `pipeline_stage` table. Later tasks (`deal`) reference `pipeline_stage(id)`.

- [ ] **Step 1: Write the migration**

`db/migrations/0004_pipeline_stage.sql`:
```sql
CREATE TABLE pipeline_stage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX pipeline_stage_tenant_id_idx ON pipeline_stage (tenant_id, sort_order);

ALTER TABLE pipeline_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stage FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON pipeline_stage
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline_stage TO app_runtime;
```

- [ ] **Step 2: Run the migration**

Run: `node -e "const postgres=require('postgres'); require('dotenv').config({path:'.env.local'}); const sql=postgres(process.env.DATABASE_URL); sql.file('db/migrations/0004_pipeline_stage.sql').then(()=>{console.log('OK');return sql.end();}).catch(e=>{console.error(e.message);process.exit(1);})"`
Expected: prints `OK`.

- [ ] **Step 3: Write the failing test**

`db/migrations/__tests__/0004_pipeline_stage.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const sql = postgres(process.env.APP_RUNTIME_DATABASE_URL!);
const setupSql = postgres(process.env.DATABASE_URL!);

describe('pipeline_stage tenant isolation', () => {
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    const [tenantA] = await setupSql`INSERT INTO tenant (name) VALUES ('Stage Test Tenant A') RETURNING id`;
    const [tenantB] = await setupSql`INSERT INTO tenant (name) VALUES ('Stage Test Tenant B') RETURNING id`;
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    await setupSql`INSERT INTO pipeline_stage (tenant_id, name, sort_order) VALUES (${tenantAId}, 'Lead', 0), (${tenantAId}, 'Qualified', 1), (${tenantAId}, 'Won', 2)`;
    await setupSql`INSERT INTO pipeline_stage (tenant_id, name, sort_order) VALUES (${tenantBId}, 'Lead', 0)`;
  });

  afterAll(async () => {
    await setupSql`DELETE FROM pipeline_stage WHERE tenant_id IN (${tenantAId}, ${tenantBId})`;
    await setupSql`DELETE FROM tenant WHERE id IN (${tenantAId}, ${tenantBId})`;
    await setupSql.end();
    await sql.end();
  });

  it('tenant A sees exactly its 3 stages, in sort order', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantAId})`;
      return tx`SELECT name FROM pipeline_stage ORDER BY sort_order`;
    });
    expect(rows.map((r) => r.name)).toEqual(['Lead', 'Qualified', 'Won']);
  });

  it('the UNIQUE(tenant_id, name) constraint allows the same stage name across different tenants', async () => {
    // Both tenant A and tenant B have a 'Lead' stage — proves the unique
    // constraint is tenant-scoped, not global.
    const rows = await setupSql`SELECT tenant_id, name FROM pipeline_stage WHERE name = 'Lead'`;
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run db/migrations/__tests__/0004_pipeline_stage.test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/0004_pipeline_stage.sql db/migrations/__tests__/0004_pipeline_stage.test.ts
git commit -m "feat: add pipeline_stage table with forced RLS"
```

---

## Task 3: Deal Table

**Files:**
- Create: `db/migrations/0005_deal.sql`
- Test: `db/migrations/__tests__/0005_deal.test.ts`

**Interfaces:**
- Consumes: `contact(id)` from Task 1, `pipeline_stage(id)` from Task 2.
- Produces: `deal` table.

- [ ] **Step 1: Write the migration**

`db/migrations/0005_deal.sql`:
```sql
CREATE TABLE deal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contact_id uuid NOT NULL REFERENCES contact(id),
  pipeline_stage_id uuid NOT NULL REFERENCES pipeline_stage(id),
  title text NOT NULL,
  -- Integer minor-units + currency code, per design spec §8's round-4
  -- currency-handling fix — applied here even though pipeline deals are
  -- often estimate-stage, since a deal can carry a real value.
  value_minor_units bigint,
  currency_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX deal_tenant_id_idx ON deal (tenant_id, id);
CREATE INDEX deal_tenant_stage_idx ON deal (tenant_id, pipeline_stage_id);
CREATE INDEX deal_tenant_contact_idx ON deal (tenant_id, contact_id);

ALTER TABLE deal ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON deal
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON deal TO app_runtime;
```

- [ ] **Step 2: Run the migration**

Run: `node -e "const postgres=require('postgres'); require('dotenv').config({path:'.env.local'}); const sql=postgres(process.env.DATABASE_URL); sql.file('db/migrations/0005_deal.sql').then(()=>{console.log('OK');return sql.end();}).catch(e=>{console.error(e.message);process.exit(1);})"`
Expected: prints `OK`.

- [ ] **Step 3: Write the failing test**

`db/migrations/__tests__/0005_deal.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const sql = postgres(process.env.APP_RUNTIME_DATABASE_URL!);
const setupSql = postgres(process.env.DATABASE_URL!);

describe('deal tenant isolation and foreign keys', () => {
  let tenantAId: string;
  let contactAId: string;
  let stageAId: string;
  let dealAId: string;

  beforeAll(async () => {
    const [tenantA] = await setupSql`INSERT INTO tenant (name) VALUES ('Deal Test Tenant A') RETURNING id`;
    tenantAId = tenantA.id;
    const [contactA] = await setupSql`INSERT INTO contact (tenant_id, full_name) VALUES (${tenantAId}, 'Deal Contact') RETURNING id`;
    contactAId = contactA.id;
    const [stageA] = await setupSql`INSERT INTO pipeline_stage (tenant_id, name, sort_order) VALUES (${tenantAId}, 'Lead', 0) RETURNING id`;
    stageAId = stageA.id;
    const [dealA] = await setupSql`INSERT INTO deal (tenant_id, contact_id, pipeline_stage_id, title, value_minor_units, currency_code) VALUES (${tenantAId}, ${contactAId}, ${stageAId}, 'Big Deal', 500000, 'USD') RETURNING id`;
    dealAId = dealA.id;
  });

  afterAll(async () => {
    await setupSql`DELETE FROM deal WHERE tenant_id = ${tenantAId}`;
    await setupSql`DELETE FROM pipeline_stage WHERE tenant_id = ${tenantAId}`;
    await setupSql`DELETE FROM contact WHERE tenant_id = ${tenantAId}`;
    await setupSql`DELETE FROM tenant WHERE id = ${tenantAId}`;
    await setupSql.end();
    await sql.end();
  });

  it('a tenant-scoped query sees the deal with correct value fields', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantAId})`;
      return tx`SELECT title, value_minor_units, currency_code FROM deal WHERE id = ${dealAId}`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].value_minor_units).toBe(500000n); // bigint comes back as BigInt or string depending on driver config — assert loosely if needed
    expect(rows[0].currency_code).toBe('USD');
  });

  it('a zero-context query sees nothing', async () => {
    const rows = await sql.begin(async (tx) => {
      return tx`SELECT * FROM deal WHERE id = ${dealAId}`;
    });
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run db/migrations/__tests__/0005_deal.test.ts`
Expected: both tests PASS. (If the `value_minor_units` assertion fails due to bigint serialization, adjust to `Number(rows[0].value_minor_units)` or `String(...)` matching whatever the `postgres` driver actually returns — check the real output and fix the assertion to match reality, don't force the driver.)

- [ ] **Step 5: Commit**

```bash
git add db/migrations/0005_deal.sql db/migrations/__tests__/0005_deal.test.ts
git commit -m "feat: add deal table with forced RLS and currency handling"
```

---

## Task 4: CI Audit Gate Extension Check

Phase 1A's CI gate (`db/migrations/__tests__/rls-policy-audit.test.ts`) already checks every non-exempt table generically — it does not need new code for `contact`/`pipeline_stage`/`deal` to be covered, but this task verifies that's actually true rather than assuming it.

**Files:**
- None created — this task only verifies.

**Interfaces:**
- Consumes: `db/migrations/__tests__/rls-policy-audit.test.ts` (Phase 1A).

- [ ] **Step 1: Run the existing CI audit test against the now-larger schema**

Run: `npx vitest run db/migrations/__tests__/rls-policy-audit.test.ts`
Expected: PASSes, and its assertions now cover `contact`, `pipeline_stage`, and `deal` in addition to `tenant`/`app_user` — the test's SQL queries `pg_class`/`pg_namespace` generically, so no test code changes are needed. Confirm this by checking the test output covers more tables than before (you can temporarily add a `console.log` of the row count inside the test to see it's now 5 tables, not 2 — remove the log before committing, this is a one-time manual check, not a permanent change).

- [ ] **Step 2: If it fails, do NOT weaken the test — fix the migration**

If the audit test fails against any of Tasks 1-3's tables, that means a migration in this plan has a real RLS gap. Go back and fix the specific migration file, re-run its own migration and test, then re-run the audit test. Do not modify `rls-policy-audit.test.ts` to work around a real gap.

- [ ] **Step 3: No commit needed for this task** (verification only, unless Step 2 required a fix — in that case, amend the relevant task's commit or add a small fix commit, and note this in your report)

---

## Task 5: Typed Data-Access Layer — Contacts

**Files:**
- Create: `lib/crm/contacts.ts`
- Test: `lib/crm/__tests__/contacts.test.ts`

**Interfaces:**
- Consumes: `withTenant()` from `lib/db/with-tenant.ts` (Phase 1A).
- Produces: `createContact(tenantId: string, input: NewContact): Promise<Contact>`, `getContact(tenantId: string, id: string): Promise<Contact | null>`, `listContacts(tenantId: string): Promise<Contact[]>` — the typed functions Phase 2B's UI and Phase 5's agent tools will call. `Contact` and `NewContact` types exported from this file are the canonical shape later tasks/phases import.

- [ ] **Step 1: Write the failing test**

`lib/crm/__tests__/contacts.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest';
import postgres from 'postgres';
import { createContact, getContact, listContacts } from '../contacts';

const setupSql = postgres(process.env.DATABASE_URL!);
let tenantId: string;
const createdContactIds: string[] = [];

describe('contacts data access layer', () => {
  afterAll(async () => {
    if (createdContactIds.length > 0) {
      await setupSql`DELETE FROM contact WHERE id = ANY(${createdContactIds})`;
    }
    if (tenantId) {
      await setupSql`DELETE FROM tenant WHERE id = ${tenantId}`;
    }
    await setupSql.end();
  });

  it('creates and retrieves a contact scoped to a tenant', async () => {
    const [tenant] = await setupSql`INSERT INTO tenant (name) VALUES ('Contacts Lib Test') RETURNING id`;
    tenantId = tenant.id;

    const created = await createContact(tenantId, { fullName: 'Jane Doe', email: 'jane@example.test' });
    createdContactIds.push(created.id);
    expect(created.fullName).toBe('Jane Doe');
    expect(created.email).toBe('jane@example.test');

    const fetched = await getContact(tenantId, created.id);
    expect(fetched?.id).toBe(created.id);
  });

  it('listContacts only returns the calling tenant\'s contacts', async () => {
    const [otherTenant] = await setupSql`INSERT INTO tenant (name) VALUES ('Contacts Lib Test Other') RETURNING id`;
    try {
      const otherContact = await createContact(otherTenant.id, { fullName: 'Other Tenant Contact' });
      const list = await listContacts(tenantId);
      expect(list.find((c) => c.id === otherContact.id)).toBeUndefined();
      await setupSql`DELETE FROM contact WHERE id = ${otherContact.id}`;
    } finally {
      await setupSql`DELETE FROM tenant WHERE id = ${otherTenant.id}`;
    }
  });

  it('getContact returns null for a non-existent id', async () => {
    const result = await getContact(tenantId, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/crm/__tests__/contacts.test.ts`
Expected: FAILs — `../contacts` doesn't exist yet.

- [ ] **Step 3: Implement the data-access layer**

`lib/crm/contacts.ts`:
```typescript
import { withTenant } from '../db/with-tenant';

export interface Contact {
  id: string;
  tenantId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewContact {
  fullName: string;
  email?: string;
  phone?: string;
  company?: string;
}

function rowToContact(row: any): Contact {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createContact(tenantId: string, input: NewContact): Promise<Contact> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO contact (tenant_id, full_name, email, phone, company)
      VALUES (${tenantId}, ${input.fullName}, ${input.email ?? null}, ${input.phone ?? null}, ${input.company ?? null})
      RETURNING *
    `;
    return rowToContact(row);
  });
}

export async function getContact(tenantId: string, id: string): Promise<Contact | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM contact WHERE id = ${id}`;
    return rows.length > 0 ? rowToContact(rows[0]) : null;
  });
}

export async function listContacts(tenantId: string): Promise<Contact[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM contact ORDER BY created_at DESC`;
    return rows.map(rowToContact);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/crm/__tests__/contacts.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/crm/contacts.ts lib/crm/__tests__/contacts.test.ts
git commit -m "feat: add contacts data-access layer via withTenant"
```

---

## Task 6: Typed Data-Access Layer — Deals and Pipeline

**Files:**
- Create: `lib/crm/deals.ts`
- Test: `lib/crm/__tests__/deals.test.ts`

**Interfaces:**
- Consumes: `withTenant()`, `Contact` type shape convention from Task 5.
- Produces: `createDeal(tenantId, input: NewDeal): Promise<Deal>`, `listDealsByStage(tenantId: string): Promise<Record<string, Deal[]>>`, `moveDealToStage(tenantId: string, dealId: string, stageId: string): Promise<Deal>`, `listPipelineStages(tenantId: string): Promise<PipelineStage[]>`.

- [ ] **Step 1: Write the failing test**

`lib/crm/__tests__/deals.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest';
import postgres from 'postgres';
import { createDeal, listDealsByStage, moveDealToStage, listPipelineStages } from '../deals';
import { createContact } from '../contacts';

const setupSql = postgres(process.env.DATABASE_URL!);
let tenantId: string;
let contactId: string;
let stageLeadId: string;
let stageWonId: string;
const createdDealIds: string[] = [];

describe('deals data access layer', () => {
  afterAll(async () => {
    if (createdDealIds.length > 0) {
      await setupSql`DELETE FROM deal WHERE id = ANY(${createdDealIds})`;
    }
    await setupSql`DELETE FROM pipeline_stage WHERE tenant_id = ${tenantId}`;
    await setupSql`DELETE FROM contact WHERE tenant_id = ${tenantId}`;
    await setupSql`DELETE FROM tenant WHERE id = ${tenantId}`;
    await setupSql.end();
  });

  it('sets up tenant, contact, and stages', async () => {
    const [tenant] = await setupSql`INSERT INTO tenant (name) VALUES ('Deals Lib Test') RETURNING id`;
    tenantId = tenant.id;
    const contact = await createContact(tenantId, { fullName: 'Deal Test Contact' });
    contactId = contact.id;
    const [lead] = await setupSql`INSERT INTO pipeline_stage (tenant_id, name, sort_order) VALUES (${tenantId}, 'Lead', 0) RETURNING id`;
    const [won] = await setupSql`INSERT INTO pipeline_stage (tenant_id, name, sort_order) VALUES (${tenantId}, 'Won', 1) RETURNING id`;
    stageLeadId = lead.id;
    stageWonId = won.id;
    expect(stageLeadId).toBeDefined();
  });

  it('creates a deal in the Lead stage', async () => {
    const deal = await createDeal(tenantId, {
      contactId,
      pipelineStageId: stageLeadId,
      title: 'Test Deal',
      valueMinorUnits: 100000,
      currencyCode: 'USD',
    });
    createdDealIds.push(deal.id);
    expect(deal.title).toBe('Test Deal');
    expect(deal.pipelineStageId).toBe(stageLeadId);
  });

  it('listDealsByStage groups deals under their stage id', async () => {
    const grouped = await listDealsByStage(tenantId);
    expect(grouped[stageLeadId]).toHaveLength(1);
    expect(grouped[stageWonId] ?? []).toHaveLength(0);
  });

  it('moveDealToStage updates the deal\'s stage', async () => {
    const dealId = createdDealIds[0];
    const moved = await moveDealToStage(tenantId, dealId, stageWonId);
    expect(moved.pipelineStageId).toBe(stageWonId);

    const grouped = await listDealsByStage(tenantId);
    expect(grouped[stageWonId]).toHaveLength(1);
    expect(grouped[stageLeadId] ?? []).toHaveLength(0);
  });

  it('listPipelineStages returns stages in sort order', async () => {
    const stages = await listPipelineStages(tenantId);
    expect(stages.map((s) => s.name)).toEqual(['Lead', 'Won']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/crm/__tests__/deals.test.ts`
Expected: FAILs — `../deals` doesn't exist yet.

- [ ] **Step 3: Implement the data-access layer**

`lib/crm/deals.ts`:
```typescript
import { withTenant } from '../db/with-tenant';

export interface Deal {
  id: string;
  tenantId: string;
  contactId: string;
  pipelineStageId: string;
  title: string;
  valueMinorUnits: number | null;
  currencyCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewDeal {
  contactId: string;
  pipelineStageId: string;
  title: string;
  valueMinorUnits?: number;
  currencyCode?: string;
}

export interface PipelineStage {
  id: string;
  tenantId: string;
  name: string;
  sortOrder: number;
}

function rowToDeal(row: any): Deal {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    pipelineStageId: row.pipeline_stage_id,
    title: row.title,
    valueMinorUnits: row.value_minor_units !== null ? Number(row.value_minor_units) : null,
    currencyCode: row.currency_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToStage(row: any): PipelineStage {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

export async function createDeal(tenantId: string, input: NewDeal): Promise<Deal> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO deal (tenant_id, contact_id, pipeline_stage_id, title, value_minor_units, currency_code)
      VALUES (${tenantId}, ${input.contactId}, ${input.pipelineStageId}, ${input.title}, ${input.valueMinorUnits ?? null}, ${input.currencyCode ?? null})
      RETURNING *
    `;
    return rowToDeal(row);
  });
}

export async function listDealsByStage(tenantId: string): Promise<Record<string, Deal[]>> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM deal ORDER BY created_at DESC`;
    const grouped: Record<string, Deal[]> = {};
    for (const row of rows) {
      const deal = rowToDeal(row);
      if (!grouped[deal.pipelineStageId]) grouped[deal.pipelineStageId] = [];
      grouped[deal.pipelineStageId].push(deal);
    }
    return grouped;
  });
}

export async function moveDealToStage(tenantId: string, dealId: string, stageId: string): Promise<Deal> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      UPDATE deal SET pipeline_stage_id = ${stageId}, updated_at = now()
      WHERE id = ${dealId}
      RETURNING *
    `;
    return rowToDeal(row);
  });
}

export async function listPipelineStages(tenantId: string): Promise<PipelineStage[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM pipeline_stage ORDER BY sort_order`;
    return rows.map(rowToStage);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/crm/__tests__/deals.test.ts`
Expected: all 5 tests PASS, in order (they build on each other's state within the same `tenantId`).

- [ ] **Step 5: Commit**

```bash
git add lib/crm/deals.ts lib/crm/__tests__/deals.test.ts
git commit -m "feat: add deals and pipeline data-access layer via withTenant"
```

---

## Task 7: CRM Tool Contract for the Future AI Agent

Per the execution team structure doc (Phase 2's `api-contract-engineer` task): "Defines the CRM tool contract the AI agent will consume in phase 5 — done now so phase 5 isn't guessing at an interface."

**Files:**
- Create: `lib/crm/tool-contract.ts`
- Test: `lib/crm/__tests__/tool-contract.test.ts`

**Interfaces:**
- Consumes: `Contact`/`NewContact` types from Task 5, `Deal`/`NewDeal`/`PipelineStage` types from Task 6.
- Produces: `CRM_TOOL_DEFINITIONS` — an array of JSON-schema-shaped tool definitions (Anthropic tool-use format) plus a `CRM_TOOL_HANDLERS` map from tool name to an async handler function. This is the exact contract design spec §5's "cross-domain tools" section describes; Phase 5's agent runtime will register these directly.

- [ ] **Step 1: Write the failing test**

`lib/crm/__tests__/tool-contract.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest';
import postgres from 'postgres';
import { CRM_TOOL_DEFINITIONS, CRM_TOOL_HANDLERS } from '../tool-contract';

const setupSql = postgres(process.env.DATABASE_URL!);
let tenantId: string;

describe('CRM tool contract', () => {
  afterAll(async () => {
    if (tenantId) {
      await setupSql`DELETE FROM contact WHERE tenant_id = ${tenantId}`;
      await setupSql`DELETE FROM tenant WHERE id = ${tenantId}`;
    }
    await setupSql.end();
  });

  it('defines a tool for creating a contact with a valid JSON schema shape', () => {
    const createContactTool = CRM_TOOL_DEFINITIONS.find((t) => t.name === 'create_contact');
    expect(createContactTool).toBeDefined();
    expect(createContactTool!.input_schema.type).toBe('object');
    expect(createContactTool!.input_schema.required).toContain('fullName');
  });

  it('defines a tool for listing contacts', () => {
    const listTool = CRM_TOOL_DEFINITIONS.find((t) => t.name === 'list_contacts');
    expect(listTool).toBeDefined();
  });

  it('every tool definition has a corresponding handler', () => {
    for (const tool of CRM_TOOL_DEFINITIONS) {
      expect(CRM_TOOL_HANDLERS[tool.name], `missing handler for ${tool.name}`).toBeDefined();
    }
  });

  it('the create_contact handler actually creates a contact scoped to the given tenant', async () => {
    const [tenant] = await setupSql`INSERT INTO tenant (name) VALUES ('Tool Contract Test') RETURNING id`;
    tenantId = tenant.id;

    const result = await CRM_TOOL_HANDLERS['create_contact'](tenantId, { fullName: 'Agent Created Contact' });
    expect(result.fullName).toBe('Agent Created Contact');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/crm/__tests__/tool-contract.test.ts`
Expected: FAILs — `../tool-contract` doesn't exist yet.

- [ ] **Step 3: Implement the tool contract**

`lib/crm/tool-contract.ts`:
```typescript
import { createContact, listContacts, getContact } from './contacts';
import { createDeal, listDealsByStage, moveDealToStage, listPipelineStages } from './deals';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}

// One shared tool set spanning CRM (this file). ERP tools join this array
// in a later phase — design spec §5 describes this as one unified tool
// set, not per-domain silos, so the agent can act across both in a single
// turn once Phase 3 adds ERP tools here too.
export const CRM_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'create_contact',
    description: 'Create a new CRM contact for the current tenant.',
    input_schema: {
      type: 'object',
      properties: {
        fullName: { type: 'string', description: "The contact's full name" },
        email: { type: 'string', description: "The contact's email address" },
        phone: { type: 'string', description: "The contact's phone number" },
        company: { type: 'string', description: "The contact's company name" },
      },
      required: ['fullName'],
    },
  },
  {
    name: 'list_contacts',
    description: 'List all CRM contacts for the current tenant.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_contact',
    description: 'Fetch a single CRM contact by id.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The contact id (UUID)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_deal',
    description: 'Create a new deal in the sales pipeline, attached to a contact and a pipeline stage.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact this deal belongs to' },
        pipelineStageId: { type: 'string', description: 'The pipeline stage id to place this deal in' },
        title: { type: 'string', description: 'A short title describing the deal' },
        valueMinorUnits: { type: 'number', description: 'Deal value in minor currency units (e.g. cents)' },
        currencyCode: { type: 'string', description: 'ISO currency code, e.g. USD' },
      },
      required: ['contactId', 'pipelineStageId', 'title'],
    },
  },
  {
    name: 'list_deals_by_stage',
    description: 'List all deals for the current tenant, grouped by pipeline stage id.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'move_deal_to_stage',
    description: "Move a deal to a different pipeline stage (e.g. advancing it through the sales pipeline).",
    input_schema: {
      type: 'object',
      properties: {
        dealId: { type: 'string', description: 'The deal to move' },
        stageId: { type: 'string', description: 'The pipeline stage id to move it to' },
      },
      required: ['dealId', 'stageId'],
    },
  },
  {
    name: 'list_pipeline_stages',
    description: 'List the current tenant\'s pipeline stages in order.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

type ToolHandler = (tenantId: string, input: any) => Promise<any>;

export const CRM_TOOL_HANDLERS: Record<string, ToolHandler> = {
  create_contact: (tenantId, input) => createContact(tenantId, input),
  list_contacts: (tenantId) => listContacts(tenantId),
  get_contact: (tenantId, input) => getContact(tenantId, input.id),
  create_deal: (tenantId, input) => createDeal(tenantId, input),
  list_deals_by_stage: (tenantId) => listDealsByStage(tenantId),
  move_deal_to_stage: (tenantId, input) => moveDealToStage(tenantId, input.dealId, input.stageId),
  list_pipeline_stages: (tenantId) => listPipelineStages(tenantId),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/crm/__tests__/tool-contract.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/crm/tool-contract.ts lib/crm/__tests__/tool-contract.test.ts
git commit -m "feat: add CRM tool contract for future AI agent runtime (Phase 5)"
```

---

## Task 8: Full Suite Verification

**Files:** none created.

- [ ] **Step 1: Run the complete test suite**

Run: `npx vitest run`
Expected: all tests pass — Phase 1A's 14 tests plus this plan's new tests, no regressions.

- [ ] **Step 2: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: clean, no type errors.

- [ ] **Step 3: No commit needed** (verification only — if anything fails, fix in the relevant task and re-verify here)

---

## Self-Review Notes (per writing-plans skill requirement)

**Spec coverage check** against design spec §8 (this sub-plan's scope):
- `contact` table, shared across CRM+ERP → Task 1 ✓
- `pipeline_stage` table → Task 2 ✓
- `deal` table with integer-minor-units currency handling → Task 3 ✓ (per round-4 fix)
- `tenant_id`-led composite indexing convention → applied in every migration's `CREATE INDEX` ✓
- FORCE RLS + tenant_isolation policy on every new table → Tasks 1-3, verified generically by Task 4 ✓
- CRM tool contract for Phase 5's agent → Task 7 ✓ (execution team doc's explicit Phase 2 requirement)

**Out of scope for this sub-plan** (belongs to Phase 2B, or later phases): pipeline/contact UI (Phase 2B), ERP tables (Phase 3), the AI agent runtime itself that will consume this tool contract (Phase 5).

**Type consistency check:** `Contact`/`NewContact` (Task 5) reused verbatim by Task 7's tool contract. `Deal`/`NewDeal`/`PipelineStage` (Task 6) reused verbatim by Task 7. `tenantId: string` parameter consistent across every function in `lib/crm/*.ts`, matching `withTenant`'s own signature from Phase 1A.

**Placeholder scan:** no TBD/TODO/"handle appropriately" found — every step has concrete code.
