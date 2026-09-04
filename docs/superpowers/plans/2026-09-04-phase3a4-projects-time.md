# Phase 3A-4: Projects & Time Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the project/task/time-entry schema and data layer that gives an `'effort_based' IN billing_modes` tenant real time tracking, ready for a later invoice-generation sub-plan to sweep unbilled, approved, billable time into invoices.

**Architecture:** Three new tables (`project`, `task`, `time_entry`) with `project` linking to the existing CRM `contact` table (the client), `task` optionally carrying its own hourly rate, and `time_entry` carrying three deliberately independent state booleans/enum (`billable`, `billed`, `approval_state`) per the market research's explicit finding that collapsing them breaks the eventual billing sweep. Every foreign-key-accepting constructor validates ownership before any write — the lesson Phase 3A-3 only learned after a full final-review fix wave, applied here from the start instead. No invoice generation, no UI — schema + data layer only, matching every prior 3A sub-plan's shape.

**Tech Stack:** Postgres (Neon) migrations, `postgres` npm package via `withTenant()`, Vitest (`backend` project) for tests.

**Spec:** `docs/superpowers/specs/2026-09-01-phase3-erp-design.md` (§4's "Projects & time" module row) and `docs/superpowers/specs/research/2026-09-01-erp-market-research.md` §2 (the service-based vertical's entity model this plan implements: project→task→time_entry, the billable/billed/approval three-state design fact, task-level rate carrying).

## Global Constraints

