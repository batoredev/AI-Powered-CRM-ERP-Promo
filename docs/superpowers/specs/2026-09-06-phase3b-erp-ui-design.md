# Phase 3B — ERP UI Design

**Status:** Approved by user 2026-09-06. Ready for per-sub-phase implementation planning.

## 0. Why this exists

Phase 3A-1 through Phase 3A-6 built a full ERP data-access layer (~21 modules in `lib/erp/`, ~15 distinct entity types across vendors/products, inventory/purchase-orders, production, projects/time, sales/invoicing/payments, and subscriptions) and their database schema, migrations, and RLS policies. None of it has a UI. Phase 3B builds that UI.

This spec covers scope, decomposition, and cross-cutting conventions only. Each sub-phase gets its own implementation plan (via `writing-plans`) and its own SDD execution cycle — this doc is what every sub-phase plan argues from, the way `docs/superpowers/specs/2026-09-01-phase3-erp-design.md` was for the 3A phases.

## 1. Decomposition

Phase 3B is too large for a single plan (~15 entities, full CRUD, new nav, shared components). It splits into 7 sub-phases, in strict build order — nothing later starts before everything earlier is merged:

| Sub-phase | Scope | Depends on |
|---|---|---|
| **3B-0** | Shared scaffold: ERP nav sections, nav gating, shared list/detail/form/empty-state component conventions | Phase 2B (Contacts/Pipeline UI) |
| **3B-1** | Vendors & Products | 3B-0 |
| **3B-2** | Inventory & Purchase Orders (locations, stock moves, purchase orders + receiving) | 3B-1 (products, vendors) |
| **3B-3** | Production (bill of materials, work centers, routing, manufacturing orders) | 3B-1 (products), 3B-2 (locations) |
| **3B-4** | Projects & Time | 3B-0 (contact reuse already exists via CRM) |
| **3B-5** | Sales & Billing (sales orders, invoices, payments) | 3B-1 (products), CRM (contacts) |
| **3B-6** | Subscriptions (recurring templates, plans, subscriptions, change events, usage records) | 3B-5 (invoice is subscription billing's eventual terminus, though generation itself stays out of scope — see §6) |

Each sub-phase produces working, testable, merged software on its own — the same discipline used for 3A-1 through 3A-6.

## 2. Screen depth: full CRUD per entity

Every entity in scope gets, at minimum:

- **List page** — table of all active (non-archived) rows for the tenant, matching the existing Contacts list pattern (`app/contacts/page.tsx`).
- **Detail/view page** — single row's full data, plus any state-transition actions that entity supports (e.g. approve/reject a purchase order, pause/cancel/reactivate a subscription, receive a shipment).
- **Create form** — matches the existing `app/contacts/new/` pattern (a dedicated route with a server action).
- **Edit form** — new for this phase; no existing ERP or CRM entity has one yet. Edits the same fields the create form sets, pre-populated from the current row.
- **Archive action** — see §3. Not a separate page; a button on the detail page (and optionally a row action on the list page) that flips the entity to inactive.

This means every mutable entity's `lib/erp/*.ts` module needs new `updateX()` and `archiveX()` functions where none exist today — real backend work riding alongside each UI sub-phase's plan, not just screens. Every new `updateX()`/`archiveX()` follows the same cross-tenant FK-validation discipline as `createX()`: validate any FK fields being changed via that entity's own `getX()` before writing, same as every `create*` function already does.

**Explicitly excluded from "full CRUD" — these entities never get an edit or archive UI, full stop, because they're append-only ledgers with no update/delete function and none should ever be added:**
- `stock_move` (Phase 3A-2)
- `subscription_change_event`, `usage_record` (Phase 3A-6)

These get list and detail(read-only) pages only. This is a hard exception carried forward unchanged from the 3A phases, not a new decision.

## 3. Delete semantics: soft-delete/archive, uniform across CRM and ERP

**Decision:** every mutable entity in scope gets an `is_active boolean NOT NULL DEFAULT true` column (added via a dedicated migration per entity, or folded into that entity's Phase 3B-N migration set). "Delete" in the UI means archiving — setting `is_active = false` — never a real `DELETE FROM`.

This directly extends the standing decision already recorded in `EXECUTION_PLAN.md` §3 ("GDPR vs. append-only history conflict resolved as soft-delete/tombstone") to the ERP side, rather than creating a CRM/ERP split. No entity in this phase needs hard-delete, reference-blocking-on-delete logic, or cascade/orphan handling — archiving a row never breaks any FK a historical record still points to, since the row still exists.

**Data-access pattern (uniform, one shape reused ~12 times):**

```typescript
export async function archiveX(tenantId: string, id: string): Promise<X | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE x
      SET is_active = false, updated_at = now()
      WHERE id = ${id} AND is_active = true
      RETURNING *
    `;
    return rows.length > 0 ? rowToX(rows[0]) : null;
  });
}

