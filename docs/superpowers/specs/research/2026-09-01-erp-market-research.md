# ERP Market Research — Feature Superset for Phase 3 (Core ERP)

**Date:** 2026-09-01
**Purpose:** Primary-source input to Phase 3 schema and feature-toggle design for the multi-tenant AI CRM+ERP platform.
**Scope:** Four business-type verticals × four reference product families (Odoo, Zoho, QuickBooks/FreshBooks, NetSuite/SAP Business One).
**Out of scope:** SQL, table names, pricing/competitive positioning. Entity and relationship level only.

## Evidence legend

- **[V]** Verified against a vendor primary source (official documentation or product page) reachable in this session.
- **[V-sec]** Verified from a search-result summary of vendor documentation, but the full page was not fetched — the claim is vendor-sourced but the exact field list was not read end-to-end.
- **[I]** Inferred or synthesized by me. Not a vendor claim. Treat as an opinion to be challenged.

Only two pages were fetched in full (Odoo reordering rules; Odoo BoM/work-order search synthesis). Everything else is **[V-sec]**. I flag this because it materially affects how much weight the field-level details deserve — the *shape* of each entity is well established, the *exact field names* mostly are not, and this brief deliberately does not name fields it did not read.

---

## 1. Product / Retail

### 1.1 Common core (converged across all four reference products)

Every reference product models the same six things. This convergence is strong enough that I would treat it as the base retail module, not an option.

| Concept | Odoo | Zoho Inventory | QuickBooks Online Plus | NetSuite / SAP B1 |
|---|---|---|---|---|
| Sellable/stockable item | Product (template) | Item | Inventory item | Item master |
| Stock on hand per place | Location / warehouse | Warehouse | Single implicit location | Location (+ bins) |
| Inbound procurement doc | RFQ → Purchase Order | Purchase Order | Purchase Order | Purchase Order |
| Outbound doc | Sales Order → Delivery | Sales Order → Package/Shipment | Invoice / Sales Receipt | Sales Order → Item Fulfillment |
| Supplier | Vendor | Vendor | Vendor | Vendor / Business Partner |
| Threshold-driven replenishment | Reordering rule | Reorder point | Reorder point | Reorder point / demand planning |

**Verified specifics:**

- **Purchase order is a separate entity from sales order in every product examined.** [V] Odoo's reordering-rule documentation shows the Buy route generating an *RFQ* (which becomes a purchase order), and the Manufacture route generating a *manufacturing order* — three distinct document types, all triggered by the same rule entity. This directly answers the brief's question: PO and SO are never one polymorphic "order" in these products.
- **Reorder thresholds are their own first-class entity in Odoo, and only a field in QuickBooks.** [V] The Odoo reordering rule carries: product, location, min quantity, max quantity, trigger (auto/manual), preferred route, vendor, bill of materials, multiple (rounding quantity), procurement group. Note that it references *both* a vendor and a BoM — the rule is the join point between purchasing and manufacturing. [V-sec] QuickBooks Online Plus, by contrast, exposes reorder point as a minimum-quantity field on the item that fires a reminder; Intuit's own help and third-party analyses confirm it does **not** auto-populate a purchase order with all below-threshold items for a vendor, and does not forecast demand.
- **Multi-location is a feature flag, not an assumption.** [V-sec] NetSuite's Multi-Location Inventory is an *enableable feature*; bins are a second, separately-enabled feature (Bin Management / Advanced Bin & Numbered Inventory Management) that can be turned on per-location. Bin records are created as their own list records and carry a location reference plus a "preferred per location" flag. This is a two-level hierarchy — location, then bin — and NetSuite treats stock quantity as living on an *item-location* pairing, not on the item.
- **Variants are a parent/child split, not attributes on one row.** [V-sec] Odoo splits product template (the parent, e.g. "T-shirt") from product variant (the sellable child, e.g. "T-shirt / Blue / S"), generated from attribute × value combinations. Critically, Odoo offers three variant creation modes — *instantly* (materialize all combinations), *dynamically* (materialize on first use in a sales order), and *never*. The dynamic mode exists because the full cartesian product of attributes is often enormous.
- **Lot/serial tracking is per-item opt-in and threads through every stock document.** [V-sec] Odoo supports lot numbers and serial numbers as a per-product tracking mode; when enabled, the lot/serial field appears on inventory adjustments, scrap operations, and valuation. Zoho Inventory offers the same two modes (batch tracking, serial number tracking) with expiry-date support on batches. [V-sec] Odoo 19 additionally supports valuation *by* lot/serial — cost is assigned per lot at creation, and updating an existing lot uses that lot's most recent cost.
- **Stock adjustments and scrap are distinct operations with distinct semantics.** [V-sec] Odoo models an inventory adjustment as a counted-quantity reconciliation with an assigned responsible user for traceability, and models scrap as a *move to a virtual "Inventory Loss" location* rather than a deletion. That distinction matters: scrapped stock is still accounted for, just in a non-sellable place.