- Every new table MUST have both `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, plus a `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())` — checked automatically by the existing `db/migrations/__tests__/rls-policy-audit.test.ts` CI gate.
- All application-level DB access goes through `withTenant(tenantId, fn)` from `lib/db/with-tenant.ts` — never call `getSql()` directly.
- **Every foreign-key-accepting `create*` function MUST validate that the referenced row belongs to the calling tenant BEFORE any write, using the target's own `get*` function.** This is not optional or deferrable to a later fix wave — Phase 3A-3 shipped without this, a final whole-branch review found 2 Important cross-tenant data-integrity gaps as a result, and a full fix-wave-plus-re-review cycle was needed to close them. This plan bakes the lesson in from Task 1 onward: `createProject` validates `contactId` via `getContact`; `createTask` validates `projectId` via `getProject`; `createTimeEntry` validates `projectId` via `getProject` and, if `taskId` is given, validates it belongs to that same project. Reference `lib/erp/manufacturing-orders.ts`'s `createManufacturingOrder` (current on `main` as of commit `7a5aff9`) for the exact shape: validate-then-throw, all validation calls before the `withTenant` transaction that does the insert.
- Mirror `lib/erp/locations.ts` (trivial CRUD) and `lib/erp/purchase-orders.ts`/`lib/erp/manufacturing-orders.ts` (FK validation + atomic state-transition guards) as the exact reference patterns.
- Do not collide with existing table names: `tenant`, `app_user`, `contact`, `pipeline_stage`, `deal`, `tenant_erp_settings`, `vendor`, `product`, `document_sequence`, `location`, `stock_move`, `purchase_order`, `purchase_order_line`, `bill_of_materials`, `bom_component`, `work_center`, `routing`, `operation`, `manufacturing_order`, `work_order`.
- Next migration number is `0020` (existing: 0001–0019 in `db/migrations/`).
- `approval_state` enum has exactly 5 values (`draft`, `pending_approval`, `approved`, `rejected`, `withdrawn`) — reuse this type, never redefine it.
- Money fields use the integer-minor-units + explicit-currency-code convention (`hourly_rate_minor_units bigint`, `currency_code text`), matching `product.price_minor_units`/`currency_code`.
- `billable`, `billed` (both `boolean`), and `approval_state` (the shared enum) on `time_entry` are three genuinely independent facts per research §2.3 — never collapse any two of them into one column, and every migration/code comment touching this table must make that explicit for future readers, the same way `purchase_order`'s migration explains its own two-state-column split.
- TDD: write the failing test before the implementation in every task that has one.
- Test-isolation discipline: any test that queries shared state must scope by tenant/id explicitly — never rely on being "the only test" creating a given row.
- `npx tsc --noEmit` must stay clean after every task.
- `vitest.config.ts` already has `testTimeout: 20000` — no config changes needed.
- Grant `SELECT, INSERT, UPDATE, DELETE` to `app_runtime` on every new table, matching the existing migrations' pattern exactly.
- No invoice/billing-document generation in this plan — `time_entry`'s `billed` flag exists so a future sub-plan can sweep unbilled entries into an invoice, but that sweep logic itself is out of scope here.

---

### Task 1: `project` Table and Data-Access Layer

**Files:**
- Create: `db/migrations/0020_project.sql`
- Create: `lib/erp/projects.ts`
- Test: `lib/erp/__tests__/projects.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`; `getContact(tenantId: string, id: string): Promise<Contact | null>` from `lib/crm/contacts.ts` (used to validate `contactId` ownership before insert).
- Produces: `Project` interface (`id: string`, `tenantId: string`, `contactId: string`, `name: string`, `createdAt: Date`, `updatedAt: Date`); `NewProject` interface (`contactId: string`, `name: string`); `createProject(tenantId: string, input: NewProject): Promise<Project>` (throws `Error` if `contactId` doesn't belong to the tenant); `getProject(tenantId: string, id: string): Promise<Project | null>`; `listProjects(tenantId: string): Promise<Project[]>`. Task 2 (`task`) and Task 3 (`time_entry`) both consume `getProject` for their own FK-ownership validation.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0020_project.sql
-- A project is tied to a CRM contact (the client it's being done for) —
-- reusing the existing contact table per this project's "contact is one
-- record, not duplicated per module" principle (design spec §8), the
-- same way deal already links to contact in Phase 2A.
CREATE TABLE project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contact_id uuid NOT NULL REFERENCES contact(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_tenant_id_idx ON project (tenant_id, id);
CREATE INDEX project_tenant_contact_idx ON project (tenant_id, contact_id);

ALTER TABLE project ENABLE ROW LEVEL SECURITY;
ALTER TABLE project FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON project
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON project TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/projects.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createProject, getProject, listProjects } from '../projects';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('project data access', () => {
  it('creates a project linked to a contact and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Project Test Tenant 1') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Acme Corp Contact' });

    const project = await createProject(tenant.id, { contactId: contact.id, name: 'Website Redesign' });

    expect(project.contactId).toBe(contact.id);
    expect(project.name).toBe('Website Redesign');

    const fetched = await getProject(tenant.id, project.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Website Redesign');
  });

  it('rejects a contactId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Project Test Tenant 2A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Project Test Tenant 2B') RETURNING id`;
    const otherTenantContact = await createContact(tenantB.id, { fullName: 'Tenant B Contact' });

    await expect(
      createProject(tenantA.id, { contactId: otherTenantContact.id, name: 'Should Fail' }),
    ).rejects.toThrow();

    const projectsA = await listProjects(tenantA.id);
    expect(projectsA).toHaveLength(0);
  });

  it('returns null from getProject for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Project Test Tenant 3') RETURNING id`;
    const result = await getProject(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/projects.test.ts`
Expected: FAIL — `lib/erp/projects.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/projects.ts
import { withTenant } from '../db/with-tenant';
import { getContact } from '../crm/contacts';

export interface Project {
  id: string;
  tenantId: string;
  contactId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProject {
  contactId: string;
  name: string;
}

function rowToProject(row: any): Project {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createProject(tenantId: string, input: NewProject): Promise<Project> {
  // Validate contactId belongs to this tenant BEFORE any write — see
  // Global Constraints' FK-validation requirement, and
  // lib/erp/manufacturing-orders.ts's createManufacturingOrder for the
  // reference shape.
  const contact = await getContact(tenantId, input.contactId);
  if (!contact) {
    throw new Error(`Invalid contact reference: ${input.contactId} does not belong to this tenant`);
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO project (tenant_id, contact_id, name)
      VALUES (${tenantId}, ${input.contactId}, ${input.name})
      RETURNING *
    `;
    return rowToProject(row);
  });
}

