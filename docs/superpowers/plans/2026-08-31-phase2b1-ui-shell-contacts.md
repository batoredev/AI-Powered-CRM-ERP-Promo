# Phase 2B-1: UI Shell, Design Tokens, and Contact Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared UI shell (layout, navigation, design tokens) and the contact list/detail views — the first real user-facing screens in the product, establishing the visual and structural patterns Phase 2B-2 (pipeline board) and all later UI phases will follow.

**Architecture:** Next.js App Router with React Server Components for data fetching (no client-side fetch layer needed yet — server components call `lib/crm/contacts.ts` directly). Styling via CSS Modules over a small CSS custom-properties design-token system (`app/tokens.css`) — zero framework dependency, full control over visual quality, consistent spacing/color/type across every component from day one. Since no auth UI exists yet (Phase 1A built JWT issuance but no login page), this phase introduces a single, clearly-labeled dev-only tenant resolution function that later phases will replace with real session-based auth — never silently assumed, always visible in the code and UI.

**Tech Stack:** Next.js 15 (App Router, Server Components), CSS Modules, TypeScript strict mode, Vitest + React Testing Library for component tests (new dependency this phase — no component tests exist yet, only backend tests).

**Spec:** `docs/superpowers/specs/2026-08-29-ai-crm-erp-platform-design.md` (§1a's complexity/UI research, §7b onboarding principles apply in spirit even though onboarding itself is a later phase). Companion: `docs/superpowers/specs/2026-08-29-execution-team-structure.md` (§6a standing UI principle: user-friendly and efficient over impressive — complexity is the #1 reason CRMs get abandoned, per the spec's own research).

## Global Constraints

- **User-friendly and efficient over impressive** (execution team doc §6a) — every screen must be usable without explanation, fast to load, and uncluttered. Visual polish serves clarity; it never substitutes for it.
- **No silent auth.** The dev-tenant mechanism built in Task 1 must be named and commented unambiguously as a temporary development stand-in — a `DEV_TENANT_ID` constant with a loud comment, never disguised as real auth.
- **TypeScript strict mode**, no `any` in new application code (existing `any` in `lib/crm/*.ts`'s row mappers is out of scope — don't touch it).
- **Every new tenant-scoped data read goes through the existing `lib/crm/contacts.ts` functions** — this UI phase never writes new SQL or bypasses the data-access layer.
- **No secrets in code or committed to git.**
- **Every task ends with passing tests before moving to the next task.**
- **Test cleanup discipline**: any test that creates database rows must clean them up in `afterAll`/`afterEach`, scoped precisely to what it created — this project has twice found and fixed real bugs from tests that didn't (Phase 1A, Phase 2A Task 2). Component tests in this phase should prefer mocking `lib/crm/contacts.ts` over hitting the real database where practical, to avoid adding to that surface area — but where a test does need real data, the same discipline applies.

---

## Task 1: Dev-Tenant Resolution (explicit, temporary, well-labeled)

**Files:**
- Create: `lib/auth/dev-tenant.ts`
- Test: `lib/auth/__tests__/dev-tenant.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getDevTenantId(): Promise<string>` — resolves (creating if necessary) a single well-known development tenant row, returning its id. Every server component in this phase calls this instead of any real session mechanism. Later phases (real auth) will replace all call sites of this function with a session-derived tenant id — grep-able by function name for that migration.

- [ ] **Step 1: Write the failing test**

`lib/auth/__tests__/dev-tenant.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest';
import postgres from 'postgres';
import { getDevTenantId } from '../dev-tenant';

const setupSql = postgres(process.env.DATABASE_URL!);

describe('getDevTenantId', () => {
  afterAll(async () => {
    await setupSql.end();
  });

  it('returns a valid tenant id that exists in the database', async () => {
    const tenantId = await getDevTenantId();
    expect(tenantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const rows = await setupSql`SELECT id FROM tenant WHERE id = ${tenantId}`;
    expect(rows).toHaveLength(1);
  });

  it('returns the same tenant id on repeated calls (idempotent)', async () => {
    const first = await getDevTenantId();
    const second = await getDevTenantId();
    expect(first).toBe(second);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/auth/__tests__/dev-tenant.test.ts`