### 1.2 Vertical-specific extensions (should be toggleable)

Ranked by how confidently the evidence supports making them optional rather than base:

1. **Multi-location / warehousing** — strongly supported as a toggle. [V-sec] NetSuite ships it as an explicitly enableable feature; QuickBooks Online Plus has no meaningful multi-location model at all. A single-location retailer should not pay complexity cost for it.
2. **Bins / sub-location** — a second toggle *layered on* the first. [V-sec] NetSuite treats these as independently enableable and per-location. Do not collapse bins into locations.
3. **Variants / attribute matrix** — toggleable. Many retailers (hardware, grocery, industrial) sell only simple SKUs.
4. **Lot / batch / serial tracking** — toggleable *per item*, not per tenant. [V-sec] All of Odoo, Zoho, and NetSuite make this an item-level tracking mode, which means a tenant can have both tracked and untracked items simultaneously. This is a significant design constraint: the toggle granularity is the item, not the tenant.
5. **Barcode** — [I] Effectively a set of identifier fields plus a scanning UI, not a distinct entity graph. Low schema cost; I'd model the identifiers in the base and gate only the UI.
6. **Landed cost / valuation method (FIFO/AVCO/standard)** — [I] Present in Odoo and NetSuite, absent in FreshBooks-class products. High accounting complexity; a strong candidate for a later toggle rather than Phase 3.

### 1.3 Entities and relationships a schema designer can act on

```
Vendor ──< PurchaseOrder ──< PurchaseOrderLine >── Product(Variant)
                 │
                 └─ receipt ─> StockMove ──> quantity at (Item × Location [× Bin])

Customer ──< SalesOrder ──< SalesOrderLine >── Product(Variant)
                 │
                 └─ fulfillment ─> StockMove ──> quantity leaves (Item × Location)

ProductTemplate ──< ProductVariant  (via Attribute × AttributeValue)
ProductVariant  ──< Lot | SerialNumber   (per-item tracking mode)

ReorderRule (product, location, min, max, multiple, trigger, route, vendor?, bom?)
   └─ fires ─> PurchaseOrder (buy route) | ManufacturingOrder (manufacture route)

InventoryAdjustment  → StockMove (counted vs system, responsible user)
Scrap                → StockMove into virtual "Inventory Loss" location
```

Three relationship facts worth carrying forward, all [V] or [V-sec]:

- **Stock quantity is a property of the (item, location) pair**, never of the item alone. NetSuite's item-location record makes this explicit. Modelling `quantity_on_hand` on the product is the single most common irreversible mistake here.
- **Every quantity change is a movement, not an update.** Odoo routes adjustments and scrap through the same stock-move mechanism as receipts and deliveries. An append-only movement ledger with derived on-hand balances is the pattern all four products converge on. [I] For a multi-tenant Postgres+RLS platform this is also the audit-friendly choice.
- **The reorder rule is the natural join between purchasing and manufacturing** because it carries both a vendor and a BoM reference and picks between them via a route field. [V]

### 1.4 AI-automatable workflows

- **Threshold replenishment with vendor selection.** [V] Odoo's rule already encodes the deterministic part (min/max/multiple/route). The AI-shaped part is what the rule cannot do: choosing among multiple vendors on price/lead-time, and setting the min/max values themselves from demand history. [V-sec] QuickBooks explicitly does *not* forecast demand — that gap is the differentiator.
- **Draft-PO generation from below-threshold items grouped by vendor.** [V-sec] Explicitly cited as a QuickBooks limitation; a clear automation win.
- **Receiving-discrepancy triage** — flag PO-line vs received-quantity mismatches for human decision. [I]
- **Cycle-count scheduling and variance explanation** — propose which items to count based on movement velocity and past variance; explain a counted-vs-system delta. [I]
- **Dead-stock and expiry surfacing** — [V-sec] batch expiry dates exist in Zoho, so expiry-driven markdown/write-off proposals are grounded in real data the schema will hold.