export async function getProject(tenantId: string, id: string): Promise<Project | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM project WHERE id = ${id}`;
    return rows.length > 0 ? rowToProject(rows[0]) : null;
  });
}

export async function listProjects(tenantId: string): Promise<Project[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM project ORDER BY created_at DESC`;
    return rows.map(rowToProject);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/projects.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0020_project.sql lib/erp/projects.ts lib/erp/__tests__/projects.test.ts
git commit -m "feat: add project table with contact-ownership validation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `task` Table and Data-Access Layer

**Files:**
- Create: `db/migrations/0021_task.sql`
- Create: `lib/erp/tasks.ts`
- Test: `lib/erp/__tests__/tasks.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`; `getProject(tenantId: string, id: string): Promise<Project | null>` from `lib/erp/projects.ts` (Task 1).
- Produces: `Task` interface (`id: string`, `tenantId: string`, `projectId: string`, `name: string`, `hourlyRateMinorUnits: number | null`, `currencyCode: string | null`, `createdAt: Date`); `NewTask` interface (`projectId: string`, `name: string`, `hourlyRateMinorUnits?: number`, `currencyCode?: string`); `createTask(tenantId: string, input: NewTask): Promise<Task>` (throws if `projectId` doesn't belong to the tenant); `getTask(tenantId: string, id: string): Promise<Task | null>`; `listTasksByProject(tenantId: string, projectId: string): Promise<Task[]>`. Task 3 (`time_entry`) consumes `getTask` and `listTasksByProject` to validate a `taskId` belongs to the same `projectId` it's being logged against.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0021_task.sql
-- A task can carry its own hourly rate — per research §2.3's rate-
-- resolution design fact, Zoho Books supports three rate sources (task
-- rate, user rate, project rate) with an explicit precedence order.
-- This phase only stores the task-level rate (the first tier); user-
-- level and project-level rate resolution, and the precedence chain
-- itself, are deferred to whenever invoice generation is built and
-- actually needs to resolve a rate — recorded here so the deferral is
-- visible, not silently dropped.
CREATE TABLE task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_id uuid NOT NULL REFERENCES project(id),
  name text NOT NULL,
  hourly_rate_minor_units bigint,
  currency_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_tenant_project_idx ON task (tenant_id, project_id);

ALTER TABLE task ENABLE ROW LEVEL SECURITY;
ALTER TABLE task FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON task
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON task TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/tasks.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createTask, getTask, listTasksByProject } from '../tasks';
import { createProject } from '../projects';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('task data access', () => {
  it('creates a task with an hourly rate under a project and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Task Test Tenant 1') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Client' });
    const project = await createProject(tenant.id, { contactId: contact.id, name: 'Website Redesign' });

    const task = await createTask(tenant.id, {
      projectId: project.id,
      name: 'Homepage design',
      hourlyRateMinorUnits: 15000,
      currencyCode: 'USD',
    });

    expect(task.projectId).toBe(project.id);
    expect(task.hourlyRateMinorUnits).toBe(15000);

    const fetched = await getTask(tenant.id, task.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Homepage design');
  });

  it('creates a task with no rate (nullable fields)', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Task Test Tenant 2') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Client' });
    const project = await createProject(tenant.id, { contactId: contact.id, name: 'Project' });

    const task = await createTask(tenant.id, { projectId: project.id, name: 'Unrated task' });

    expect(task.hourlyRateMinorUnits).toBeNull();
    expect(task.currencyCode).toBeNull();
  });

  it('rejects a projectId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Task Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Task Test Tenant 3B') RETURNING id`;
    const contactB = await createContact(tenantB.id, { fullName: 'Tenant B Client' });
    const otherTenantProject = await createProject(tenantB.id, { contactId: contactB.id, name: 'Tenant B Project' });

    await expect(
      createTask(tenantA.id, { projectId: otherTenantProject.id, name: 'Should Fail' }),
    ).rejects.toThrow();
  });

  it('listTasksByProject returns only tasks for the given project', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Task Test Tenant 4') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Client' });
    const projectA = await createProject(tenant.id, { contactId: contact.id, name: 'Project A' });
    const projectB = await createProject(tenant.id, { contactId: contact.id, name: 'Project B' });

    await createTask(tenant.id, { projectId: projectA.id, name: 'Task A1' });
    await createTask(tenant.id, { projectId: projectB.id, name: 'Task B1' });

    const tasksA = await listTasksByProject(tenant.id, projectA.id);
    expect(tasksA.map((t) => t.name)).toEqual(['Task A1']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/tasks.test.ts`
