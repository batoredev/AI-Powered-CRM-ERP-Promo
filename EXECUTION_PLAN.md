# AI CRM-ERP — Execution Plan

> **Living document.** This file is updated every time the plan changes — a phase completes, the user gives a new standing instruction, or sequencing is revised. Check the "Last updated" line below and the change log at the bottom for the current state. Read this file whenever you need to know what's done, what's next, and why.

**Last updated:** 2026-09-05
**Current phase:** Phase 3A-4 merged. Dev-page-tool correction code-complete (one manual browser step remains for the user). Next: pick up item 9 (Subscriptions module) or the remaining manual dev-page-tool verification.
**Current branch:** `main`, at commit `221679b`.

## Phase 3A-4 — MERGED 2026-09-05

Final whole-branch review (Opus, adversarial cross-tenant probes against the live dev DB) returned **Approved for merge** for commits `a677e3c..aebd0d8` — no Critical/Important findings on the reviewed range itself. The review also caught a real Important-severity bug in `dev-tools/feature-manifest.json` (`erp.projects_time` missing a transitive `erp.core` dependency for the `approval_state` enum — an enum-type dependency invisible to the `REFERENCES`-clause-only verification method used when the manifest was first written). Fixed immediately (commit `221679b`), verified via a manifest-resolution simulation before committing.

Merged locally via `finishing-a-development-branch`: tests green pre-merge (31/31 files, 116/116 tests) and post-merge on `main` (same result), feature branch deleted, `/graphify --update` run (1131 nodes, 1695 edges, 145 communities, confirmed built from the merge commit).

**Reviewer's noted risks, not blocking, worth remembering for later phases:**
- `project`/`task` have no update/delete functions yet — the "task always belongs to its stated project" invariant is only enforced at create time. A future `updateTask` would need a composite FK (`time_entry (task_id, project_id)` → `UNIQUE (id, project_id)` on `task`) to keep this enforced in the database once mutation exists.
- Rate resolution is unreachable from `time_entry` today — only `task.hourly_rate_minor_units` exists and `taskId` is nullable, so a project-level (no task) entry has no rate source. Correctly deferred, but the future invoice-generation sweep needs this solved first.
- A manifest-dependency validator (parsing both `REFERENCES` clauses and `CREATE TYPE`/enum usage) was flagged as a good `tools/` candidate — the reviewer hand-wrote one ad hoc to catch the bug above. Not built yet; worth doing before the feature catalog grows much further.

## Dev-page-tool correction — status (code complete, one manual step remains)

1. ✅ Built [`dev-tools/feature-manifest.json`](dev-tools/feature-manifest.json) — explicit per-feature `files`/`migrations`/`dependsOn`, verified complete against the real file tree, since patched for the enum-dependency bug above.
2. ✅ Rewrote [`dev-tools/client-config.html`](dev-tools/client-config.html) as a real Phase 1 (generate)/Phase 2 (update) file-assembly tool.
3. ✅ Rewrote [`tools/provision-client.ts`](tools/provision-client.ts) — `--manifest` required, scoped migrations only, dry-run verified against the dev DB.
4. ⏳ **Remaining, requires you personally:** generate a single test client's codebase end-to-end by running `dev-tools/client-config.html` in a browser (Chrome/Edge) — I cannot drive a File System Access API tool myself.

**What's still open (plan doc §3.5.1, by design):** #2 (drift detection) and #5 (VPS/compute hosting story) remain unanswered, flagged in the doc, not guessed at.

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
5. **Phase 3A-4 — Projects & Time Module.** `project`/`task`/`time_entry` tables + data-access layer, gated by `'effort_based' IN billing_modes`. Merged 2026-09-05 at commit `221679b` (see "Phase 3A-4 — MERGED" section above for review details).