**Approval-gate note:** creating a purchase order is a financial commitment to a third party. Per `.claude/rules/ai-systems.md`, this needs an approval gate *outside* the model. The schema should therefore support a **draft/proposed** state on procurement documents that is distinct from confirmed — Odoo's RFQ-before-PO distinction is exactly this pattern and is worth copying deliberately. [V] + [I]

---

## 2. Service-Based

### 2.1 Common core

The convergence here is narrower but real: **project → time entry → invoice**, with a billable flag as the hinge.

- [V-sec] Zoho Books models Project, with Tasks under it, and Time Entries logged against a project+task. Time entries carry a **billable checkbox**, and only billable entries flow onto an invoice.
- [V-sec] Zoho Books supports **three distinct rate resolution paths**: the project's rate, the *staff member's* hourly rate, or the *task's* hourly rate. This is a schema fact, not a UI preference — rate has to be resolvable from three different owners with a precedence order.
- [V-sec] FreshBooks models Projects as a collaboration container aggregating time tracked, invoices, and expenses.
- [V-sec] NetSuite SuiteProjects applies **time billing rules** to time entries and processes only *approved* entries — so an approval state on the time entry is load-bearing, not decorative.

**Verified: there is no inventory entity in this path at all.** Invoicing derives from time or from milestones, never from a shipped item. That is the cleanest vertical boundary found in this research.

### 2.2 Vertical-specific extensions

1. **Retainers / advance payments.** [V-sec] Both Zoho Books and FreshBooks model this as a real entity, not a discount. FreshBooks' semantics are specific and worth copying: bill a fixed amount upfront, auto-generate invoices on a period, **deduct tracked time from the retainer balance and mark it billed**, and bill overage hours at a *different rate* via an optional one-time invoice. That is a balance-carrying entity with its own drawdown ledger and a separate overage rate.
2. **Milestone / fixed-fee billing.** [V-sec] NetSuite distinguishes billing on fixed dates, on milestone completion, on project progress percentage, from time entries, and from expense reports — five separate billing-rule types against one project. When a milestone completes, a sales order becomes ready to bill containing *only that milestone's* amounts.
3. **Estimates / proposals with e-signature.** [V-sec] FreshBooks separates estimates from proposals, the latter carrying rich content and requesting an eSignature before acceptance.
4. **Project budgets and profitability.** [V-sec] Zoho reports logged vs budgeted hours, billable vs non-billable amounts, billed vs unbilled. [V-sec] Odoo achieves the same through **analytic accounts** — a general-purpose cost/revenue dimension attached to journal entries, which the project dashboard reads to compute profitability.
5. **Expense pass-through to client.** [V-sec] Both Zoho and NetSuite treat billable expenses as a separate feed onto the invoice alongside time.

### 2.3 Entities and relationships

```
Customer ──< Project ──< Task
                │
                ├──< TimeEntry (user, task?, duration, billable flag, approval state, rate source)
                ├──< BillableExpense
                ├──< Milestone ──> triggers billing document
                └──< Retainer (balance, period, overage rate) ──< drawdown against TimeEntry

BillingRule (project) : one of {time-based, milestone, fixed-date/repeating, progress, expense}
   └─ produces ─> Invoice (lines derived from unbilled TimeEntry / Milestone / Expense)

Project ──> AnalyticAccount-equivalent (cost/revenue dimension for profitability)
```

Design facts:

- **Rate resolution needs an explicit precedence chain** (task rate → user rate → project rate), because Zoho supports all three simultaneously. [V-sec]
- **`billable` and `billed` are two different booleans.** A time entry can be billable-but-unbilled — Zoho's scheduler works precisely by finding "unbilled timesheets up to the invoice date". [V-sec] Collapsing these into one flag breaks the automation.
- **Approval is a third state.** NetSuite bills only approved entries. [V-sec]
- **The retainer is a balance-carrying account**, and drawdown is a ledger, because FreshBooks' overage behaviour requires knowing exactly when the balance crossed zero. [V-sec] + [I]

### 2.4 AI-automatable workflows