Expected: FAIL — `lib/erp/tasks.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/tasks.ts
import { withTenant } from '../db/with-tenant';
import { getProject } from './projects';

export interface Task {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  hourlyRateMinorUnits: number | null;
  currencyCode: string | null;
  createdAt: Date;
}

export interface NewTask {
  projectId: string;
  name: string;
  hourlyRateMinorUnits?: number;
  currencyCode?: string;
}

function rowToTask(row: any): Task {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    name: row.name,
    hourlyRateMinorUnits: row.hourly_rate_minor_units !== null ? Number(row.hourly_rate_minor_units) : null,
    currencyCode: row.currency_code,
    createdAt: row.created_at,
  };
}

export async function createTask(tenantId: string, input: NewTask): Promise<Task> {
  const project = await getProject(tenantId, input.projectId);
  if (!project) {
    throw new Error(`Invalid project reference: ${input.projectId} does not belong to this tenant`);
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO task (tenant_id, project_id, name, hourly_rate_minor_units, currency_code)
      VALUES (${tenantId}, ${input.projectId}, ${input.name}, ${input.hourlyRateMinorUnits ?? null}, ${input.currencyCode ?? null})
      RETURNING *
    `;
    return rowToTask(row);
  });
}

export async function getTask(tenantId: string, id: string): Promise<Task | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM task WHERE id = ${id}`;
    return rows.length > 0 ? rowToTask(rows[0]) : null;
  });
}

export async function listTasksByProject(tenantId: string, projectId: string): Promise<Task[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM task WHERE project_id = ${projectId} ORDER BY created_at ASC`;
    return rows.map(rowToTask);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/tasks.test.ts`
Expected: PASS (4/4 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0021_task.sql lib/erp/tasks.ts lib/erp/__tests__/tasks.test.ts
git commit -m "feat: add task table with project-ownership validation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `time_entry` Table and Data-Access Layer

**Files:**
- Create: `db/migrations/0022_time_entry.sql`
- Create: `lib/erp/time-entries.ts`
- Test: `lib/erp/__tests__/time-entries.test.ts`

**Interfaces:**
- Consumes: `withTenant` from `lib/db/with-tenant.ts`; `getProject(tenantId, id)` from `lib/erp/projects.ts`; `getTask(tenantId, id)` from `lib/erp/tasks.ts`.
- Produces: `TimeEntry` interface (`id: string`, `tenantId: string`, `projectId: string`, `taskId: string | null`, `durationMinutes: number`, `occurredOn: string`, `description: string | null`, `billable: boolean`, `billed: boolean`, `approvalState: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn'`, `createdAt: Date`, `updatedAt: Date`); `NewTimeEntry` interface (`projectId: string`, `taskId?: string`, `durationMinutes: number`, `occurredOn: string`, `description?: string`, `billable?: boolean`); `createTimeEntry(tenantId: string, input: NewTimeEntry): Promise<TimeEntry>` (validates `projectId` via `getProject`, and if `taskId` is given, validates via `getTask` that it exists for this tenant AND that its `projectId` matches `input.projectId` — throws a clear error distinguishing "task doesn't exist" from "task belongs to a different project"; defaults `billable: true` if not provided, `billed: false`, `approvalState: 'draft'`); `getTimeEntry(tenantId: string, id: string): Promise<TimeEntry | null>`; `listTimeEntries(tenantId: string, projectId: string, filter?: { billable?: boolean; billed?: boolean }): Promise<TimeEntry[]>`; `approveTimeEntry(tenantId: string, timeEntryId: string): Promise<TimeEntry | null>` (atomic `UPDATE ... WHERE approval_state = 'draft' RETURNING *`, returns `null` if not currently `'draft'`); `markTimeEntriesBilled(tenantId: string, timeEntryIds: string[]): Promise<TimeEntry[]>` (atomic `UPDATE ... WHERE id = ANY(...) AND billable = true AND billed = false AND approval_state = 'approved' RETURNING *`, returns only the rows that actually matched and were updated — callers can compare the returned array's length/ids against the input to detect skipped entries).

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0022_time_entry.sql
-- Three genuinely independent facts, per research §2.3 — never collapse
-- any two of these:
--   - billable: should this time even be charged to the client? (a
--     non-billable entry, e.g. internal admin work, is still logged for
--     reporting but never appears on an invoice)
--   - billed: has an invoice already been generated for this entry? A
--     time entry can be billable-but-unbilled (the normal, common case
--     before invoicing runs) — collapsing billable/billed into one flag
--     breaks the eventual "sweep unbilled billable time into an
--     invoice" automation this table exists to support.
--   - approval_state (shared enum from 0007/0011): has this entry been
--     approved for billing at all? Per research, NetSuite bills only
--     approved entries — approval is load-bearing, not decorative.
--     Defaults 'draft' so a future Phase 5 agent-logged entry never
--     auto-approves itself.
--
-- task_id is nullable: an entry can be logged against a project
-- generally, not always tied to one specific task.
-- user_id is intentionally omitted from this phase — this project has
-- no real session-based user auth yet (only lib/auth/dev-tenant.ts's
-- dev-only tenant resolution), so there is no real user identity to
-- attach an entry to. Recorded here so the gap is visible rather than
-- silently dropped; add a user_id FK to app_user once real auth exists.
CREATE TABLE time_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_id uuid NOT NULL REFERENCES project(id),
  task_id uuid REFERENCES task(id),
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  occurred_on date NOT NULL,
  description text,
  billable boolean NOT NULL DEFAULT true,
  billed boolean NOT NULL DEFAULT false,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX time_entry_tenant_project_idx ON time_entry (tenant_id, project_id);
