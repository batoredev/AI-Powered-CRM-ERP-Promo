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

### ⏭️ Not started, in strict sequence (no more parallel/interleaved tracks — see §5 2026-09-04)
6. **Per-client deployment & AI-automation plan — finalize the doc.** [`docs/superpowers/specs/2026-09-03-per-client-deployment-and-ai-automation-plan.md`](docs/superpowers/specs/2026-09-03-per-client-deployment-and-ai-automation-plan.md) + its two research docs are on `main`. §5 open decisions already resolved by the user (2026-09-04):
   - Autonomy posture: **graduated autonomy** — workflows start draft-only (human approves every action) and earn auto-execute rights over time based on a track record, per workflow.
   - Pricing model: **both flat monthly per client AND usage/seat-based** — a hybrid, not one exclusively. Exact mix (e.g. flat base + metered overage) still needs to be worked out when the plan doc is revised.
   - Client-count scale: **small — up to ~20 clients.** No need to design around Cloudflare's 500-Worker/100-domain-per-zone ceilings yet.
   - Regulated-domain appetite: **yes, eventually.** Don't build compliance controls (HIPAA/SOC2/PCI etc.) now, but don't architect in a way that closes the door on adding them later.
   - Remaining work at this step: (a) independently verify the `dev.html` reference's exact API usage (`showDirectoryPicker`, `getFileHandle`/`createWritable`, `FF_GROUPS` feature-flag pattern) — the peer session had only confirmed the file exists (2075 lines), not re-verified the specific calls; (b) write the offline dev-page tool section into the plan doc using that verified pattern; (c) fold the 4 §5 resolutions above into the doc's own text; (d) present the revised doc for the user's final sign-off.
7. **Offline dev-page tool — build it.** A single self-contained local HTML tool, run only on the developer's own machine — never part of the production build, never visible to any client. Only its generated *output* (a client's deployment code) gets pushed to that client's GitHub repo — the tool itself never ships anywhere. Built after step 6's doc is signed off, using the verified `dev.html` pattern.
8. **Per-client deployment implementation** — per the signed-off plan's own §7 ordering: provision a test client (`tools/provision-client.ts`) → extend the AI tool-contract with ERP tools → run the first automated workflow ("low-stock → draft purchase order") in shadow mode → onboard the first real client.
9. **Subscriptions module** — last remaining row of the design spec's module table (§4), gated by `'recurring' IN billing_modes`. Retainers (deferred out of 3A-4's scope) may fold in here since it depends on Projects & time.
10. **Phase 3B — ERP UI** — screens for everything built in Phase 3A-1 through the Subscriptions module.
11. **CRM gap-audit follow-up** — deferred by explicit user decision ("finish Phase 3 first"). From the CRM feature audit (Salesforce/HubSpot/Zoho/Pipedrive/D365/Twenty/EspoCRM/SuiteCRM/Odoo comparison), ranked by retrofit cost:
    1. Polymorphic activity/timeline model (most expensive to retrofit later — highest priority)
    2. Deal stage-history
    3. Company as a first-class entity (distinct from contact)
    4. Lead entity + lead→deal conversion
    5. Deal↔product line items
    6. Custom fields strategy
    7. Exchange-rate history
    8. AI cost/quota accounting
    9. Native MCP server
12. **Dedicated multi-agent UI/design pass** — standing instruction, must happen after everything above and before Phase 4. Uses the real specialist roster (design-director, frontend-lead, design-engineer, taste-director, accessibility-engineer, etc.), not solo work. Covers all CRM+ERP screens built so far that haven't had a real design pass.
13. **Phase 4 — Omnichannel inbox** (all customer contact channels viewable/repliable from one page), per the original roadmap.

---

## 3. Standing decisions (binding, don't re-litigate)

- **Architecture:** shared codebase, one deployment per client, RLS kept as defense-in-depth. (Resolved a conflict between two parallel sessions; user's deciding instruction: "go with your recommended option itself, but make sure each client will have their own customised software.")
- **GDPR vs. append-only history conflict** (design spec §7 vs §8): resolved as soft-delete/tombstone.
- **CRM gaps timing:** finish all of Phase 3 (ERP) first, then CRM gaps (see §2 item 11).
- **UI pass timing:** finish everything else, then a dedicated multi-agent UI pass, then Phase 4 (see §2 item 12).
- **Execution ordering:** strict sequence, not parallel tracks (user instruction 2026-09-04, for easier monitoring) — the deployment/AI-automation plan and dev-page tool now occupy fixed numbered slots (§2 items 6-8) rather than running interleaved in the background. Nothing after item 5 (Phase 3A-4) starts until everything before it is done, in order.
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
- **2026-09-04 (later):** User directed the parallel track to be actively worked alongside the main sequence rather than sit idle. Resolved the deployment plan's 4 open §5 decisions via AskUserQuestion (graduated autonomy; hybrid flat+usage pricing; small/~20-client scale; yes-eventually on regulated domains) and recorded them. Pinged peer session `ai-crm-erp-74` for dev-page-section status. Split the offline dev-page tool out into its own tracked line item per user request, distinct from the rest of the deployment plan.
- **2026-09-04 (takeover):** User instructed that all tasks — including the parallel track — run in this session instead of split across two sessions. Messaged `ai-crm-erp-74` to stand down; it confirmed a clean handoff (nothing in flight, nothing lost — it had confirmed `dev.html` exists but not yet independently verified its exact API usage). Pulled its branch `plan/per-client-deployment-ai-automation` (commit `302e1dc`) into `main` via merge commit `0aaa3a8`. The deployment plan and both research docs are now on `main`; this session owns finishing them (dev-page section, §5 resolutions written into the doc itself, then implementation) going forward.
- **2026-09-04 (sequencing):** User asked when the parallel track would run and, on hearing it wasn't on a fixed schedule, explicitly requested strict sequencing instead of parallel/interleaved execution, for easier monitoring. Converted §2 items 6-8 (deployment plan finalization → dev-page tool build → deployment implementation) from a standalone "parallel track" section into fixed numbered steps in the main sequence, immediately after Phase 3A-4 (item 5) and before the Subscriptions module (now item 9). No work executed as part of this change per explicit user instruction ("dont execute anything now") — plan-only update.