export async function restoreX(tenantId: string, id: string): Promise<X | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE x
      SET is_active = true, updated_at = now()
      WHERE id = ${id} AND is_active = false
      RETURNING *
    `;
    return rows.length > 0 ? rowToX(rows[0]) : null;
  });
}
```

This is the same atomic `UPDATE...WHERE...RETURNING` state-transition pattern already used throughout `lib/erp/` (e.g. `subscriptions.ts`'s `pauseSubscription`/`cancelSubscription`/`reactivateSubscription`) — `archiveX`/`restoreX` are just one more pair of guarded state transitions, not a new pattern.

**List queries default to `WHERE is_active = true`** unless the page is explicitly an "archived" view (out of scope for this phase — no archived-items list page is being built; archived rows are simply invisible to the default list, recoverable only by knowing the ID or via a future admin view).

**Entities that already have their own lifecycle/status column** (`purchase_order.approval_state`, `subscription.status`, `manufacturing_order.status`, etc.) do **not** also get `is_active` — their existing state machine already serves this purpose for the ERP-workflow sense of "inactive," and adding a second independent flag would violate this codebase's own two-independent-axes discipline by creating a redundant, easily-desynced third state. Only entities with no existing status/approval column get the new `is_active` column: `vendor`, `product`, `location`, `bill_of_materials`, `work_center`, `routing`, `project`, `task`, `plan`, `recurring_template`. (`work_order` and `time_entry` are sub-records of `manufacturing_order`/`project`+`task` respectively and follow their parent's archive state rather than getting their own.)

## 4. Navigation

`app/components/AppShell.tsx`'s sidebar currently has 2 flat links (Contacts, Pipeline). Phase 3B-0 restructures it into grouped sections:

```
CRM
  Contacts
  Pipeline
ERP
  Vendors & Products
    Vendors
    Products
  Inventory
    Locations
    Purchase Orders
  Production
    Bill of Materials
    Work Centers
    Manufacturing Orders
  Projects & Time          [hidden unless 'effort_based' IN billing_modes]
    Projects
    Tasks
  Sales & Billing
    Sales Orders
    Invoices
    Payments
  Subscriptions            [hidden unless 'recurring' IN billing_modes]
    Plans
    Subscriptions
```

**Gating:** `AppShell` (or a wrapper around it) reads `getErpSettings(tenantId).billingModes` server-side and conditionally renders the "Projects & Time" and "Subscriptions" nav groups. This is read once per request server-side, matching how `getDevTenantId()` is already read in every existing page — no new client-side data-fetching pattern needed.

Sub-entities that aren't top-level nav items (`work_order`, `time_entry`, `sales_order_line`, `invoice_line`, `payment_allocation`, `stock_move`, `bom_component`, `subscription_change_event`, `usage_record`) are reached from their parent's detail page, not the sidebar — matching how `DealCard`/pipeline stages already work without their own top-level nav entry.