- **Scheduled sweep of unbilled billable time into a draft invoice.** [V-sec] Zoho ships exactly this as a scheduler. The deterministic version already exists in the market; the AI version adds grouping, narrative line descriptions, and anomaly suppression.
- **Timesheet anomaly detection before approval** — flag entries that are implausibly long, retroactively dated, or mis-categorized against project budget. [I]
- **Budget-burn alerting** — logged-vs-budgeted is already a reported metric, so projecting overrun is grounded. [V-sec data, I workflow]
- **Retainer depletion forecasting and top-up prompting** — drawdown ledger plus recent burn rate. [I]
- **Milestone-completion detection → propose the milestone invoice.** [V-sec] NetSuite already makes milestone completion the billing trigger; the AI part is noticing completion from project activity.

---

## 3. Hybrid / Manufacturing

### 3.1 Common core

This vertical is a **strict superset of retail** plus a production graph. Nothing in retail becomes irrelevant.

- [V-sec] **BoM ↔ product cardinality is asymmetric in Odoo**: a product may have *multiple* BoMs, but a BoM belongs to exactly one product. Do not model this as one-to-one.
- [V-sec] **Routing is separate from BoM, with its own asymmetric cardinality**: a routing defines the ordered operations and the work center for each; a routing may be attached to *multiple* BoMs, but a BoM has at most *one* routing. So the operations list is reusable across BoMs.
- [V-sec] **Manufacturing order and work order are different entities.** In Odoo, selecting a BoM on a new MO auto-populates a Components tab and a Work Orders tab; work orders are generated *from the routing* when the MO is planned. MO = "make N of this product"; WorkOrder = "perform this operation at this work center".
- [V-sec] **SAP Business One converges on the same shape** with different names: BoM lists components and resources; a Production Order is issued *based on* the BoM and is described as "a command to produce (or repair) a production item"; components are issued from a warehouse to a shop-floor warehouse. Note SAP's explicit modelling of the shop floor as *another warehouse* — WIP is inventory in a different place, mirroring Odoo's virtual-location approach to scrap.
- [V-sec] **BoMs are recursive.** SAP states a BoM may have several levels and a component may itself be a produced item with its own BoM. Self-referential depth is required, not optional.

### 3.2 Vertical-specific extensions

1. **Kit / phantom BoM vs manufactured BoM.** [V-sec] Odoo documents kit BoMs as a distinct type (the 14.0 docs specifically cover routings on kit BoMs); Zoho Inventory has the analogous **Composite Items**. A kit explodes at sale time and is never stocked as a finished good — semantically different from a manufactured product, and worth a BoM-type discriminator rather than a separate entity.
2. **Work centers and capacity.** [V-sec] Each operation names a work center and duration settings. This is the entity that makes scheduling possible; a shop doing simple assembly may not need it.
3. **Job costing / analytic dimension.** [V-sec] Odoo's analytic accounts distribute journal-entry costs across one or more analytic accounts grouped into analytic *plans*. The "one or more" is important — cost distribution is many-to-many with a weighting, not a single foreign key.
4. **WIP as a location.** [V-sec] SAP's shop-floor warehouse. [I] This is the elegant move: if stock lives at (item, location), then WIP needs no new mechanism at all.
5. **Multi-level BoM explosion / MRP run.** [V-sec] Odoo's replenishment offers reordering rules, make-to-order, *and* a master production schedule as three distinct strategies. MPS is clearly the heavy-tier option.

### 3.3 Entities and relationships

```
Product ──< BoM (0..n per product; each BoM → exactly 1 product)
             ├──< BoMComponent >── Product   (recursive: component may have its own BoM)
             ├──> Routing (0..1)  ──< Operation >── WorkCenter (+ duration)
             └─ type: {manufacture | kit/phantom}

ManufacturingOrder (product, bom, qty, target location)
   ├──< ComponentConsumption ─> StockMove (out of component location / into WIP)
   ├──< WorkOrder  (generated from Routing operations when MO is planned)
   └──> FinishedGoodReceipt ─> StockMove (into stock location)

CostDimension/AnalyticAccount ──< distribution (many-to-many, weighted) >── financial lines
```

- **Reuse the retail stock-move ledger for production.** [I, but grounded] Both Odoo (virtual locations for loss) and SAP (shop-floor warehouse) treat production consumption as location-to-location movement. Introducing a parallel production-inventory mechanism would be a mistake this research argues against.
- **The reorder rule already bridges into this vertical** — it carries a BoM field and a route that selects manufacture over buy. [V] Retail and manufacturing therefore share the replenishment entity; only the downstream document differs.

