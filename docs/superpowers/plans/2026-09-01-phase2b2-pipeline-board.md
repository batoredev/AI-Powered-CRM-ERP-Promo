# Phase 2B-2: Pipeline Kanban Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Kanban-style pipeline board at `/pipeline` that shows every deal grouped into columns by pipeline stage, lets a user move a deal to a different stage, and gives a brand-new tenant with zero pipeline data a clear way to get started.

**Architecture:** A Server Component page (`app/pipeline/page.tsx`) fetches `listPipelineStages` + `listDealsByStage` via `getDevTenantId()` (same pattern as `app/contacts/page.tsx`) and renders one column per stage. Each deal card is rendered by a small Client Component (`DealCard`) containing a native `<select>` that, on change, calls a Server Action (`moveDealAction`) wrapping `moveDealToStage`. This is the only interactive/client piece; everything else stays a Server Component, consistent with Phase 2B-1's approach and extending it minimally.

**Tech Stack:** Next.js 15 App Router (Server Components + Server Actions), React Client Component for the one interactive element, CSS Modules against `app/tokens.css`, Vitest + React Testing Library (jsdom project) for component tests.

**Spec:** `docs/superpowers/specs/2026-08-29-ai-crm-erp-platform-design.md` (§8 data model, §9 roadmap Phase 2 Core CRM); execution conventions from `docs/superpowers/specs/2026-08-29-execution-team-structure.md` §6a ("user-friendly and efficient over impressive").

## Global Constraints

- No new npm dependencies. Zero-dependency interaction pattern only (see Task 3's design decision).
- Every color/spacing/typography value in new CSS must reference an existing token from `app/tokens.css` — no hardcoded values, no new tokens invented.
- Tenant resolution goes through `getDevTenantId()` from `lib/auth/dev-tenant.ts` exactly as `app/contacts/page.tsx` does — never call `getSql()`/`lib/db/connection.ts` directly, never bypass `withTenant()`.
- All new backend calls go through `lib/crm/deals.ts`'s existing exports (`listPipelineStages`, `listDealsByStage`, `moveDealToStage`) — no new deals.ts functions needed for this phase, no schema changes.
- Component tests live under `app/pipeline/__tests__/*.test.tsx`, run by the jsdom `components` Vitest project (`vitest.config.ts`); mock `lib/crm/deals.ts` and `lib/auth/dev-tenant.ts` the same way `app/contacts/__tests__/page.test.tsx` does — do not hit the real database from component tests.
- TDD: write the failing test before the implementation in every task that has one.
- Test-isolation discipline: any test that queries shared state must scope by tenant/id explicitly — never rely on being "the only test" creating a given row (see Phase 2A's `pipeline_stage` bug class).
- `npx tsc --noEmit` must stay clean after every task.

---

## Design decision: how a user moves a deal between stages

**Chosen pattern: a native `<select>` dropdown per deal card, listing every pipeline stage, defaulting to the deal's current stage.** Changing the selection fires a Server Action that calls `moveDealToStage`.

Justification against "user-friendly and efficient over impressive" (execution team doc §6a):
- **Zero new dependencies.** Drag-and-drop needs a library (`@dnd-kit/core`, `react-beautiful-dnd`, or hand-rolled HTML5 DnD with a lot of edge-case handling for touch, keyboard, and cross-column drop zones). A `<select>` needs none of that.
- **Natively accessible.** A `<select>` is keyboard-operable and screen-reader-friendly out of the box. Drag-and-drop requires deliberate extra work (ARIA live regions, keyboard-alternative controls) to reach the same bar — work this phase would otherwise have to redo the select's behavior anyway as a fallback.
- **Identical behavior on mobile and desktop.** Drag-and-drop on touch screens is notoriously fiddly (scroll vs. drag conflicts, imprecise drop targets). A dropdown works the same everywhere.
- **Simpler to test.** A select's `onChange` is a single deterministic event; drag gesture simulation in jsdom/RTL is unreliable and typically requires end-to-end tooling this project doesn't have yet.
- Moving a deal is a low-frequency, deliberate action (not a rapid bulk-sort operation), so the marginal "feel" gain from drag-and-drop doesn't offset its cost here.

---

## Task 1: Pipeline Page Skeleton — Stage Columns, No Deals Yet

**Files:**
- Create: `app/pipeline/page.tsx`
- Create: `app/pipeline/page.module.css`
- Create: `app/pipeline/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `listPipelineStages(tenantId: string): Promise<PipelineStage[]>` and `listDealsByStage(tenantId: string): Promise<Record<string, Deal[]>>` from `lib/crm/deals.ts` (`PipelineStage` has `id`, `tenantId`, `name`, `sortOrder`; `Deal` has `id`, `tenantId`, `contactId`, `pipelineStageId`, `title`, `valueMinorUnits`, `currencyCode`, `createdAt`, `updatedAt`). `getDevTenantId(): Promise<string>` from `lib/auth/dev-tenant.ts`.
- Produces: the `PipelineBoard`-shaped page itself. Task 2 adds the empty state inside this same file. Task 3 replaces the plain deal-title rendering added here with the `DealCard` client component.

- [ ] **Step 1: Write the failing test**

```tsx
// app/pipeline/__tests__/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('../../../lib/crm/deals', () => ({
  listPipelineStages: vi.fn(),
  listDealsByStage: vi.fn(),
}));
vi.mock('../../../lib/auth/dev-tenant', () => ({
  getDevTenantId: vi.fn().mockResolvedValue('11111111-1111-1111-1111-111111111111'),
}));

