# Plan: Per-Client Deployment Architecture + AI-Automation Roadmap

**Date:** 2026-09-03
**Status:** Ready for review. **Nothing in this plan has been implemented.** Per the
user's explicit sequencing (research → plan → implement), execution begins only
after this document is reviewed and approved.
**Author:** Claude session `ai-crm-erp-33`, coordinated with peer session
`ai-crm-erp-ad` (owns Phase 3A-3 ERP schema work, unaffected by this plan — see
§0).
**Research this plan is built on:**
- [`research/2026-09-03-per-client-deployment-model.md`](research/2026-09-03-per-client-deployment-model.md)
- [`research/2026-09-03-ai-native-business-backend.md`](research/2026-09-03-ai-native-business-backend.md)
- Prior CRM feature-gap research (2026-09-01, referenced inline where relevant)

---

## 0. What this plan does and does not change

**Confirmed architecture (resolved with the user across two sessions on
2026-09-03, after research contradicted the initial "forked repo per client"
framing):**

- **One shared codebase** (this repo). Not forked per client.
- **One deployment per client** — own database, own server process, full data
  isolation.
- **Features selected per client at build/deploy time**, not by forking code.
- **Existing Row-Level Security (`tenant_id`, 14 `CREATE POLICY` statements,
  `withTenant` helper, `rls-policy-audit.test.ts`) is kept, not stripped.** Each
  client's database will only ever contain one tenant row, so RLS is inert but
  free — zero runtime cost, zero re-testing cost, and it stays as a second
  independent safety net against a bug in application-level tenant scoping. This
  was explicitly evaluated against "strip RLS since single-tenant DBs don't need
  it" and rejected — see research doc §"Security/compliance" for the reasoning.

**Not affected by this plan:** the peer session's Phase 3A-3 production-module
work (`bill_of_materials`, `bom_component`, and upcoming work
centers/routing/manufacturing-order tables) is schema-domain work that proceeds
unchanged — it's built on the existing RLS pattern, which this plan keeps. No
rework needed there.

---

## 1. Why not literal per-client forks (research summary)

Full findings in the linked research doc. Headline: every successful operator
found at any scale — a 3-person team running ~6,000 AWS tenant accounts, GitLab
Dedicated, Pantheon's agency-upstream model, Vercel's own published guidance —
runs **one codebase, deployed many times**, not many forked codebases. No credible
example was found of anyone maintaining hundreds or thousands of genuinely forked
per-client codebases for the same product; the pattern that appears to work is
consistently "one artifact, many isolated deployments."

The deciding factor, once put to the user directly: **security**. N forked
codebases means N places a security fix has to be manually reapplied, forever —
directly contrary to "safe and secure," which the user named as the actual
priority when this was pressure-tested. A shared codebase means one fix, one
deploy pipeline, propagated to every client's instance automatically.

---

## 2. Target architecture

### 2.1 Deployment topology

```
                     +-------------------------------+
                     |   Golden codebase (this repo)  |
                     |   -- single source of truth    |
                     +----------------+----------------+
                                      |
                     provision-client.ts (idempotent)
                                      |
        +-----------------+----------+----------+-----------------+
        v                 v                     v                 v
  +-----------+     +-----------+         +-----------+     +-----------+
  | Client A  |     | Client B  |   ...   | Client N  |     |  (new)    |
  | Worker    |     | Worker    |         | Worker    |     | provision |
  | Neon DB   |     | Neon DB   |         | Neon DB   |     | on demand |
  | manifest  |     | manifest  |         | manifest  |     |           |
  | own domain|     | own domain|         | own domain|     |           |
  +-----------+     +-----------+         +-----------+     +-----------+
```

- **Compute:** Cloudflare Workers (current platform, via OpenNext), one Worker per
  client.
- **Database:** Neon Postgres, one project per client. Scale-to-zero keeps idle
  clients near-zero cost — this is the mechanism that makes per-client databases
  economically viable at all (contrast an always-on-VM provider, which would cost
  roughly $1,000/mo for 100 small tenants per the research).
- **Domain:** one custom domain or subdomain per client, DNS + SSL automated
  through the provisioning script.
- **Schema:** every client runs the *same* migration set (all tables always
  exist). A disabled feature means unused tables, not absent ones — this is what
  keeps the codebase genuinely shared and updatable, and avoids the worst failure
  mode found in research (per-client schema drift).

