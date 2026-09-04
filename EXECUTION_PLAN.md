# AI CRM-ERP — Execution Plan

> **Living document.** This file is updated every time the plan changes — a phase completes, the user gives a new standing instruction, or sequencing is revised. Check the "Last updated" line below and the change log at the bottom for the current state. Read this file whenever you need to know what's done, what's next, and why.

**Last updated:** 2026-09-04
**Current phase:** Phase 3A-4 (Projects & Time Module) — plan written, not yet implemented.
**Current branch:** `phase3a3-production-module` (stale — Phase 3A-3 already merged to `main` at commit `7a5aff9`; next branch will be created off `main` for 3A-4).

---

## 1. What this project is

A production-grade, multi-tenant AI-powered CRM+ERP SaaS platform. Built phase by phase using Subagent-Driven Development (SDD): implement → task-review → fix-loop → final whole-branch review → merge. Every phase gets full rigor — no shortcuts, no unverified "done" claims.

**Stack:** Next.js 15 App Router, Cloudflare Workers (`@opennextjs/cloudflare`), Neon Postgres.

**Multi-tenancy model:** Shared codebase, **separate deployment per client** (own DB, own server process, single-tenant data). Row-Level Security (`FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy on every tenant-scoped table) stays in place as defense-in-depth even though each client's DB will only ever hold one tenant — it's free insurance, not overhead. This was an explicit architectural decision (see §5, "Standing decisions").

---

## 2. Sequence — in order

This is the authoritative order. Items are worked top to bottom; nothing later starts before everything earlier is genuinely done (tests green, reviewed, merged).

### ✅ Done
1. Phase 1A, 2A, 2B — CRM core (contacts, pipeline/deals), foundational auth/tenant plumbing. Merged.
2. Phase 3A-1 — ERP foundation (vendor, product, document sequences, tenant ERP settings). Merged.
3. Phase 3A-2 — Inventory (location, stock_move ledger, purchase orders + receiving). Merged.
4. Phase 3A-3 — Production module (bill_of_materials, work_center, routing, manufacturing_order, work_order). Merged at commit `7a5aff9`.

### 🔄 In progress
5. **Phase 3A-4 — Projects & Time Module.** Plan written: [`docs/superpowers/plans/2026-09-04-phase3a4-projects-time.md`](docs/superpowers/plans/2026-09-04-phase3a4-projects-time.md). Adds `project`, `task`, `time_entry` tables + data-access layer, gated by `'effort_based' IN billing_modes`. Schema + data layer only, no UI, no invoicing yet. Next action: commit the plan, branch, run SDD (4 tasks).

### ⏭️ Not started, in order
6. **Subscriptions module** — last remaining row of the design spec's module table (§4), gated by `'recurring' IN billing_modes`. Retainers (deferred out of 3A-4's scope) may fold in here since it depends on Projects & time.
7. **Phase 3B — ERP UI** — screens for everything built in Phase 3A-1 through the Subscriptions module.
8. **CRM gap-audit follow-up** — deferred by explicit user decision ("finish Phase 3 first"). From the CRM feature audit (Salesforce/HubSpot/Zoho/Pipedrive/D365/Twenty/EspoCRM/SuiteCRM/Odoo comparison), ranked by retrofit cost:
   1. Polymorphic activity/timeline model (most expensive to retrofit later — highest priority)
   2. Deal stage-history
   3. Company as a first-class entity (distinct from contact)
   4. Lead entity + lead→deal conversion
   5. Deal↔product line items
   6. Custom fields strategy
   7. Exchange-rate history
   8. AI cost/quota accounting
   9. Native MCP server
9. **Dedicated multi-agent UI/design pass** — standing instruction, must happen after everything above and before Phase 4. Uses the real specialist roster (design-director, frontend-lead, design-engineer, taste-director, accessibility-engineer, etc.), not solo work. Covers all CRM+ERP screens built so far that haven't had a real design pass.
10. **Phase 4 — Omnichannel inbox** (all customer contact channels viewable/repliable from one page), per the original roadmap.

### 🔀 Parallel track (not blocking, not blocked by the above)
- **Per-client deployment & AI-automation plan** — owned by a peer session, at [`docs/superpowers/specs/2026-09-03-per-client-deployment-and-ai-automation-plan.md`](docs/superpowers/specs/2026-09-03-per-client-deployment-and-ai-automation-plan.md) (local branch `plan/per-client-deployment-ai-automation`, not yet merged/pushed). Confirms shared-codebase-per-client-deployment, designs provisioning tooling (`tools/provision-client.ts`, `deploy-update.ts`, `fleet-status.ts`), a 3-layer feature manifest (route/UI, API, AI tool-contract), and an AI-automation roadmap (first workflow: "low-stock → draft purchase order"). **Still requires:**
  - An **offline local dev-page tool** (developer-only, never shipped to production, output-only pushed to a client's GitHub repo) — pattern confirmed via the user's own reference implementation `dev.html` (File System Access API: `showDirectoryPicker` + `getFileHandle(...,{create:true})` + `createWritable()`). Peer session is incorporating this; not yet written into the plan doc.
  - User approval, including answers to 4 open decisions (autonomy posture, pricing model, client-count scale, regulated-domain appetite).
  - Once approved: provision a test client → extend tool-contract with ERP tools → first automated workflow in shadow mode → first real client.

---

## 3. Standing decisions (binding, don't re-litigate)

- **Architecture:** shared codebase, one deployment per client, RLS kept as defense-in-depth. (Resolved a conflict between two parallel sessions; user's deciding instruction: "go with your recommended option itself, but make sure each client will have their own customised software.")
- **GDPR vs. append-only history conflict** (design spec §7 vs §8): resolved as soft-delete/tombstone.
- **CRM gaps timing:** finish all of Phase 3 (ERP) first, then CRM gaps (see §2 item 8).
- **UI pass timing:** finish everything else, then a dedicated multi-agent UI pass, then Phase 4 (see §2 item 9).
- **Graphify:** run `/graphify --update` after every phase merges to `main`.
- **Dev/config tool:** must be genuinely invisible in the production build — an offline, local-only tool whose *output* (generated code) gets pushed to a client's repo, not a hosted-but-gated page.
- **Cross-tenant FK validation:** every `create*` function taking a foreign key must validate that entity belongs to the calling tenant via its own `get*` function, before any write — baked in from the start of each new module (lesson learned the hard way in 3A-2 and 3A-3, both needed post-hoc fix waves).

---

## 4. Recurring technical conventions

- All tenant-scoped DB access via `withTenant()` (`lib/db/with-tenant.ts`) — never raw `getSql()`.
- Every table: `FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy (enforced by `db/migrations/__tests__/rls-policy-audit.test.ts`).
- Money: `*_minor_units bigint` + `currency_code text`, never floats.
- Append-only ledgers over mutable running totals (e.g. `stock_move`, never a stored `quantity_on_hand`).
- Never collapse independent state facts into one column (e.g. `time_entry`'s `billable` / `billed` / `approval_state` are three separate facts, not one).
- State-flip + dependent-write combos run in one shared transaction, with the guarded `UPDATE ... WHERE status = X RETURNING *` first.
- SDD ledgers live at `.superpowers/sdd/<plan-basename>/progress.md` (gitignored) — durable per-plan recovery record across context resets.

---

## 5. Change log

- **2026-09-04:** Created this file per explicit user request ("give me your execution plan in detail... save this execution plan as a file... update this file whenever there is any kind of change"). Reflects state as of Phase 3A-4 plan being written (not yet implemented).