## 5. Shared component conventions (Phase 3B-0's deliverable)

Extracted from the existing Contacts/Pipeline pages into shared components under `app/components/`, so all 6 module phases build on the same primitives from day one instead of reinventing table/form/empty-state markup 15 times:

- **`DataTable`** — generic list-page table (column defs + row data), replacing the ad hoc `<table>` currently inlined in `app/contacts/page.tsx`.
- **`EmptyState`** — the "No X yet. Add your first X to get started." pattern, currently inlined per-page.
- **Form field conventions** — labeled input/select wrapper components, so create/edit forms across 15 entities share one visual and accessibility pattern rather than each sub-phase inventing its own.

3B-0's plan defines the exact props/API for these three; every subsequent sub-phase plan references them by name rather than re-specifying.

## 6. Explicitly out of scope (carried forward from the 3A specs, unchanged)

- Any UI for actually generating a document from a `recurring_template` (the scheduler/cron mechanism itself was never built in 3A-6, and no UI can front a mechanism that doesn't exist).
- `SubscriptionItem`/add-ons, `BillingCycle`/`PaymentAttempt`/`DunningPolicy` UI (the entities themselves don't exist — out of scope per the 3A-6 spec).
- An "archived items" browse/restore UI — archiving is one-way from the visible UI's perspective in this phase; restoring requires knowing the row's ID (e.g. via direct DB access) until a future phase adds one.
- Bulk actions (bulk archive, bulk edit) on any list page.
- Any dashboard/analytics/reporting screens — this phase is CRUD screens per entity only.
- Search/filter beyond what a plain list page needs; no faceted search, no saved views.

## 7. Cross-cutting technical conventions (apply to every sub-phase)

- Every page reads the tenant via `getDevTenantId()`, matching every existing CRM page — no new auth pattern.
- Every create/edit form posts through a server action co-located with its route (`actions.ts`), matching `app/contacts/new/actions.ts` and `app/pipeline/actions.ts`.
- Every new `updateX`/`archiveX`/`restoreX` function in `lib/erp/*.ts` goes through `withTenant()`, never raw `getSql()`.
- Every new `is_active` column needs its own migration; `FORCE ROW LEVEL SECURITY` already exists on these tables from their original 3A migration — no new RLS policy needed, since `is_active` is just another column on an already-RLS'd table (verified automatically by the catalog-driven `rls-policy-audit.test.ts`, which needs no update).
- Migration numbers continue from 0031 (0001–0030 exist as of Phase 3A-6's merge).
- Money fields, where displayed, use the existing integer-minor-units + explicit-currency-code convention — the UI formats `price_minor_units`/`currency_code` for display, never stores or computes money differently.
- **Standing instruction (new as of this phase):** after every 3B-N sub-phase merges, update `dev-tools/feature-manifest.json` to declare its new files/migrations, same as every 3A phase should have done from the start — verified by grepping every import/`REFERENCES`/enum-usage in the new files against the manifest, not just adding the obviously-new files.

## 8. Self-review

**Placeholder scan:** none found — every section states a concrete decision.

**Internal consistency:** §2's "full CRUD" and §3's "soft-delete only" are consistent — "delete" in §2 always means "archive" per §3, stated explicitly in §2's bullet list. §3's `is_active`-vs-existing-status-column exception list was cross-checked against every entity named in §1's table; no entity is missing from either the "gets `is_active`" list or the "already has its own lifecycle column" list.

**Scope check:** focused enough for 7 separate implementation plans; no single sub-phase here needs further decomposition (each covers 1-4 entities, matching the size of the smallest 3A phases like 3A-1).

**Ambiguity check:** the one real ambiguity resolved during brainstorming — whether ERP deletes should be hard or soft — is resolved unambiguously in §3, with the standing-decision cross-reference made explicit so a future reader doesn't rediscover the tension.
