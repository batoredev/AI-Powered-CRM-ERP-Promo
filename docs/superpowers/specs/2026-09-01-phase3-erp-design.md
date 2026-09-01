# Phase 3: Core ERP — Design Spec

**Date:** 2026-09-01
**Status:** Draft — sections presented incrementally for approval
**Research input:** `docs/superpowers/specs/research/2026-09-01-erp-market-research.md`
**Supersedes:** the four-entity sketch in `docs/superpowers/specs/2026-08-29-ai-crm-erp-platform-design.md` §8 (`product`, `inventory_item`, `order`, `invoice`) and the "tailored schema variants per business type" framing from earlier brainstorming — both are replaced by the axis model below, per the user's explicit decision after reviewing the research.

## 1. Core architectural decision: two composable axes, not four variants

Confirmed with the user: **one shared core schema for every tenant, with two independently-toggleable axes**, rather than four exclusive business-type variants.

- **Axis A — goods-handling:** `off` (pure service) → `basic_stock` (retail-style single/multi-location inventory) → `production` (manufacturing: BoM, routing, work orders — additive on top of `basic_stock`, never a replacement for it).
- **Axis B — billing modes:** a *set*, not an exclusive choice — `transactional` (one-off orders/invoices), `effort_based` (time/milestone billing), `recurring` (subscriptions/metered). A tenant can have any combination (a retailer selling subscription boxes has `basic_stock` + `{transactional, recurring}`).

Module tables (stock ledger, production, projects/time, subscriptions) exist for every tenant at the schema level — RLS and `withTenant()` govern data access exactly as today, and an empty/unused module for a tenant that hasn't enabled it is just zero rows, the same pattern already used for a brand-new tenant's zero contacts/deals in Phase 2. A `tenant_erp_settings` table (created early in Phase 3A's task sequence, since every later module's gating logic depends on it existing first) holds the actual per-tenant toggle state and is what application code and UI both read to decide what to show/allow — never a schema fork.

This directly answers the earlier "so any client's feature set can be controlled later without rebuilding" requirement: the future dev/admin panel (a later phase) will read and write `tenant_erp_settings`, offering "preset bundles" (Retail, Service, Manufacturer, ...) as one-click combinations of the same underlying toggles, plus the ability to flip individual toggles for a hybrid business.

## 2. Shared core entities (every tenant, always present)

Per research §5.2, justified by convergence across every reference product examined:

- **`vendor`** — separate table (per the user's explicit choice), distinct from `contact`. Vendor-specific fields (payment terms, tax id) live here; a vendor is not a `contact` with a flag.
- **`product`** — the sellable/stockable item, with a `product_type` discriminator (`goods` | `service` | `non_inventoried`). This discriminator is the gate: a `service`-type product never touches the stock ledger, matching how Odoo's own reorder rule requires `product_type = goods` before it applies at all (research §5.2, [V]).
- **`order`** and **`order_line`** — but see §3: sales orders and purchase orders are **separate tables**, not one polymorphic table with a direction flag. Both share the same header/line/party/status *shape* conceptually, but that shape is not itself a shared table.
- **`invoice`** and **`invoice_line`** — universal terminus of every vertical (research §5.2/§5.3). An invoice can originate from a sales order, from unbilled time/milestones, or from a subscription billing cycle — `invoice.source_type` + a nullable source FK records which, without forcing all three origins through one shape.
- **`payment`** and **`payment_allocation`** — a payment can partially or fully cover one or more invoices; `payment_allocation` is the join table carrying the allocated amount.
- **Numbering** — a per-tenant, per-document-type sequence (e.g. invoice numbers must be gapless/sequential for many jurisdictions' compliance needs). A `document_sequence` table (`tenant_id`, `document_type`, `next_number`) with an atomic increment function, decided now because retrofitting sequential numbering after real invoices exist is not safely possible (research §5.2 flags this as "early-irreversible").
- **`approval_state`** as a shared enum (`draft`, `pending_approval`, `approved`, `rejected`) used as a column on every document type with an external side effect (purchase orders, manufacturing orders, invoices past a threshold, subscription cancellations). This is the Phase 5 agent-runtime hook described in research §5.5 — every AI-creatable record defaults to `draft`, matching this project's `.claude/rules/ai-systems.md` requirement that irreversible actions get an approval gate outside the model. Phase 3 only needs the column and the state machine; the actual AI actor doesn't exist until Phase 5.

## 3. Explicit boundary calls (per research §5.4 — where the "obvious" design is wrong)

Adopting all three of the research's opinionated calls, since each is backed by convergent evidence across multiple reference products:

1. **No polymorphic `order` table.** `sales_order`/`sales_order_line` and `purchase_order`/`purchase_order_line` are separate tables. Reason: different parties (customer vs vendor), different approval chains, different inventory direction, different downstream documents (fulfillment vs receipt). A shared table with a direction flag would push direction-conditional logic into every query and every RLS policy — worse than two tables with a shared conceptual shape.
2. **No derived values stored where an event belongs.** Stock quantity is never a column on `product` — it's always derived from an append-only `stock_move` ledger at `(product_id, location_id)`. Subscription proration is never computed by editing a subscription row — it's recorded on a `subscription_change_event` row at the moment of the change. Both are near-irreversible if wrong (you cannot backfill history you never recorded).
3. **Split states that look like one boolean but aren't.** A time entry's `billable`, `billed`, and `approved` are three independent booleans, not one. Payment-retry policy (subscription-scoped: bounded attempts, terminal action) and receivable dunning (invoice-scoped: days-overdue ladder, multi-channel) are two separate tables with different owners and triggers, never one `dunning_config`.

## 4. Module boundaries (toggleable per `tenant_erp_settings`)

Mapped directly from research §5.3, in dependency order:

| Module | Gated by | Depends on |
|---|---|---|
| Stock ledger (`stock_move`, `location`, on-hand derived at product×location) | `goods_handling != off` | — |
| Multi-location | `goods_handling != off` + a separate `multi_location_enabled` flag | Stock ledger |
| Procurement (`purchase_order`, vendor pricing) | `goods_handling != off` | Stock ledger, `vendor` |
| Reorder rules | `goods_handling != off` | Stock ledger + (Procurement and/or Production) |
| Production (`bill_of_materials`, `routing`, `work_center`, `manufacturing_order`, `work_order`) | `goods_handling == production` | Stock ledger |
| Projects & time (`project`, `task`, `time_entry`) | `'effort_based' IN billing_modes` | — |
| Retainers | `'effort_based' IN billing_modes` | Projects & time |
| Subscriptions (`plan`, `subscription`, `subscription_change_event`, `usage_record`) | `'recurring' IN billing_modes` | `recurring_template` (core) |

Lot/serial tracking and product variants are deferred out of Phase 3A's initial schema (research flags both as real but second-tier — lot/serial toggles per-item not per-tenant, adding real complexity for a case with no immediate driving requirement). They get a documented "deferred" note in this spec's own open-items list, the same pattern used for the deal-history requirement deferred in Phase 2A.

## 5. Phase split

Confirmed with the user (before the research pivot, still applies): **Phase 3A (schema + data layer) then Phase 3B (UI)**, mirroring the Phase 2A/2B split that worked well. Given the larger scope here, Phase 3A itself will likely need to be split further once task-level detail is drafted (e.g. 3A-1 core party/item/document/invoice, 3A-2 stock+procurement module, 3A-3 production module, 3A-4 projects/time module, 3A-5 subscriptions module) — this will be decided when writing-plans drafts concrete tasks, following the same "propose a split, get a quick confirm" pattern used for Phase 2B.

## 6. Open items carried forward (not solved by this phase)

- Multi-currency, fiscal-period/close, chart of accounts, tax jurisdiction — flagged by the research as cross-cutting and higher-risk than anything in the four verticals, but out of scope for Phase 3's first cut. Recorded here so they aren't silently lost (same convention as the Phase 2A deal-history deferral).
- The actual admin/dev panel for flipping `tenant_erp_settings` — a later phase (aligns with roadmap Phase 6's plugin-permission consent screen).
- Barcode, landed cost, inventory valuation method (FIFO/AVCO/standard) — noted by research as deferrable, not built in Phase 3A.
- Variants and lot/serial tracking — deferred per §4 above.

## 7. GDPR erasure vs. append-only history — resolved

A CRM feature audit (2026-09-01, referenced against `db/migrations/` and this spec) surfaced a real conflict: `db/migrations/0005_deal.sql`'s own header comment requires append-only history for `deal`/`order`/`invoice` per §8 of the master design spec, while that same master spec's §7 promises GDPR-class deletion. Append-only history and hard erasure are directly in tension.

**Resolved: soft-delete / tombstone, not true hard delete.** When erasure is requested for a party (contact, vendor) or a document referencing one, the history/audit trail stays intact — deal stage transitions, order/invoice line items, and any append-only ledger rows are never physically destroyed, since they carry legitimate business/audit value independent of any one person's PII. Instead, a tombstone event redacts PII fields (name, email, phone, address, tax id) on the affected party record and on any historical rows that duplicated them, while preserving the structural record ("a deal existed, moved through these stages, on these dates, against a now-redacted contact"). This satisfies GDPR Article 17 in the way most B2B SaaS platforms actually implement it — full destruction of business records is not what the regulation requires once PII is separated from structural/transactional data.

This is a decision, not an implementation — the actual tombstone mechanism (which tables get a `redacted_at` marker, how redaction cascades through history tables, who can trigger it) is deferred to the Phase 8 hardening pass on the roadmap (§9: "data export/deletion tooling"), where it belongs alongside DSAR export. Recorded here now so the append-only-history requirement (§3, boundary call #2) is never implemented as if hard delete were still a live possibility — every append-only table built from this point forward should assume PII lives in fields that can be redacted in place, not in fields that must someday be deletable as whole rows.