CREATE INDEX time_entry_tenant_billing_idx ON time_entry (tenant_id, billable, billed, approval_state);

ALTER TABLE time_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entry FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON time_entry
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON time_entry TO app_runtime;
```

- [ ] **Step 2: Write the failing test**

```typescript
// lib/erp/__tests__/time-entries.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import {
  createTimeEntry,
  getTimeEntry,
  listTimeEntries,
  approveTimeEntry,
  markTimeEntriesBilled,
} from '../time-entries';
import { createProject } from '../projects';
import { createTask } from '../tasks';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

async function setupProject(tenantId: string) {
  const contact = await createContact(tenantId, { fullName: 'Client' });
  return createProject(tenantId, { contactId: contact.id, name: 'Test Project' });
}

describe('time entry data access', () => {
  it('creates a time entry with defaults: billable=true, billed=false, approvalState=draft', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 1') RETURNING id`;
    const project = await setupProject(tenant.id);

    const entry = await createTimeEntry(tenant.id, {
      projectId: project.id,
      durationMinutes: 90,
      occurredOn: '2026-09-04',
      description: 'Homepage layout work',
    });

    expect(entry.billable).toBe(true);
    expect(entry.billed).toBe(false);
    expect(entry.approvalState).toBe('draft');
    expect(entry.taskId).toBeNull();

    const fetched = await getTimeEntry(tenant.id, entry.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.durationMinutes).toBe(90);
  });

  it('accepts an explicit billable:false and a valid taskId belonging to the same project', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 2') RETURNING id`;
    const project = await setupProject(tenant.id);
    const task = await createTask(tenant.id, { projectId: project.id, name: 'Internal review' });

    const entry = await createTimeEntry(tenant.id, {
      projectId: project.id,
      taskId: task.id,
      durationMinutes: 30,
      occurredOn: '2026-09-04',
      billable: false,
    });

    expect(entry.billable).toBe(false);
    expect(entry.taskId).toBe(task.id);
  });

  it('rejects a taskId that belongs to a different project than the one specified', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 3') RETURNING id`;
    const projectA = await setupProject(tenant.id);
    const projectB = await setupProject(tenant.id);
    const taskOnA = await createTask(tenant.id, { projectId: projectA.id, name: 'Task on A' });

    await expect(
      createTimeEntry(tenant.id, {
        projectId: projectB.id,
        taskId: taskOnA.id,
        durationMinutes: 60,
        occurredOn: '2026-09-04',
      }),
    ).rejects.toThrow();
  });

  it('rejects a projectId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 4A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 4B') RETURNING id`;
    const otherTenantProject = await setupProject(tenantB.id);

    await expect(
      createTimeEntry(tenantA.id, {
        projectId: otherTenantProject.id,
        durationMinutes: 60,
        occurredOn: '2026-09-04',
      }),
    ).rejects.toThrow();
  });

  it('listTimeEntries filters independently by billable and billed', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 5') RETURNING id`;
    const project = await setupProject(tenant.id);

    await createTimeEntry(tenant.id, { projectId: project.id, durationMinutes: 60, occurredOn: '2026-09-01', billable: true });
    await createTimeEntry(tenant.id, { projectId: project.id, durationMinutes: 30, occurredOn: '2026-09-02', billable: false });

    const billableOnly = await listTimeEntries(tenant.id, project.id, { billable: true });
    expect(billableOnly).toHaveLength(1);
    expect(billableOnly[0].billable).toBe(true);

    const all = await listTimeEntries(tenant.id, project.id);
    expect(all).toHaveLength(2);
  });

  it('approveTimeEntry moves approvalState from draft to approved, and returns null if not currently draft', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 6') RETURNING id`;
    const project = await setupProject(tenant.id);
    const entry = await createTimeEntry(tenant.id, { projectId: project.id, durationMinutes: 45, occurredOn: '2026-09-04' });

    const approved = await approveTimeEntry(tenant.id, entry.id);
    expect(approved).not.toBeNull();
    expect(approved!.approvalState).toBe('approved');

    const secondAttempt = await approveTimeEntry(tenant.id, entry.id);
    expect(secondAttempt).toBeNull();
  });

  it('markTimeEntriesBilled only updates entries that are billable, unbilled, and approved', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 7') RETURNING id`;
    const project = await setupProject(tenant.id);

    const eligible = await createTimeEntry(tenant.id, { projectId: project.id, durationMinutes: 60, occurredOn: '2026-09-01' });
    await approveTimeEntry(tenant.id, eligible.id);

    const notApproved = await createTimeEntry(tenant.id, { projectId: project.id, durationMinutes: 60, occurredOn: '2026-09-02' });

    const notBillable = await createTimeEntry(tenant.id, { projectId: project.id, durationMinutes: 60, occurredOn: '2026-09-03', billable: false });
    await approveTimeEntry(tenant.id, notBillable.id);

    const result = await markTimeEntriesBilled(tenant.id, [eligible.id, notApproved.id, notBillable.id]);

    expect(result.map((r) => r.id)).toEqual([eligible.id]);
    expect(result[0].billed).toBe(true);

    const stillUnbilled = await getTimeEntry(tenant.id, notApproved.id);
    expect(stillUnbilled!.billed).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/erp/__tests__/time-entries.test.ts`
Expected: FAIL — `lib/erp/time-entries.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/erp/time-entries.ts
import { withTenant } from '../db/with-tenant';
import { getProject } from './projects';
import { getTask } from './tasks';

export type ApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn';

export interface TimeEntry {
  id: string;
  tenantId: string;
  projectId: string;
  taskId: string | null;
  durationMinutes: number;
  occurredOn: string;
  description: string | null;
  billable: boolean;
  billed: boolean;
  approvalState: ApprovalState;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewTimeEntry {
  projectId: string;
  taskId?: string;
  durationMinutes: number;
  occurredOn: string;
  description?: string;
  billable?: boolean;
}

function rowToTimeEntry(row: any): TimeEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    taskId: row.task_id,
    durationMinutes: row.duration_minutes,
    occurredOn: row.occurred_on instanceof Date ? row.occurred_on.toISOString().slice(0, 10) : row.occurred_on,
    description: row.description,
    billable: row.billable,
    billed: row.billed,
    approvalState: row.approval_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createTimeEntry(tenantId: string, input: NewTimeEntry): Promise<TimeEntry> {
  const project = await getProject(tenantId, input.projectId);
  if (!project) {
    throw new Error(`Invalid project reference: ${input.projectId} does not belong to this tenant`);
  }

  if (input.taskId) {
    const task = await getTask(tenantId, input.taskId);
    if (!task) {
      throw new Error(`Invalid task reference: ${input.taskId} does not belong to this tenant`);
    }
    if (task.projectId !== input.projectId) {
      throw new Error(`Task ${input.taskId} belongs to a different project than ${input.projectId}`);
    }
  }

  const billable = input.billable ?? true;

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO time_entry (tenant_id, project_id, task_id, duration_minutes, occurred_on, description, billable)
      VALUES (${tenantId}, ${input.projectId}, ${input.taskId ?? null}, ${input.durationMinutes}, ${input.occurredOn}, ${input.description ?? null}, ${billable})
      RETURNING *
    `;
    return rowToTimeEntry(row);
  });
}

export async function getTimeEntry(tenantId: string, id: string): Promise<TimeEntry | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM time_entry WHERE id = ${id}`;
    return rows.length > 0 ? rowToTimeEntry(rows[0]) : null;
  });
}