### 3.4 AI-automatable workflows

- **Explode a sales order into component shortfalls and propose buy-vs-make per component.** [V] The route field on the reorder rule is literally this decision, currently made by static configuration.
- **Multi-level BoM shortage cascade** — walk the recursive BoM to find the deepest blocking component. [V-sec structure, I workflow]
- **Work-order scheduling against work-center capacity** — duration settings on operations exist, so this is grounded. [V-sec data, I workflow]
- **Standard-vs-actual cost variance explanation** using the analytic dimension. [V-sec data, I workflow]
- **Scrap-rate anomaly detection** per work center / component. [I]

**Approval-gate note:** releasing a manufacturing order consumes physical inventory irreversibly. Same draft/confirmed distinction as procurement applies. [I]

---

## 4. Subscription / Recurring Billing

### 4.1 Common core

- [V-sec] **Recurring templates are a distinct entity from the documents they generate.** QuickBooks Online models a *recurring transaction template* with a `type` of **Scheduled | Reminder | Unscheduled** — the same template entity serves fully-automatic generation, human-prompted generation, and a saved-but-dormant draft. That three-way type is a good primitive: it maps cleanly onto "AI acts", "AI proposes", and "human keeps it manual", which is exactly the gradient an AI-first platform needs.
- [V-sec] **Plan is separate from subscription.** Zoho Billing has a product catalog containing Plans, with Add-ons attached, and Subscriptions as the customer-bound instances.
- [V-sec] **Billing period is a unit + numeric value pair**, not an enum. Odoo's recurring plan sets unit (weeks/months/years) plus a number — so "every 3 months" and "every 2 weeks" are the same structure. Do not model an enum of monthly/quarterly/annual.
- [V-sec] Dunning exists as a first-class configured process in both Zoho Billing (Dunning Management, with multiple dunning *rules* supported) and Odoo Accounting (Follow-up Levels).

### 4.2 Vertical-specific extensions

1. **Dunning / retry policy.** [V-sec] Zoho Billing's model is concrete and bounded: configurable retry preferences, a **maximum of 3 retry attempts**, a configurable day-gap between attempts, and a configurable **final action** if the last retry fails — "Mark Subscription as Free" or "Cancelled". Odoo's parallel model is a ladder of **Follow-up Levels** keyed on days-overdue, each with an action and a channel (email, SMS, WhatsApp, post). These are two genuinely different shapes: Zoho's is a *payment-retry* policy on a subscription; Odoo's is a *communication escalation* policy on a receivable. **A serious platform needs both**, and they are not the same table.
2. **Proration.** [V-sec] Zoho prorates the difference on upgrade and downgrade, and explicitly **does not prorate when upgrading from a free plan** — a real edge case to encode. [V-sec] Odoo generates a prorated invoice for remaining days in the current period on upsell, and — importantly — third-party documentation notes this proration only fires through the upsell *wizard*, not when subscription lines are edited directly. That is a warning: proration must be a property of a *change event*, not a side effect of a row update.
3. **Usage / metered billing.** [V-sec] Zoho Billing implements usage-based pricing by modelling the metered service **as an add-on**, recording usage events against it during the cycle, and billing recorded usage at renewal or on demand. It supports three pricing shapes: **per-unit**, **tiered/slab** (multiple tiers charged by usage quantity per tier), and **overage** (base fee for included quantity plus a charge above the limit).
4. **Plan change / upsell as a tracked event.** [V-sec] Odoo marks upsell quotations with an upsell indicator and treats them as their own document, with an MRR delta on the contract header.
5. **Free plans / trials.** [V-sec] Zoho documents free plans as a distinct catalog concept with distinct proration behaviour.

### 4.3 Entities and relationships

```
Plan (catalog) ──< PlanAddon
   │                  └─ pricing model: {flat | per-unit | tiered | overage}
   └──< Subscription (customer, plan, billing period {unit, count}, status, anchor date)
             ├──< SubscriptionItem  (plan + selected add-ons, quantity)
             ├──< UsageRecord (add-on, quantity, timestamp)  [metered only]
             ├──< SubscriptionChangeEvent (upgrade/downgrade/qty change, effective date,
             │        proration outcome)  ← proration attaches HERE, not to the row edit
             └──< BillingCycle ──> Invoice ──< PaymentAttempt
                                                  └─ DunningPolicy
                                                       (retry count ≤3, gap days, final action)

RecurringTemplate (type: scheduled | reminder | unscheduled) ──> generates any document
FollowUpLevel (days overdue, action, channel) — receivable-side escalation ladder
```