### ⏭️ Not started, in strict sequence (no more parallel/interleaved tracks — see §5 2026-09-04)
6. **Per-client deployment & AI-automation plan — CORRECTED 2026-09-05, commit `17bd9c6`. Done.** [`docs/superpowers/specs/2026-09-03-per-client-deployment-and-ai-automation-plan.md`](docs/superpowers/specs/2026-09-03-per-client-deployment-and-ai-automation-plan.md). The dev-page tool is a **generator/updater** assembling a standalone codebase per client from a fixed feature catalog, not a config-selector on a shared deployment. See §0.1 (the correction), §2.1.1 (corrected topology), §2.3 (re-scoped catalog), §3.1 (narrowed provisioning scope), §3.5 (rewritten tool description), §3.5.1 (5 open questions, #1 now resolved — see item 7).
7. **Offline dev-page tool — REWRITTEN 2026-09-05, commit `04a5422`. Code done, manual verification pending.** [`dev-tools/client-config.html`](dev-tools/client-config.html) now genuinely performs Phase 1 (generate) and Phase 2 (update) file assembly — two folder grants (repo root + output), dependency-aware feature toggling, topological migration ordering. Backed by [`dev-tools/feature-manifest.json`](dev-tools/feature-manifest.json) (commit `0b6ee73`) — the per-feature file/migration manifest that resolves §3.5.1 #1, verified complete against the real file tree (32/32 files, 22/22 migrations, zero gaps). **Remaining: you personally running it in a browser to generate one test client end-to-end** — I can't drive a File System Access API tool myself.
8. **`tools/provision-client.ts` — REWRITTEN 2026-09-05, commit `43a6ae8`. Done.** `--manifest` is now required, runs only the migrations a client's selected features need (verified via dry-run: 16/22 migrations for a 4-feature test manifest, correctly scoped down), dropped the superseded `tenant_erp_settings` runtime-manifest write. Type-checked clean.
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
- **2026-09-05 (resumed, correction implemented):** User resumed and chose dev-page-tool correction first over merging Phase 3A-4. Designed the per-feature file manifest via a confirming AskUserQuestion (explicit per-feature declaration, not folder-convention inference) and built `dev-tools/feature-manifest.json` (commit `0b6ee73`) — verified complete via a diff against the real file tree (32/32 files, 22/22 migrations). Confirmed real migration dependency chains via `REFERENCES` clause inspection before writing the manifest, not assumed from filenames. Asked and confirmed the manifest-sharing mechanism between the browser tool and the Node script (a second `showDirectoryPicker` grant on the repo root, one JSON source of truth) over an embedded-copy alternative, per the user's "highly efficient, does not cause error" framing. Rewrote `dev-tools/client-config.html` (commit `04a5422`) as a genuine two-phase generator/updater and `tools/provision-client.ts` (commit `43a6ae8`) to consume the new manifest shape and scope migrations to selected features only — both verified (tsc clean, two dry-runs against the real dev DB for the script; the HTML tool's own browser-driven verification is flagged as the one remaining manual step, since it can't be run from this session). Phase 3A-4 remains unmerged, deliberately deferred per the user's own resume-order choice.
- **2026-09-05 (Phase 3A-4 merged):** Ran the final whole-branch review on Opus, scoped exactly to Phase 3A-4's own 3 commits (`4b64a67..aebd0d8`), separate from the unrelated dev-page-tool commits also on the branch. Reviewer ran 4 adversarial cross-tenant probe tests directly against the live dev DB (not just read code) and found the cross-tenant FK chain genuinely closed — approved for merge, zero Critical/Important findings in the reviewed range. Reviewer also independently caught a real Important-severity bug in `dev-tools/feature-manifest.json` (commit `0b6ee73`, written earlier the same day): `erp.projects_time` was missing a transitive `erp.core` dependency needed for the `approval_state` enum type, which the original `REFERENCES`-clause-only verification method couldn't see (enum type usage isn't a `REFERENCES` clause). Fixed immediately, verified via a manifest-resolution simulation, committed (`221679b`) before merging. Merged `phase3a4-projects-time` into `main` via `finishing-a-development-branch` (tests green pre- and post-merge, 31/31 files, 116/116 tests), branch deleted, `/graphify --update` run per standing instruction (1131 nodes/1695 edges/145 communities).