### 2.2 The known ceiling on this platform, planned around now

Cloudflare's standard account allows **500 Workers**; the mechanism for going
beyond that (Workers for Platforms) is **Enterprise-only with custom pricing**.
Custom domains are capped at **100 per zone**. This plan assumes the client count
stays within these limits through the roadmap below; §6 names re-evaluating the
platform (or negotiating an Enterprise plan) as an explicit trigger once the
client count approaches ~80-100, well before either limit is hit.

### 2.3 Per-client feature manifest

Each client's database carries one config row (extending the existing
`tenant_erp_settings` pattern from migration `0006` to cover the whole app, not
just ERP settings) declaring which modules/features are active:

```jsonc
// conceptual shape -- actual implementation is a DB table, not a JSON file
{
  "modules": {
    "crm": { "contacts": true, "pipeline": true, "deals": true },
    "erp": { "vendors": true, "products": true, "inventory": true,
             "purchase_orders": true, "production": false },
    "ai":  { "lead_scoring": true, "auto_draft_emails": true,
             "autonomous_po_drafting": false },
    "channels": { "whatsapp": false, "email": true }
  }
}
```

**Enforced at three layers**, all reading the same manifest — this triple-check
is deliberate, not redundant, because each layer protects against a different
failure:

1. **Route/UI layer** — a disabled module's routes 404 and its nav items don't
   render. This is also explicitly the mechanism the project's own design doc
   §1a already committed to as a *complexity control*: "a tenant's UI only ever
   shows installed/active plugins."
2. **API/data-access layer** — server actions and API handlers check the
   manifest before executing, independent of whether the UI correctly hid the
   button (defense against a client hitting a disabled endpoint directly).
3. **AI tool-contract layer** — the agent's available tools
   (`CRM_TOOL_DEFINITIONS`-equivalent, extended across CRM+ERP) are filtered per
   client. If `production` is off, the agent cannot see or call BOM/manufacturing
   tools at all — not just "the UI hides the button." This is a safety property,
   not just a UX one: an agent should never have a capability the client never
   enabled.

Changing a client's feature set later is a manifest update + redeploy of that one
client's Worker — not a rebuild, since the code for every module already exists
in the shared codebase.

---

## 3. Provisioning and update-propagation tooling

Per this project's own WAT rules (`.claude/rules/wat.md` §1, §7): this is
mechanical, repeatable work and belongs in `tools/`, not reasoned through by hand
per client.

### 3.1 `tools/provision-client.ts` (new)

Idempotent script, re-runnable safely. Given a client name and a feature-manifest
selection:

1. Create a new Neon Postgres project for the client.
2. Run the full migration set against it (all 15+ migrations, unchanged — RLS
   included).
3. Insert the client's feature-manifest row.
4. Create a Cloudflare Worker for the client (or a route within the existing
   Worker + custom domain, depending on the §2.2 ceiling — evaluate both options
   during implementation and pick based on the actual Cloudflare Workers-for-
   Platforms pricing quote).
5. Attach the client's domain, verify SSL issuance.
6. Write the client's connection secrets to the deploy environment (never into
   source control — per `.claude/rules/security.md`, "never hardcode secrets").
7. Record the client in a central fleet registry (see 3.3).

### 3.2 `tools/deploy-update.ts` (new)

Given a git ref (a merged commit/tag on `main`), re-deploys that build to some or
all client Workers. Must support:
- **Staged rollout** — a subset of clients first, full fleet after a health
  check, not a single all-or-nothing push. The research is explicit that partial
  rollouts are the *normal* failure mode in every fleet-scale case study found,
  not an edge case — the tooling must assume partial failure, not treat it as
  exceptional.
- **Per-client migration application** — each client's database gets the new
  migrations applied as part of its own deploy, with failure handling per client
  (a migration failing on client B must not block client A's already-successful
  deploy). Per `.claude/rules/production.md`, migrations are production code —
  this applies per client now, not once globally.

### 3.3 `tools/fleet-status.ts` (new)

Reports, per client: deployed code version, migration level, feature manifest,
last successful health check. This is the tool that prevents the "invisible
version drift until it's an incident" failure mode the research flagged as the
single most common real-world failure at this pattern's scale.