import { listPipelineStages, listDealsByStage } from '../../../lib/crm/deals';
import PipelinePage from '../page';

describe('PipelinePage', () => {
  it('renders one column per pipeline stage, in sortOrder', async () => {
    (listPipelineStages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 's1', tenantId: 't1', name: 'Lead', sortOrder: 0 },
      { id: 's2', tenantId: 't1', name: 'Qualified', sortOrder: 1 },
    ]);
    (listDealsByStage as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const ui = await PipelinePage();
    render(ui);

    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(['Lead', 'Qualified']);
  });

  it('renders deals inside their matching stage column', async () => {
    (listPipelineStages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 's1', tenantId: 't1', name: 'Lead', sortOrder: 0 },
      { id: 's2', tenantId: 't1', name: 'Qualified', sortOrder: 1 },
    ]);
    (listDealsByStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      s1: [
        {
          id: 'd1',
          tenantId: 't1',
          contactId: 'c1',
          pipelineStageId: 's1',
          title: 'Acme Renewal',
          valueMinorUnits: 500000,
          currencyCode: 'USD',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    const ui = await PipelinePage();
    render(ui);

    expect(screen.getByText('Acme Renewal')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/pipeline/__tests__/page.test.tsx`
Expected: FAIL — `app/pipeline/page.tsx` does not exist yet (module not found).

- [ ] **Step 3: Write the page and its styles**

```tsx
// app/pipeline/page.tsx
import { listDealsByStage, listPipelineStages } from '../../lib/crm/deals';
import { getDevTenantId } from '../../lib/auth/dev-tenant';
import styles from './page.module.css';

export default async function PipelinePage() {
  const tenantId = await getDevTenantId();
  const [stages, dealsByStage] = await Promise.all([
    listPipelineStages(tenantId),
    listDealsByStage(tenantId),
  ]);

  return (
    <div>
      <h1 className={styles.heading}>Pipeline</h1>
      <div className={styles.board}>
        {stages.map((stage) => {
          const deals = dealsByStage[stage.id] ?? [];
          return (
            <section key={stage.id} className={styles.column}>
              <h2 className={styles.columnHeading}>{stage.name}</h2>
              <div className={styles.cardList}>
                {deals.map((deal) => (
                  <div key={deal.id} className={styles.card}>
                    <p className={styles.cardTitle}>{deal.title}</p>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
```

```css
/* app/pipeline/page.module.css */
.heading {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  margin: 0 0 var(--space-5) 0;
}

.board {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
  overflow-x: auto;
}

.column {
  flex: 0 0 260px;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.columnHeading {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  margin: 0;
  padding: 0 var(--space-1);
}

.cardList {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 40px;
}

.card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  box-shadow: var(--shadow-sm);
}

.cardTitle {
  margin: 0 0 var(--space-2) 0;
  font-weight: var(--font-weight-medium);
  font-size: var(--font-size-sm);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/pipeline/__tests__/page.test.tsx`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add app/pipeline/page.tsx app/pipeline/page.module.css app/pipeline/__tests__/page.test.tsx
git commit -m "feat: add pipeline board skeleton with stage columns"
```

---

## Task 2: Empty State for a Brand-New Tenant

**Files:**
- Modify: `app/pipeline/page.tsx`
- Modify: `app/pipeline/page.module.css`
- Modify: `app/pipeline/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: same as Task 1. A tenant with zero pipeline stages (`listPipelineStages` returns `[]`) is the empty-state trigger — matching Phase 2B-1's contacts empty state, which triggers off `listContacts` returning `[]`.
- Produces: no new exports; this task only adds a conditional render branch to the same default export.

- [ ] **Step 1: Write the failing test**

Add to `app/pipeline/__tests__/page.test.tsx`:

```tsx
  it('renders a friendly empty state when there are no pipeline stages yet', async () => {
    (listPipelineStages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listDealsByStage as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const ui = await PipelinePage();
    render(ui);

    expect(screen.getByText(/no pipeline stages yet/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/pipeline/__tests__/page.test.tsx`
Expected: FAIL — no empty-state text is rendered; the board section renders empty with no matching text.

- [ ] **Step 3: Add the empty-state branch**

Replace the `<div className={styles.board}>...</div>` block in `app/pipeline/page.tsx` with:

```tsx
      {stages.length === 0 ? (
        <p className={styles.emptyState}>
          No pipeline stages yet. Pipeline stages and deals are created as you add them — check back once your first deal exists.
        </p>
      ) : (
        <div className={styles.board}>
          {stages.map((stage) => {
            const deals = dealsByStage[stage.id] ?? [];
            return (
              <section key={stage.id} className={styles.column}>
                <h2 className={styles.columnHeading}>{stage.name}</h2>
                <div className={styles.cardList}>
                  {deals.map((deal) => (
                    <div key={deal.id} className={styles.card}>
                      <p className={styles.cardTitle}>{deal.title}</p>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
```

Add to `app/pipeline/page.module.css` (same visual pattern as `app/contacts/page.module.css`'s `.emptyState`):

```css
.emptyState {
  color: var(--color-text-muted);
  padding: var(--space-6);
  text-align: center;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/pipeline/__tests__/page.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/pipeline/page.tsx app/pipeline/page.module.css app/pipeline/__tests__/page.test.tsx
git commit -m "feat: add empty state for pipeline board with no stages"
```

---

## Task 3: Move-Deal Server Action + DealCard Client Component

**Files:**
- Create: `app/pipeline/actions.ts`
- Create: `app/pipeline/DealCard.tsx`
- Create: `app/pipeline/DealCard.module.css`
- Create: `app/pipeline/__tests__/DealCard.test.tsx`
- Modify: `app/pipeline/page.tsx` (use `DealCard` instead of the inline `<div className={styles.card}>` block)

**Interfaces:**
- Consumes: `moveDealToStage(tenantId: string, dealId: string, stageId: string): Promise<Deal | null>` and `PipelineStage`/`Deal` from `lib/crm/deals.ts`; `getDevTenantId()` from `lib/auth/dev-tenant.ts`.
- Produces:
  - `moveDealAction(dealId: string, stageId: string): Promise<void>` (Server Action, exported from `app/pipeline/actions.ts`) — Task 4 does not depend on this further, it's the terminal piece of this task.
  - `DealCard` component, props: `{ deal: Deal; stages: PipelineStage[] }`. Used by `app/pipeline/page.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/pipeline/__tests__/DealCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const moveDealActionMock = vi.fn();
vi.mock('../actions', () => ({
  moveDealAction: (...args: unknown[]) => moveDealActionMock(...args),
}));

import { DealCard } from '../DealCard';

const deal = {
  id: 'd1',
  tenantId: 't1',
  contactId: 'c1',
  pipelineStageId: 's1',
  title: 'Acme Renewal',
  valueMinorUnits: 500000,
  currencyCode: 'USD',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const stages = [
  { id: 's1', tenantId: 't1', name: 'Lead', sortOrder: 0 },
  { id: 's2', tenantId: 't1', name: 'Qualified', sortOrder: 1 },
];

describe('DealCard', () => {
  it('renders the deal title and a stage select defaulting to its current stage', () => {
    render(<DealCard deal={deal} stages={stages} />);

    expect(screen.getByText('Acme Renewal')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: /move .*acme renewal.* to stage/i });
    expect(select).toHaveValue('s1');
  });

  it('calls moveDealAction with the deal id and the newly selected stage id on change', () => {
    render(<DealCard deal={deal} stages={stages} />);

    const select = screen.getByRole('combobox', { name: /move .*acme renewal.* to stage/i });
    fireEvent.change(select, { target: { value: 's2' } });

    expect(moveDealActionMock).toHaveBeenCalledWith('d1', 's2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/pipeline/__tests__/DealCard.test.tsx`
Expected: FAIL — `app/pipeline/DealCard.tsx` and `app/pipeline/actions.ts` don't exist yet.

- [ ] **Step 3: Write the Server Action and the Client Component**

```typescript
// app/pipeline/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { moveDealToStage } from '../../lib/crm/deals';
import { getDevTenantId } from '../../lib/auth/dev-tenant';

export async function moveDealAction(dealId: string, stageId: string): Promise<void> {
  const tenantId = await getDevTenantId();
  const moved = await moveDealToStage(tenantId, dealId, stageId);
  if (!moved) {
    throw new Error('Could not move deal — it may have been deleted.');
  }
  revalidatePath('/pipeline');
}
```

```tsx
// app/pipeline/DealCard.tsx
'use client';

import type { Deal, PipelineStage } from '../../lib/crm/deals';
import { moveDealAction } from './actions';
import styles from './DealCard.module.css';

function formatValue(deal: Deal): string | null {
  if (deal.valueMinorUnits === null || !deal.currencyCode) return null;
  const amount = deal.valueMinorUnits / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: deal.currencyCode,
  }).format(amount);
}

export function DealCard({ deal, stages }: { deal: Deal; stages: PipelineStage[] }) {
  const formattedValue = formatValue(deal);

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newStageId = event.target.value;
    if (newStageId === deal.pipelineStageId) return;
    void moveDealAction(deal.id, newStageId);
  }

  return (
    <div className={styles.card}>
      <p className={styles.cardTitle}>{deal.title}</p>
      {formattedValue && <p className={styles.cardValue}>{formattedValue}</p>}
      <label className={styles.selectLabel}>
        <span className={styles.selectLabelText}>Move to stage</span>
        <select
          aria-label={`Move ${deal.title} to stage`}
          className={styles.select}
          value={deal.pipelineStageId}
          onChange={handleChange}
        >
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
```

```css
/* app/pipeline/DealCard.module.css */
.card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.cardTitle {
  margin: 0;
  font-weight: var(--font-weight-medium);
  font-size: var(--font-size-sm);
}

.cardValue {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.selectLabel {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.selectLabelText {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.select {
  font-family: var(--font-sans);
  font-size: var(--font-size-sm);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
}
```

Update `app/pipeline/page.tsx`: import `DealCard` from `./DealCard`, remove the inline `<div className={styles.card}>` markup and the now-unused `.card`/`.cardTitle` rules from `page.module.css` (kept only in `DealCard.module.css` now), and render deals as:

```tsx
                <div className={styles.cardList}>
                  {deals.map((deal) => (
                    <DealCard key={deal.id} deal={deal} stages={stages} />
                  ))}
                </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/pipeline/__tests__/DealCard.test.tsx app/pipeline/__tests__/page.test.tsx`
Expected: PASS (all tests in both files — `page.test.tsx`'s deal-rendering test still passes since `DealCard` still renders the deal's title text)

- [ ] **Step 5: Commit**

```bash
git add app/pipeline/actions.ts app/pipeline/DealCard.tsx app/pipeline/DealCard.module.css app/pipeline/__tests__/DealCard.test.tsx app/pipeline/page.tsx app/pipeline/page.module.css
git commit -m "feat: add deal stage-move select and server action"
```

---

## Task 4: Restore the Pipeline Nav Link to Active

**Files:**
- Modify: `app/components/AppShell.tsx`
- Modify: `app/shell.module.css`

**Interfaces:**
- Consumes: nothing new — this task only removes styling that gated an unbuilt route, now that Task 1 created `app/pipeline/page.tsx`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

There is no existing test file for `AppShell`. Create one:

```tsx
// app/components/__tests__/AppShell.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AppShell } from '../AppShell';

describe('AppShell', () => {
  it('renders the Pipeline nav link as a normal active link, not disabled/soon', () => {
    render(<AppShell><div /></AppShell>);

    const pipelineLink = screen.getByRole('link', { name: /^pipeline$/i });
    expect(pipelineLink).toHaveAttribute('href', '/pipeline');
    expect(pipelineLink.className).not.toMatch(/disabled/i);
    expect(screen.queryByText(/\(soon\)/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/components/__tests__/AppShell.test.tsx`
Expected: FAIL — the link's accessible name is currently `"Pipeline (soon)"` (fails the `/^pipeline$/i` exact match) and it carries the disabled class.

- [ ] **Step 3: Remove the disabled/soon styling**

In `app/components/AppShell.tsx`, replace:

```tsx
        <Link href="/pipeline" className={`${styles.navLink} ${styles.navLinkDisabled}`}>
          Pipeline <span className={styles.navLinkSoon}>(soon)</span>
        </Link>
```

with:

```tsx
        <Link href="/pipeline" className={styles.navLink}>
          Pipeline
        </Link>
```

In `app/shell.module.css`, remove the `.navLinkDisabled`, `.navLinkDisabled:hover`, and `.navLinkSoon` rules (and their preceding "Pipeline ships in Phase 2B-2" comment) entirely — `/pipeline` is now a real route, so no muted/soon styling applies to any nav link.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/components/__tests__/AppShell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/AppShell.tsx app/shell.module.css app/components/__tests__/AppShell.test.tsx
git commit -m "feat: restore pipeline nav link to active now that the route exists"
```

---

## Task 5: Full-Suite Verification and Type Check

**Files:** none created or modified — this task is verification only.

**Interfaces:** N/A.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every backend test (unchanged, real-DB) and every component test (including the 4 new/modified files: `app/pipeline/__tests__/page.test.tsx`, `app/pipeline/__tests__/DealCard.test.tsx`, `app/components/__tests__/AppShell.test.tsx`, plus the pre-existing `app/contacts/__tests__/*`) pass with zero failures.

- [ ] **Step 2: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke check of stage-only tenants (optional but recommended if a dev server is available)**

Run: `npm run dev`, then visit `/pipeline` in a browser signed into the dev tenant. Confirm: columns render in `sortOrder`, deals appear under the right column, changing a card's select actually moves the deal (page reflects the new column after the Server Action's `revalidatePath`), and the `/pipeline` nav link in the sidebar looks identical in styling to the `/contacts` link (no muted/soon treatment).

- [ ] **Step 4: Commit (only if Steps 1–2 required any fixes)**

```bash
git add -A
git commit -m "chore: verify phase 2b-2 full suite and type check"
```

If Steps 1–2 pass with no changes needed, skip this commit — there's nothing new to commit.