export async function listTimeEntries(
  tenantId: string,
  projectId: string,
  filter?: { billable?: boolean; billed?: boolean },
): Promise<TimeEntry[]> {
  return withTenant(tenantId, async (tx) => {
    let rows;
    if (filter?.billable !== undefined && filter?.billed !== undefined) {
      rows = await tx`SELECT * FROM time_entry WHERE project_id = ${projectId} AND billable = ${filter.billable} AND billed = ${filter.billed} ORDER BY occurred_on ASC`;
    } else if (filter?.billable !== undefined) {
      rows = await tx`SELECT * FROM time_entry WHERE project_id = ${projectId} AND billable = ${filter.billable} ORDER BY occurred_on ASC`;
    } else if (filter?.billed !== undefined) {
      rows = await tx`SELECT * FROM time_entry WHERE project_id = ${projectId} AND billed = ${filter.billed} ORDER BY occurred_on ASC`;
    } else {
      rows = await tx`SELECT * FROM time_entry WHERE project_id = ${projectId} ORDER BY occurred_on ASC`;
    }
    return rows.map(rowToTimeEntry);
  });
}

export async function approveTimeEntry(tenantId: string, timeEntryId: string): Promise<TimeEntry | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE time_entry
      SET approval_state = 'approved', updated_at = now()
      WHERE id = ${timeEntryId} AND approval_state = 'draft'
      RETURNING *
    `;
    return rows.length > 0 ? rowToTimeEntry(rows[0]) : null;
  });
}

export async function markTimeEntriesBilled(tenantId: string, timeEntryIds: string[]): Promise<TimeEntry[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE time_entry
      SET billed = true, updated_at = now()
      WHERE id = ANY(${timeEntryIds}) AND billable = true AND billed = false AND approval_state = 'approved'
      RETURNING *
    `;
    return rows.map(rowToTimeEntry);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/erp/__tests__/time-entries.test.ts`
Expected: PASS (7/7 tests)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0022_time_entry.sql lib/erp/time-entries.ts lib/erp/__tests__/time-entries.test.ts
git commit -m "feat: add time_entry table with independent billable/billed/approval states

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Full-Suite Verification

**Files:** none created or modified — verification only.

**Interfaces:** N/A.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every existing test (Phases 1A/2A/2B/3A-1/3A-2/3A-3, unchanged) plus all new `lib/erp/__tests__/{projects,tasks,time-entries}.test.ts` files and the RLS audit test (now covering 3 additional tables: `project`, `task`, `time_entry`) pass with zero failures.

- [ ] **Step 2: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify no table-name or migration-number collisions**

Run: `ls db/migrations/*.sql`
Expected: exactly 22 files, numbered 0001 through 0022 with no gaps or duplicates, and the three new ones (0020–0022) match the table names in this plan (`project`, `task`, `time_entry`) with no collision against any existing table.

- [ ] **Step 4: Commit (only if Steps 1–2 required any fixes)**

```bash
git add -A
git commit -m "chore: verify phase 3a-4 full suite and type check

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

If Steps 1–2 pass with no changes needed, skip this commit — there's nothing new to commit.