- **`RecurringTemplate` generalizes beyond subscriptions.** [V-sec] QuickBooks applies recurring templates to *transactions* generally, not only invoices. [I] Modelling it generically gives recurring bills, recurring journal entries, and recurring POs for free — a strong candidate for the shared core rather than the subscription module.
- **Dunning splits in two.** Payment-retry policy (subscription-scoped, bounded attempts, terminal action) and receivable follow-up ladder (invoice-scoped, days-overdue, multi-channel). [V-sec for both, [I] that they must coexist]
- **Usage records are an append-only event stream** aggregated at cycle close. [V-sec]

### 4.4 AI-automatable workflows

- **Generate the next period's invoice.** [V-sec] Fully deterministic and already automated by every reference product — this is a *scheduler* job, not an AI job. Worth stating plainly so the platform doesn't spend an LLM call on it. The AI value sits at the edges: unusual proration, disputed line, first invoice after a plan change.
- **Failed-payment recovery.** [V-sec] The retry ladder is deterministic; choosing *retry timing* per customer and drafting the escalation message is the AI layer.
- **Collections triage on the receivable ladder.** [V-sec] Odoo already routes follow-ups by days overdue across email/SMS/WhatsApp/post. AI adds channel choice, tone escalation, and payment-likelihood scoring.
- **Involuntary-churn prediction** from payment-attempt history and usage decay. [I]
- **Expansion detection** — usage consistently exceeding the included tier is a mechanical upgrade signal. [V-sec data, I workflow]

**Approval-gate note:** cancelling a subscription and charging a card are both irreversible external actions. Zoho's "final action" field is a policy the *tenant* configures, which is the right pattern — the human approves the policy once, not each execution. [V-sec] + [I]

---

## 5. Cross-Vertical Synthesis

This section is deliberately opinionated, as requested. It is **[I]** throughout unless marked otherwise, but each claim points back to the evidence that drove it.

### 5.1 The single most important finding

**The four verticals are not four peers. They are two axes.**

- **Axis A — does the tenant move physical goods?** Retail says yes. Service says no. Manufacturing says yes, plus a production graph *on top of* the retail model.
- **Axis B — how does revenue recognize?** One-off transactional, effort-based (time/milestone), or recurring/metered.

Retail and manufacturing are **not** siblings — manufacturing is retail plus a strictly additive module. That is verified: [V] Odoo's reorder rule serves both, differing only in a route field; [V-sec] SAP models WIP as another warehouse, so production reuses the same stock mechanism. A "manufacturing tenant" is a "retail tenant" with two extra modules enabled.

Subscription is **not** a sibling of the other three either — it is a *billing mode* that can sit on top of any of them. A retailer can sell a subscription box; a service firm bills retainers on a recurring cadence; a manufacturer sells a maintenance contract. Modelling subscription as a fourth exclusive vertical would be a category error.

**Therefore the toggle model should be: goods-handling (off/basic/production) × billing modes (transactional, effort-based, recurring — independently enableable, not exclusive).** Not four vertical presets. Presets can exist as *named bundles of toggles* in the admin panel, which is exactly the onboarding experience the owner wants, but the schema should not encode four fixed shapes.

### 5.2 What genuinely belongs in the shared core

Justified by appearing in all four reference product families across at least three of the four verticals:

| Shared entity | Why it's core | Evidence |
|---|---|---|
| **Party** (customer/vendor — one entity, role flags) | Every product has both; many businesses have parties that are both. Odoo and SAP both unify (SAP calls it Business Partner). | [V-sec] |
| **Item/Product** with a **type discriminator** (goods / service / non-inventoried) | [V] Odoo's reorder rule requires product type = "Goods" *and* an inventory-tracking flag before it applies at all. Product type is already the gate that separates retail from service in the reference implementation. | [V] |
| **Document + DocumentLine** with a type discriminator | Quote/SO/PO/Invoice/Bill all share header+lines+party+totals+status. But see §5.4 — do **not** over-unify. | [I] |
| **Invoice + InvoiceLine + Payment + PaymentAllocation** | Universal. Every vertical terminates in an invoice. | [V-sec] |
| **Tax** | Universal, and jurisdiction-shaped. | [V-sec] |
| **RecurringTemplate** (scheduled / reminder / unscheduled) | [V-sec] QuickBooks applies this to transactions generally. Generalizing it once serves subscriptions, recurring bills, and recurring POs. | [V-sec] + [I] |
| **DunningLadder / FollowUpLevel** on receivables | [V-sec] Odoo puts this in *Accounting*, not in Subscriptions — correct, because any unpaid invoice needs collections regardless of vertical. | [V-sec] |
| **CostDimension** (project / job / cost-center, many-to-many weighted) | [V-sec] Odoo's analytic accounts serve project profitability *and* manufacturing job costing through one mechanism. One dimension system, many consumers. | [V-sec] |
| **ApprovalState** on any document with external side effects | Required by `.claude/rules/ai-systems.md` and matches Odoo's RFQ→PO and NetSuite's approved-time-entries. | [V] + [I] |
| **Numbering / sequence per document type per tenant** | Universal, and an early-irreversible decision. | [I] |

### 5.3 What must be an optional module

| Module | Depends on | Rationale |
|---|---|---|
| **Stock ledger** (StockMove, Location, on-hand at item×location) | — | The whole retail/manufacturing foundation. Service tenants should never see it. [V-sec] NetSuite makes multi-location itself a feature flag; QuickBooks Online Plus gates inventory behind a tier. |
| **Multi-location** | Stock ledger | [V-sec] Explicitly an enableable NetSuite feature. |
| **Bins** | Multi-location | [V-sec] A *second*, separate NetSuite feature, per-location. Two toggles, not one. |
| **Lot / serial tracking** | Stock ledger | Toggle granularity is the **item**, not the tenant. [V-sec] All three products make it an item-level tracking mode. |
| **Variants** | Item | [V-sec] Odoo's three creation modes (instant/dynamic/never) exist because materializing all combinations is often wrong. If built, build the dynamic mode. |
| **Procurement** (PO, receipt, vendor pricelist) | Stock ledger | Separable from selling. |
| **Reorder rules** | Stock ledger + (Procurement or Production) | [V] The bridge entity. Carries vendor *and* BoM. |
| **Production** (BoM, Routing, Operation, WorkCenter, MO, WorkOrder) | Stock ledger | Strictly additive to retail. [V-sec] |
| **Projects & time** (Project, Task, TimeEntry, approval) | — | Independent of stock entirely. |
| **Retainers** | Projects & time | [V-sec] Balance-carrying with drawdown ledger and separate overage rate — genuinely its own entity, per FreshBooks. |
| **Milestone / progress billing** | Projects | [V-sec] NetSuite's five billing-rule types. |
| **Subscriptions** (Plan, Add-on, Subscription, ChangeEvent, BillingCycle) | RecurringTemplate (core) | Billing mode, layerable on any vertical. |
| **Metered usage** | Subscriptions | [V-sec] Modelled by Zoho as add-ons plus a usage event stream; per-unit / tiered / overage pricing shapes. |
| **Payment-retry policy** | Subscriptions + a stored payment method | Distinct from the receivable dunning ladder in core. [V-sec] |

### 5.4 Where I'd draw variant boundaries differently than the obvious answer

Three opinionated calls where the tempting design is wrong:

**1. Do not build one polymorphic `order` table for sales and purchase orders.**
The temptation is strong — same header, same lines. But [V] every reference product keeps them separate, and the reason is behavioural, not structural: they have different parties, different approval chains, different inventory direction, different downstream documents (fulfillment vs receipt), and different AI approval gates. A shared *abstraction* (header/line/party/status) is fine; a shared *table with a direction flag* will accumulate direction-conditional logic in every query and every RLS policy. Separate, with shared shape.

**2. Do not put `quantity_on_hand` on the product, and do not put subscription proration on the subscription row.**
These are the same mistake in two verticals: **storing a derived value where the event belongs.** [V-sec] Stock is a movement ledger with derived balances at (item, location). [V-sec] Odoo's proration fires from an upsell *wizard* and not from editing subscription lines — because proration is a property of a change event. Both need an event table; both are near-irreversible if got wrong, because backfilling history you never recorded is impossible.