Expected: FAILs — `../dev-tenant` doesn't exist yet.

- [ ] **Step 3: Implement dev-tenant resolution**

**Amendment (execution ruling, Task 1):** the code below originally used
`getSql()` (the `app_runtime` role) to read/write `tenant`. This does not
work: `tenant` has RLS enabled with deliberately no policy (see
`db/migrations/0002_tenant_user_role.sql`'s own comment — tenant rows are
reachable only via explicit application logic, never via `app_runtime`
scoping), and `app_runtime` is `NOBYPASSRLS` by design (spec §3). Verified
directly against the live database: `SELECT` returns 0 rows silently,
`INSERT` throws an RLS-violation error. This function instead opens its
own connection using `DATABASE_URL` (the Neon owner credential, already
used by this task's own test file) — the correct behavior for a
signup/admin-class operation, which is inherently privileged and
un-tenant-scoped, not a data-access bug. Also adds a `NODE_ENV`
production guard so this dev-only path can never silently run in a
deployed environment.

`lib/auth/dev-tenant.ts`:
```typescript
import postgres from 'postgres';

/**
 * ⚠️⚠️⚠️ DEVELOPMENT-ONLY TENANT RESOLUTION — NOT REAL AUTH ⚠️⚠️⚠️
 * ================================================================
 *
 * This function exists solely because Phase 2B builds UI before Phase 6
 * (guided onboarding) or a real session/login system exists. It resolves
 * (creating on first call) a single well-known "Development Tenant" row
 * and returns its id, so UI screens have a tenant to render data for.
 *
 * This is NOT a security boundary and NEVER should be treated as one —
 * it does not check who is asking. Every call site of this function is a
 * marker for what must be replaced with real session-derived tenant
 * resolution (e.g. from a verified JWT via lib/auth/jwt.ts, once a login
 * flow exists) before this product handles real user data. Grep for
 * `getDevTenantId` when that work begins.
 *
 * WHY THIS DOES NOT USE lib/db/connection.ts's getSql() (app_runtime):
 * `tenant` has RLS enabled with deliberately NO policy — tenant rows are
 * reachable only via explicit application logic (signup, admin), never
 * via the app_runtime role, which is NOBYPASSRLS by design (spec §3).
 * This function opens its OWN connection using DATABASE_URL (the Neon
 * owner credential, dev-environment only) — the same variable this
 * task's test file connects with directly. This is exactly the kind of
 * privileged, un-tenant-scoped access real signup/admin code will
 * eventually need — but until that code exists, THIS is the one place in
 * the app that reaches around app_runtime, and it must stay that way: do
 * not reuse this connection or this pattern for anything else. When real
 * auth lands, this whole file is deleted, not generalized.
 */
const DEV_TENANT_NAME = 'Development Tenant';

let cachedDevTenantId: string | null = null;
let devSqlInstance: postgres.Sql | null = null;

function getDevSql(): postgres.Sql {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'getDevTenantId() must never run in production — this dev-only tenant ' +
      'bootstrap path uses privileged database access with no auth check. ' +
      'If you are seeing this in production, a call site was not migrated ' +
      'to real auth before deploy.'
    );
  }
  if (!devSqlInstance) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set (required by dev-only getDevTenantId)');
    }
    devSqlInstance = postgres(url, { max: 1 });
  }
  return devSqlInstance;
}

export async function getDevTenantId(): Promise<string> {
  if (cachedDevTenantId) return cachedDevTenantId;

  const sql = getDevSql();
  const existing = await sql`SELECT id FROM tenant WHERE name = ${DEV_TENANT_NAME}`;
  if (existing.length > 0) {
    cachedDevTenantId = existing[0].id;
    return cachedDevTenantId!;
  }

  const [created] = await sql`INSERT INTO tenant (name) VALUES (${DEV_TENANT_NAME}) RETURNING id`;
  cachedDevTenantId = created.id;
  return cachedDevTenantId!;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/auth/__tests__/dev-tenant.test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/dev-tenant.ts lib/auth/__tests__/dev-tenant.test.ts
git commit -m "feat: add explicit dev-only tenant resolution for pre-auth UI phases"
```

---

## Task 2: Design Tokens

**Files:**
- Create: `app/tokens.css`

**Interfaces:**
- Produces: CSS custom properties (`--color-*`, `--space-*`, `--font-*`, `--radius-*`) that every component's CSS Module references. This is the single source of visual truth — no component hardcodes a raw color or spacing value.

- [ ] **Step 1: Write the token file**

`app/tokens.css`:
```css
:root {
  /* Color — light, calm, high-contrast-enough for daily use, not flashy */
  --color-bg: #ffffff;
  --color-bg-subtle: #f7f8fa;
  --color-border: #e2e5e9;
  --color-text: #1a1d21;
  --color-text-muted: #6b7280;
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-primary-contrast: #ffffff;
  --color-danger: #dc2626;
  --color-success: #16a34a;

  /* Spacing scale — 4px base */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-8: 48px;

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-size-sm: 13px;
  --font-size-base: 15px;
  --font-size-lg: 18px;
  --font-size-xl: 24px;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  /* Shape */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Shadow — used sparingly, for cards and overlays only */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #16181c;
    --color-bg-subtle: #1e2126;
    --color-border: #2c3038;
    --color-text: #f0f1f3;
    --color-text-muted: #9aa1ac;
    --color-primary: #3b82f6;
    --color-primary-hover: #60a5fa;
    --color-primary-contrast: #0b0d10;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--font-size-base);
  color: var(--color-text);
  background: var(--color-bg);
}
```

- [ ] **Step 2: No test needed** (pure CSS, verified visually in Task 3 once it's wired into layout)

- [ ] **Step 3: Commit**

```bash
git add app/tokens.css
git commit -m "feat: add design token system (colors, spacing, type, light/dark)"
```

---

## Task 3: Shared UI Shell (layout + navigation)

**Files:**
- Modify: `app/layout.tsx`
- Create: `app/shell.module.css`
- Create: `app/components/AppShell.tsx`

**Interfaces:**
- Consumes: `app/tokens.css` (Task 2).
- Produces: `<AppShell>` — a client-independent server component wrapping every page with a left navigation sidebar (Contacts, Pipeline — Pipeline's route is built in 2B-2 but the nav link is added now since the shell only needs building once) and a main content area. Later pages render `{children}` inside this shell via the root layout.

- [ ] **Step 1: Write the shell component**

`app/components/AppShell.tsx`:
```typescript
import Link from 'next/link';
import styles from '../shell.module.css';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar}>
        <div className={styles.logo}>AI CRM+ERP</div>
        <Link href="/contacts" className={styles.navLink}>
          Contacts
        </Link>
        <Link href="/pipeline" className={styles.navLink}>
          Pipeline
        </Link>
      </nav>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Write the shell styles**

`app/shell.module.css`:
```css
.shell {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--color-bg-subtle);
  border-right: 1px solid var(--color-border);
  padding: var(--space-5) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.logo {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  margin-bottom: var(--space-5);
  color: var(--color-text);
}

.navLink {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  text-decoration: none;
  font-weight: var(--font-weight-medium);
  transition: background 0.12s ease, color 0.12s ease;
}

.navLink:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.content {
  flex: 1;
  padding: var(--space-6) var(--space-8);
  max-width: 1100px;
}
```

- [ ] **Step 3: Wire the shell and tokens into the root layout**

`app/layout.tsx` (full replacement):
```typescript
import type { Metadata } from "next";
import { AppShell } from "./components/AppShell";
import "./tokens.css";

export const metadata: Metadata = {
  title: "AI CRM+ERP Platform",
  description: "AI-powered multi-tenant CRM and ERP platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify the dev server renders correctly**

Run: `npm run dev`, open `http://localhost:3000` in a browser (or use `curl http://localhost:3000` to confirm HTML renders without error if no browser is available).
Expected: page loads with no errors; the sidebar with "Contacts" and "Pipeline" links is visible. Stop the dev server once confirmed.

- [ ] **Step 5: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx app/shell.module.css app/components/AppShell.tsx
git commit -m "feat: add shared app shell with navigation sidebar"
```

---

## Task 4: Contact List Page

**Files:**
- Create: `app/contacts/page.tsx`
- Create: `app/contacts/page.module.css`
- Install: `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` as dev dependencies (first component test in the project)
- Modify: `vitest.config.ts` (add a jsdom environment for component tests — see Step 1)
- Test: `app/contacts/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `listContacts(tenantId)` from `lib/crm/contacts.ts` (Phase 2A), `getDevTenantId()` from Task 1.
- Produces: the `/contacts` route — a server component that lists all contacts for the dev tenant in a clean table, with a link to each contact's detail page (`/contacts/[id]`, built in Task 5) and an empty-state message when there are zero contacts (a new tenant should never see a blank confusing page — this is the "user-friendly" principle in concrete form).

- [ ] **Step 1: Install component testing dependencies and configure a jsdom project**

Run: `npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom`

Vitest needs two environments in this project now: `node` for the existing backend tests (they hit a real Postgres connection, which doesn't work well under jsdom) and `jsdom` for component tests. Read the current `vitest.config.ts` first, then update it to use a `projects` (or `workspace`, depending on the installed Vitest version — check `node_modules/vitest/package.json` for the major version and use whichever config shape that version documents) setup: one project for `db/**` and `lib/**/*.test.ts` (node environment, unchanged from today), one new project for `app/**/*.test.tsx` (jsdom environment). If you're unsure of the exact config API for the installed Vitest version, check `node_modules/vitest/dist/node.d.ts` or the package's own docs rather than guessing — get this right, since a wrong config either breaks existing tests or silently doesn't run new ones.

- [ ] **Step 2: Write the failing component test**

`app/contacts/__tests__/page.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('../../../lib/crm/contacts', () => ({
  listContacts: vi.fn(),
}));
vi.mock('../../../lib/auth/dev-tenant', () => ({
  getDevTenantId: vi.fn().mockResolvedValue('11111111-1111-1111-1111-111111111111'),
}));

import { listContacts } from '../../../lib/crm/contacts';
import ContactsPage from '../page';

describe('ContactsPage', () => {
  it('renders a table of contacts when there are some', async () => {
    (listContacts as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'c1',
        tenantId: 't1',
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phone: null,
        company: 'Acme Inc',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const ui = await ContactsPage();
    render(ui);

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Acme Inc')).toBeInTheDocument();
  });

  it('renders a friendly empty state when there are no contacts', async () => {
    (listContacts as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const ui = await ContactsPage();
    render(ui);

    expect(screen.getByText(/no contacts yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run app/contacts/__tests__/page.test.tsx`
Expected: FAILs — `../page` (the `ContactsPage` component) doesn't exist yet.

- [ ] **Step 4: Implement the contact list page**

`app/contacts/page.tsx`:
```typescript
import Link from 'next/link';
import { listContacts } from '../../lib/crm/contacts';
import { getDevTenantId } from '../../lib/auth/dev-tenant';
import styles from './page.module.css';

export default async function ContactsPage() {
  const tenantId = await getDevTenantId();
  const contacts = await listContacts(tenantId);

  return (
    <div>
      <h1 className={styles.heading}>Contacts</h1>
      {contacts.length === 0 ? (
        <p className={styles.emptyState}>No contacts yet. Add your first contact to get started.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <td>
                  <Link href={`/contacts/${contact.id}`} className={styles.contactLink}>
                    {contact.fullName}
                  </Link>
                </td>
                <td>{contact.email ?? '—'}</td>
                <td>{contact.company ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write the page styles**

`app/contacts/page.module.css`:
```css
.heading {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  margin: 0 0 var(--space-5) 0;
}

.emptyState {
  color: var(--color-text-muted);
  padding: var(--space-6);
  text-align: center;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table th {
  text-align: left;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-muted);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.table td {
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.contactLink {
  color: var(--color-primary);
  text-decoration: none;
  font-weight: var(--font-weight-medium);
}

.contactLink:hover {
  text-decoration: underline;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run app/contacts/__tests__/page.test.tsx`
Expected: both tests PASS.

- [ ] **Step 7: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts app/contacts/page.tsx app/contacts/page.module.css app/contacts/__tests__/page.test.tsx
git commit -m "feat: add contact list page with empty state"
```

---

## Task 5: Contact Detail Page + Create Contact Form

**Files:**
- Create: `app/contacts/[id]/page.tsx`
- Create: `app/contacts/[id]/page.module.css`
- Create: `app/contacts/new/page.tsx`
- Create: `app/contacts/new/actions.ts`
- Create: `app/contacts/new/page.module.css`
- Test: `app/contacts/[id]/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `getContact(tenantId, id)`, `createContact(tenantId, input)` from `lib/crm/contacts.ts`; `getDevTenantId()` from Task 1.
- Produces: `/contacts/[id]` detail view; `/contacts/new` creation form using a Next.js Server Action (`createContactAction`) — no client-side fetch/API route needed, keeping this simple per the "efficient, not overbuilt" principle.

- [ ] **Step 1: Write the failing detail-page test**

`app/contacts/[id]/__tests__/page.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('../../../../lib/crm/contacts', () => ({
  getContact: vi.fn(),
}));
vi.mock('../../../../lib/auth/dev-tenant', () => ({
  getDevTenantId: vi.fn().mockResolvedValue('11111111-1111-1111-1111-111111111111'),
}));

import { getContact } from '../../../../lib/crm/contacts';
import ContactDetailPage from '../page';

describe('ContactDetailPage', () => {
  it('renders the contact\'s details when found', async () => {
    (getContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '555-1234',
      company: 'Acme Inc',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ui = await ContactDetailPage({ params: Promise.resolve({ id: 'c1' }) });
    render(ui);

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('555-1234')).toBeInTheDocument();
  });

  it('renders a not-found message when the contact does not exist', async () => {
    (getContact as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const ui = await ContactDetailPage({ params: Promise.resolve({ id: 'missing' }) });
    render(ui);

    expect(screen.getByText(/contact not found/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/contacts/[id]/__tests__/page.test.tsx"`
Expected: FAILs — `../page` doesn't exist yet.

- [ ] **Step 3: Implement the detail page**

`app/contacts/[id]/page.tsx`:
```typescript
import { getContact } from '../../../lib/crm/contacts';
import { getDevTenantId } from '../../../lib/auth/dev-tenant';
import styles from './page.module.css';

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantId = await getDevTenantId();
  const contact = await getContact(tenantId, id);

  if (!contact) {
    return <p className={styles.notFound}>Contact not found.</p>;
  }

  return (
    <div>
      <h1 className={styles.name}>{contact.fullName}</h1>
      <dl className={styles.details}>
        <dt>Email</dt>
        <dd>{contact.email ?? '—'}</dd>
        <dt>Phone</dt>
        <dd>{contact.phone ?? '—'}</dd>
        <dt>Company</dt>
        <dd>{contact.company ?? '—'}</dd>
      </dl>
    </div>
  );
}
```

- [ ] **Step 4: Write the detail page styles**

`app/contacts/[id]/page.module.css`:
```css
.name {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  margin: 0 0 var(--space-5) 0;
}

.details {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--space-2) var(--space-4);
}

.details dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.details dd {
  margin: 0;
}

.notFound {
  color: var(--color-text-muted);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run "app/contacts/[id]/__tests__/page.test.tsx"`
Expected: both tests PASS.

- [ ] **Step 6: Implement the create-contact Server Action**

`app/contacts/new/actions.ts`:
```typescript
'use server';

import { redirect } from 'next/navigation';
import { createContact } from '../../../lib/crm/contacts';
import { getDevTenantId } from '../../../lib/auth/dev-tenant';

export async function createContactAction(formData: FormData) {
  const fullName = formData.get('fullName');
  if (typeof fullName !== 'string' || fullName.trim().length === 0) {
    throw new Error('Full name is required');
  }

  const tenantId = await getDevTenantId();
  const email = formData.get('email');
  const phone = formData.get('phone');
  const company = formData.get('company');

  const contact = await createContact(tenantId, {
    fullName: fullName.trim(),
    email: typeof email === 'string' && email.trim() ? email.trim() : undefined,
    phone: typeof phone === 'string' && phone.trim() ? phone.trim() : undefined,
    company: typeof company === 'string' && company.trim() ? company.trim() : undefined,
  });

  redirect(`/contacts/${contact.id}`);
}
```

- [ ] **Step 7: Implement the create-contact form page**

`app/contacts/new/page.tsx`:
```typescript
import { createContactAction } from './actions';
import styles from './page.module.css';

export default function NewContactPage() {
  return (
    <div>
      <h1 className={styles.heading}>New Contact</h1>
      <form action={createContactAction} className={styles.form}>
        <label className={styles.field}>
          <span>Full name</span>
          <input type="text" name="fullName" required autoFocus />
        </label>
        <label className={styles.field}>
          <span>Email</span>
          <input type="email" name="email" />
        </label>
        <label className={styles.field}>
          <span>Phone</span>
          <input type="tel" name="phone" />
        </label>
        <label className={styles.field}>
          <span>Company</span>
          <input type="text" name="company" />
        </label>
        <button type="submit" className={styles.submit}>
          Create Contact
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 8: Write the new-contact page styles**

`app/contacts/new/page.module.css`:
```css
.heading {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  margin: 0 0 var(--space-5) 0;
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 400px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.field input {
  font-size: var(--font-size-base);
  font-family: var(--font-sans);
  color: var(--color-text);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
}

.field input:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: -1px;
}

.submit {
  align-self: flex-start;
  padding: var(--space-2) var(--space-5);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--color-primary-contrast);
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.12s ease;
}

.submit:hover {
  background: var(--color-primary-hover);
}
```

- [ ] **Step 9: Add a link to the "new contact" page from the contact list**

Modify `app/contacts/page.tsx` — add near the top of the returned JSX, right after the `<h1>`:
```typescript
<Link href="/contacts/new" className={styles.newButton}>
  + New Contact
</Link>
```
And add to `app/contacts/page.module.css`:
```css
.newButton {
  display: inline-block;
  margin-bottom: var(--space-4);
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-primary-contrast);
  background: var(--color-primary);
  border-radius: var(--radius-md);
  text-decoration: none;
}

.newButton:hover {
  background: var(--color-primary-hover);
}
```

- [ ] **Step 10: Manual verification of the full create-contact flow**

Run: `npm run dev`. Navigate to `/contacts`, click "+ New Contact", fill in the form, submit. Expected: redirected to the new contact's detail page, showing the entered data. (If no browser is available in this environment, verify via `curl`/`fetch`-based checks of the rendered HTML at each step instead — note in your report which method you used.)

- [ ] **Step 11: Run `tsc --noEmit` and the full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean — `tsc` no errors, all tests (backend + new component tests) passing.

- [ ] **Step 12: Commit**

```bash
git add app/contacts/
git commit -m "feat: add contact detail page and create-contact form"
```

---

## Self-Review Notes (per writing-plans skill requirement)

**Spec coverage check** against this sub-plan's scope (contact management UI + shared shell):
- Contact list view → Task 4 ✓
- Contact detail view → Task 5 ✓
- Contact creation → Task 5 ✓
- User-friendly/efficient principle (execution team doc §6a) → empty state (Task 4), clean forms with labels (Task 5), no unnecessary client-side JS (Server Actions, Server Components throughout) ✓
- Explicit, non-silent dev-auth stand-in → Task 1, with loud comments and a documented replacement path ✓
- Design tokens / visual coherence → Task 2, referenced by every component's CSS Module ✓

**Out of scope for this sub-plan** (belongs to Phase 2B-2 or later): pipeline/Kanban board, contact editing/deletion (only create + view built here — YAGNI, not needed to prove the pattern), real authentication.

**Type consistency check:** `Contact`/`NewContact` types (Phase 2A, `lib/crm/contacts.ts`) used verbatim in Tasks 4-5, no redeclaration. `getDevTenantId(): Promise<string>` (Task 1) signature consistent across every call site (Tasks 4, 5).

**Placeholder scan:** no TBD/TODO/"handle appropriately" found — every step has concrete code. The one deliberately-flagged "temporary" piece (dev-tenant resolution) is flagged as a design decision with a clear replacement path, not a placeholder.
