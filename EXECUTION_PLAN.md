# AI CRM-ERP — Execution Plan

> **Living document.** This file is updated every time the plan changes — a phase completes, the user gives a new standing instruction, or sequencing is revised. Check the "Last updated" line below and the change log at the bottom for the current state. Read this file whenever you need to know what's done, what's next, and why.

**Last updated:** 2026-09-05
**Current phase:** ⏸️ **PAUSED BY EXPLICIT USER REQUEST — do not execute anything until the user resumes manually.**
**Current branch:** `phase3a4-projects-time`, at commit `17bd9c6`.

## ⏸️ PAUSED — exact state and exactly what to resume

The user said: *"remember your execution plan correctly and pause the execution for now, i will resume it manually again, remember what u have to continue with."* Nothing further executes until the user explicitly says to resume. This section is the resume point.

**What is fully done and ready to merge, but NOT YET MERGED:**
- **Phase 3A-4 (Projects & Time Module) — all 4 tasks complete.** `project`/`task`/`time_entry` tables + `lib/erp/{projects,tasks,time-entries}.ts`, all task-reviewed clean (see `.superpowers/sdd/2026-09-04-phase3a4-projects-time/progress.md` for the full ledger). Task 4 (full-suite verification) confirmed 31 files/116 tests pass, `tsc --noEmit` clean, migrations 0001-0022 sequential no gaps. **Not yet done: the SDD final whole-branch review, fix wave if needed, and merge to `main`.** This is the very next SDD step once resumed.
- **Item 6 (deployment plan doc) — corrected 2026-09-05, commit `17bd9c6`.** A major architecture correction landed: the dev-page tool is NOT a config-selector on a shared deployment (the model written in commits `963dd56`/`3fc7ae9`) — it is a **generator/updater** that assembles a complete, standalone codebase per client from a fixed feature catalog, per the user's explicit correction message. See the plan doc's new §0.1 (the correction itself), §2.1.1 (corrected topology), §2.3 (re-scoped catalog, no runtime enforcement), §3.1 (narrowed scope), §3.5 (rewritten tool description), §3.5.1 (5 open questions — several block real implementation, especially #1: no per-feature file manifest exists yet).
- **Item 7 (offline dev-page tool) — BUILT AGAINST THE WRONG MODEL, NEEDS REWRITING.** [`dev-tools/client-config.html`](dev-tools/client-config.html) (commit `e23109a`) generates a manifest config file — that was correct for the superseded config-selector model, wrong for the corrected generator/updater model. **User's explicit instruction: rewrite this artifact to match the corrected design.** Not yet started.
- **Item 8 (`tools/provision-client.ts`) — ALSO BUILT AGAINST THE WRONG SCOPE, NEEDS REWRITING.** (commit `b724fd5`) Currently runs all 22 migrations unconditionally and treats the manifest row as a runtime gate. Per the plan doc's revised §3.1/§3.1.1: needs to (a) run only the migrations a client's selected features need, and (b) be callable as a step within the dev-page tool's generation flow rather than standing alone as the full pipeline. **User's explicit instruction: rewrite this artifact too.** Not yet started — blocked on the same open question as the tool above (no per-feature file manifest exists yet to know which migrations belong to which feature).

**Exactly what to do when the user says resume, in order:**
1. Re-read `docs/superpowers/specs/2026-09-03-per-client-deployment-and-ai-automation-plan.md` §0.1 and §3.5.1 in full — the correction and its 5 open questions — before touching any code, since §3.5.1 #1 (the per-feature file manifest) is a real design gap that needs an answer before the rewrite can be done properly, not guessed at.
2. Design the per-feature file manifest (§3.5.1 #1) — likely a small JSON/TS structure mapping each catalog feature to its files/migrations, plus a separate "always included" core-infrastructure list. This may need its own short design confirmation with the user before implementing, since it's genuinely new and load-bearing.
3. Rewrite `dev-tools/client-config.html` to perform Phase 1 (generate a new client's standalone codebase by copying selected features' files) and Phase 2 (update an existing client's codebase by adding/removing files for toggled features) per the plan doc's corrected §3.5.
4. Rewrite `tools/provision-client.ts` to scope migrations to the client's selected features and be callable from the dev-page tool's flow, per §3.1/§3.1.1.
5. Once both artifacts are rewritten and verified, generate a single test client's codebase end-to-end to prove the assembly logic (§7 step 4 in the plan doc).
6. **Separately and not blocked by any of the above:** finish Phase 3A-4's SDD final whole-branch review → fix wave if needed → merge to `main` → `/graphify --update`. This can happen before, after, or interleaved with steps 1-5 above since it's unrelated code (ERP schema, not the dev-page tool) — the user should be asked whether to do this first or resume the dev-page-tool correction first, since it wasn't specified.

---

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
6. **Per-client deployment & AI-automation plan — CORRECTED 2026-09-05, commit `17bd9c6`.** [`docs/superpowers/specs/2026-09-03-per-client-deployment-and-ai-automation-plan.md`](docs/superpowers/specs/2026-09-03-per-client-deployment-and-ai-automation-plan.md). Superseded its own earlier revision (`963dd56`): the dev-page tool is NOT a config-selector on a shared deployment — it's a **generator/updater** assembling a standalone codebase per client from a fixed feature catalog. See §0.1 (the correction), §2.1.1 (corrected topology), §2.3 (re-scoped catalog), §3.1 (narrowed provisioning scope), §3.5 (rewritten tool description), §3.5.1 (5 open questions, several load-bearing). **Doc itself is done; §3.5.1's open questions (esp. #1: no per-feature file manifest exists) need resolving before the artifacts below can be rewritten correctly.**
7. **Offline dev-page tool — NEEDS REWRITING to match the corrected model.** [`dev-tools/client-config.html`](dev-tools/client-config.html) (commit `e23109a`) was built against the superseded config-selector model — generates a manifest file, not a standalone codebase. Per the user's explicit instruction, this needs rewriting to actually perform Phase 1 (generate) and Phase 2 (update) file assembly per the plan doc's §3.5. **Not started.**
8. **`tools/provision-client.ts` — NEEDS REWRITING to match the corrected scope.** (commit `b724fd5`) Currently runs all 22 migrations unconditionally, treats the manifest row as a runtime gate. Per §3.1/§3.1.1: needs to run only the migrations a client's selected features need, and be callable from the dev-page tool's flow rather than the standalone full pipeline. **Not started** — blocked on the same per-feature file/migration manifest gap as item 7.
   - **Supabase ownership decision (2026-09-05, still valid, unaffected by the generator/updater correction):** each client creates/owns their own Supabase project, hands us a connection string; we never own client databases. Recorded in the plan doc §2.1/§3.1 (commit `3fc7ae9`).
   - **Forward-looking note (not designed, not scheduled):** compute may move from Cloudflare Workers to a self-hosted VPS at some future point.
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
- **2026-09-05 (execution resumed, Supabase decision):** User approved the deployment plan doc and said proceed. Resuming item 8 surfaced a real Neon `Projects Limit: 0` wall; via brainstorming the user made a deliberate architecture decision — each client creates/owns their own Supabase project, hands us a connection string, we never own client databases. Recorded in the plan doc §2.1/§3.1 (commit `3fc7ae9`) and here. Built `tools/provision-client.ts` (commit `b724fd5`) against this model; dry-run verified against the dev DB.
- **2026-09-05 (Phase 3A-4 executed):** With item 8 blocked on a real client connection string not existing, resumed Phase 3A-4 via SDD. All 4 tasks completed and task-reviewed clean (project table, task table, time_entry table, full-suite verification: 31 files/116 tests pass). Not yet merged — final whole-branch review is the next SDD step.
- **2026-09-05 (major architecture correction):** User sent a detailed correction: the dev-page tool and deployment model built above (a shared deployment gated by a runtime feature-manifest flag) is WRONG. Corrected model: the dev-page tool is a local generator/updater that assembles a complete, standalone, per-client codebase by selectively copying already-written feature source from the shared repo (Phase 1: build new client; Phase 2: update existing client by toggling catalog features) — bounded to a fixed feature catalog, not open-ended editing. Each real client gets separate hosting (own VPS/Supabase), not shared infrastructure (trial/dev phase excepted). Rewrote the plan doc's §0 (added §0.1 correction), §2.1 (added §2.1.1 corrected topology), §2.3 (re-scoped catalog, no runtime enforcement), §3.1 (narrowed scope), §3.5 (rewritten tool description), §3.5.1 (new — 5 open questions, esp. #1: no per-feature file manifest exists yet). Reconciled against §1's anti-fork research explicitly (not silently contradicted) — flagged as a real open tension, not resolved. Committed `17bd9c6`. User then explicitly said to rewrite the two already-built artifacts (`dev-tools/client-config.html`, `tools/provision-client.ts`) to match, but before that work started, user asked to pause execution entirely and resume manually later — this file rewritten to serve as the exact resume point (see "⏸️ PAUSED" section above §1).