**3. Split "billable" from "billed" from "approved" on time entries, and split the two kinds of dunning.**
Two places where one field looks sufficient and isn't. [V-sec] Zoho's auto-invoicing scheduler operates on "unbilled timesheets", NetSuite bills only "approved" entries — three independent states. [V-sec] Zoho's subscription payment-retry (≤3 attempts, gap days, terminal action) and Odoo's receivable follow-up ladder (days overdue, action, channel) are different policies with different owners and different triggers. One `dunning_config` table would force one to pretend to be the other.

### 5.5 Implication for the Phase 5 agent runtime

The research surfaces one structural requirement that should shape Phase 3 now, not later:

**Every entity an agent can create must have a proposed/draft state that is distinct from confirmed, and that state must be the agent's default output.** [V] Odoo's RFQ-before-PO is this pattern. [V-sec] QuickBooks' three-way template type (scheduled/reminder/unscheduled) is the same idea generalized — it is literally a per-record setting for "act autonomously / propose to a human / stay manual". Adopting that trichotomy as a general property of automatable records, rather than inventing it per feature, would let the admin panel expose one consistent autonomy control across reordering, invoicing, dunning, and production release.

Separately: the deterministic recurring-invoice generation is a cron job, not an agent action. [V-sec] All four products already automate it without AI. Spending LLM calls there is pure cost with no differentiation — the AI value is concentrated in *judgement* points (vendor selection, retry timing, variance explanation, anomaly triage), which is also where `.claude/rules/ai-systems.md` cost-per-request scrutiny should focus.

---

## 6. What I could not verify

Honest gaps. Several of these matter enough that I would not let a schema decision rest on my inference alone.

**Depth of sourcing**
- Only **two** pages were fetched in full (Odoo reordering rules; a synthesis of Odoo BoM/work-order docs). Everything else is a **search-result summary of vendor documentation** — vendor-sourced, but I did not read the pages end to end. Entity *shapes* are reliable; exact field names and cardinalities beyond those stated are not.
- I did **not** consult any product's API/schema reference (Odoo ORM model definitions, NetSuite SuiteScript record browser, Zoho REST API docs). Those are the authoritative sources for field-level detail and would be the right next step before schema freeze.

**Per-product coverage gaps**
- **SAP Business One** is the weakest-sourced product here. I verified BoM, production order, item master, and warehouse concepts via SAP Learning content, but nothing on its service, project, or subscription capabilities. I do not know whether SAP B1 has a native subscription-billing model at all.
- **NetSuite** — verified on multi-location, bins, item-location records, and SuiteProjects billing rules. Not verified on its subscription-billing (SuiteBilling) entity model, which I did not search.
- **QuickBooks / FreshBooks** — verified on recurring templates, inventory limits, retainers, projects, estimates/proposals. I found **no** manufacturing/BoM capability in either, and did not verify whether QuickBooks Online has any BoM concept (QuickBooks Desktop historically did; Online I did not check). I have therefore not treated either as a manufacturing reference at all.
- **Odoo** — best covered. Reordering rules verified in full.

**Specific unverified claims a reviewer should challenge**
- The exact cardinality of Odoo's routing↔BoM and BoM↔product relationships came from a search synthesis, not the fetched page. The asymmetry claims (multiple BoMs per product; one routing per BoM; one routing across many BoMs) drove real schema recommendations in §3 and deserve direct confirmation.
- Odoo's proration-only-via-upsell-wizard behaviour came from **third-party** documentation (a partner blog), not Odoo's own docs. It shaped my §5.4 recommendation. Verify before relying on it.
- Zoho's "maximum of 3 retry attempts" is a stated vendor limit; I did not verify whether it is configurable on higher tiers or a hard cap.
- I did **not** research **multi-currency**, **fiscal-period/close**, **chart of accounts**, or **tax jurisdiction** modelling, all of which are cross-cutting and all of which are hard to retrofit. These are arguably higher-risk omissions than anything in the four verticals, because every vertical needs them and they touch every financial entity.
- I did **not** research **multi-tenant-specific** ERP concerns (per-tenant numbering sequences, per-tenant fiscal calendars, tenant-scoped catalog sharing). No reference product is multi-tenant in the way this platform is, so there is no primary source to consult — this will have to be designed rather than researched.
- **Barcode**, **landed cost**, and **inventory valuation methods (FIFO/AVCO/standard)** were noted but not researched. I flagged valuation as deferrable; that is my judgement, not a finding.
- All **AI-automatable workflow** items marked [I] are my synthesis. The *data* they would consume is verified to exist; that the workflows are valuable, feasible, or wanted is not.