### 3.4 Customization discipline (from research, enforced structurally)

The research finding that makes automated update propagation actually work:
**automated merges survive exactly as long as client customization and core
updates never touch the same file.** This is enforced by *structure*, not
discipline alone:

- Per-client customization lives in a manifest/config layer and, if ever needed,
  an isolated overlay directory the core codebase never writes to.
- Core application code is never edited per client. If a client needs something
  the shared codebase doesn't do, it becomes a feature flag or a proper module in
  the shared codebase (available to everyone, gated by the manifest), not a
  one-off edit.

---

## 4. AI-automation roadmap — what makes this unique in the market

Per the AI-native-business-backend research: the "AI CRM/ERP" category is already
funded and contested (Campfire, Basis, SAP Autonomous Suite, Microsoft Business
Central agents all shipped or funded by mid-2026). **Chat drafting and lead
scoring are commodity now.** Differentiation has to come from structure, not
feature count.

### 4.1 The four-part core thesis (irreducible — build these together, not as
   independent features)

1. **Cross-domain agent handoff on the single unified CRM+ERP schema.**
   Structurally impossible for SAP/Microsoft to retrofit (legacy module
   boundaries); out of scope for every domain-siloed startup found (Basis =
   accounting only, Campfire = finance-ERP only). This project's own design doc
   §5 already names this as the differentiator — this plan operationalizes it.
   Concretely: extend the existing `CRM_TOOL_DEFINITIONS` pattern
   (`lib/crm/tool-contract.ts`) with ERP tools (vendor, product, stock, purchase
   order, BOM — all schema already exists per the peer session's work) into one
   tool set, so a single agent turn can act across both, per the design doc's own
   example ("customer asks about order status" → check ERP order + CRM history →
   draft/send reply, in one pass).

2. **Graduated, earned autonomy** — not a fixed "AI assistant" posture. Every
   agent action carries an autonomy level (suggest → prepare-for-approval →
   auto-execute-under-threshold → autonomous) that *rises per workflow, per
   client, based on measured accuracy*, not a global setting. This is the highest
   -defensibility item found in research — a genuine compounding data flywheel,
   not a feature a competitor can copy by reading a changelog.

3. **Immutable, full-provenance audit trail.** Every agent action reconstructible:
   inputs, retrieved context, tool calls, model version, confidence score, human
   touchpoints. Already named a sales differentiator in this project's own design
   doc §7a. Implementation should target MCP's OpenTelemetry trace-context
   propagation (`_meta.traceparent`/`tracestate`/`baggage`, spec `2026-07-28`
   SEP-414) so this satisfies the project's own `ai-systems.md` tracing
   requirement using a standard rather than a bespoke logging scheme.

4. **Shadow-mode simulation before activation.** Every new automated workflow
   runs read-only against a client's live data first, scored against what a human
   actually did, before it's ever allowed to act. This is the practice every
   credible production account in the research converges on, and it's what
   generates the accuracy evidence that powers #2 (a workflow can't earn
   autonomy without a measured track record).

### 4.2 Protocol foundation — must-do before agent work proceeds

**The MCP spec moved to `2026-07-28` with breaking changes from any earlier
version.** This is flagged as the single most load-bearing technical finding in
the research and applies directly to any teammate (human or AI) extending
`lib/crm/tool-contract.ts` or building the ERP tool equivalent:

- No more `initialize` handshake or protocol-level sessions — a long-running
  workflow must carry its own state handle as an explicit argument.
- Approval gating has a **protocol-native mechanism**: a tool call needing human
  sign-off returns `resultType: "input_required"` instead of needing bespoke
  approval-UI plumbing built from scratch. This should be the actual
  implementation of the `approval_state` enum's runtime behavior (schema already
  shipped in migration `0007`) — use the protocol primitive rather than
  reinventing one.
- Long-running business processes (a month-end close, a multi-day procurement
  cycle) should be modeled on MCP's `tasks` extension
  (`tasks/get`/`tasks/update`/`tasks/cancel`), not as chat-style request/response
  turns.

### 4.3 Sequencing (informed by research's "narrow scope first" finding)

The research is explicit that the one verified pattern behind every production
success is **narrow, high-volume, clear definition of done** — directly in
tension with "complete backend for any business." Resolution: **unified schema
from day one (already true — CRM+ERP share one data model), but ship one fully
automated cross-domain workflow end-to-end before broadening.**

**Recommended first workflow — low-stock → draft purchase order:**
- Uses only tables that already exist (`stock_move`, `product`, `vendor`,
  `purchase_order`, `approval_state`) — no new schema required to start.
- Naturally approval-gated by the already-shipped `approval_state` enum, so it
  doesn't require solving the hardest autonomy-safety questions (design doc §5a)
  before it's useful — the human-approval step is already a first-class concept
  in the schema.
- Is the smallest concrete instance of the core thesis (§4.1.1): the agent
  reasons across ERP inventory data and CRM/vendor relationship data in one pass.

**After the first workflow proves out** (shadow mode → measured accuracy →
graduated autonomy, per §4.1.2 and §4.1.4), broaden to the next workflows in
priority order from the research's ranked list:
5. Mandate-based authorization generalized beyond this first workflow to every
   consequential action (refunds, discounts, other financial approvals) —
   generalizing the AP2 Intent/Cart/Payment Mandate pattern.
6. Tenant-specific business decision memory — every human override on the first
   workflow becomes a labeled signal, generalized once there's a second workflow
   to compare against.
7. Cross-domain proactive triggers beyond low-stock (stale deals, SLA-aging
   messages) — per the existing design doc §5 roadmap phase 7.

**Explicitly deferred, not because they're unimportant but because the research
flags them as expensive/risky for a first release:**
- Regulated-domain automation (tax, payroll) — legal liability distinct from
  ordinary bugs.
- A2A (agent-to-agent cross-company protocol) — only relevant once agents need to
  negotiate with a client's *vendor's* agent, not for internal CRM+ERP tool use.
- Continuous regulatory/compliance agents (e-invoicing, jurisdiction-specific tax
  rules) — durable value but jurisdiction-sprawling; a strong v2, not v1.

---

## 5. Open decisions that still need a human answer

Carried forward from research, not resolved by this plan — flagging rather than
guessing, per this project's own routing rules (`.claude/rules/routing.md` §4):

1. **Autonomy posture** — match the conservative "prepare for approval" baseline
   every incumbent uses (Microsoft's Payables Agent stops there even at their
   scale), or make *earned* higher autonomy the actual product bet? This
   determines whether the system is architected around an approval queue or an
   earned-trust ledger — the research is explicit these are not refactorable into
   each other after the fact.
2. **Pricing model** — seat-based vs. outcome-based per automated transaction.
   Outcome-based pricing is a proven differentiator (Sierra's ~$1.50/resolution
   model) but requires per-workflow cost instrumentation from day one, which
   §4.1.3's audit trail work already builds toward regardless of which pricing
   model is chosen.
3. **Realistic 12-24 month client count** — determines whether the Cloudflare
   ceiling in §2.2 is a real near-term constraint or a distant one, and whether
   budgeting for a Workers-for-Platforms Enterprise quote belongs in this
   roadmap or a later one.
4. **Regulated-domain appetite** — tax/payroll in or out of scope for the first
   release, given the distinct legal-liability profile.

---

## 6. Trigger points to revisit this plan

- **Client count approaching ~80-100** — re-evaluate the Cloudflare Workers
  ceiling (§2.2) before it becomes a blocker, not after.
- **Any client needs genuinely different code**, not just different
  config/manifest selection — per the research, this is the one case where the
  Vercel "Multi-Project" (per-client-repo) model actually becomes the right
  answer for *that specific client*, without changing the model for everyone
  else.
- **First automated workflow (§4.3) completes shadow-mode evaluation** — informs
  whether the graduated-autonomy mechanism (§4.1.2) is working as designed before
  broadening to more workflows.

---

## 7. What happens next

This document is the plan-for-review artifact per the user's confirmed
sequencing. **No implementation begins until this is explicitly approved.** Once
approved, suggested next steps in order:

1. Confirm the four open decisions in §5.
2. Spin up `tools/provision-client.ts` against a single test client (proves the
   provisioning pipeline before any real client depends on it).
3. Extend the tool-contract pattern (§4.2) with ERP tools, targeting MCP spec
   `2026-07-28`.
4. Build the first automated workflow (§4.3) in shadow mode against the test
   client's data.
5. Only then, provision the first real paying client.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
