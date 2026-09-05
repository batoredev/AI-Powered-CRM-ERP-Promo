# Plan: Per-Client Deployment Architecture + AI-Automation Roadmap

**Date:** 2026-09-03 (revised 2026-09-05, corrected again 2026-09-05 same day
— see §0.1)
**Status:** Core deployment model corrected 2026-09-05 (§0.1) — the dev-page
tool is now understood to be a generator/updater, not a config-selector on a
shared deployment. §5's four open decisions remain resolved. §3.5.1 raises 5
new open questions, several of which (especially #1, the per-feature file
manifest) block real implementation of the corrected tool. The two artifacts
already built (`dev-tools/client-config.html`, `tools/provision-client.ts`)
reflect the SUPERSEDED model and are being rewritten to match this correction
— tracked in `EXECUTION_PLAN.md`. Per the user's explicit sequencing
(research → plan → implement), no further implementation proceeds on an
unreconciled understanding — this doc is the reconciled one.
**Author:** Originally Claude session `ai-crm-erp-33`/`ai-crm-erp-74`
(research + initial plan), handed off 2026-09-04 to session `ai-crm-erp-be`
(now sole owner of this plan and its implementation, per the user's explicit
"run everything in this session" instruction) — see `EXECUTION_PLAN.md` for
the up-to-date ownership and sequencing record.
**Research this plan is built on:**
- [`research/2026-09-03-per-client-deployment-model.md`](research/2026-09-03-per-client-deployment-model.md)
- [`research/2026-09-03-ai-native-business-backend.md`](research/2026-09-03-ai-native-business-backend.md)
- Prior CRM feature-gap research (2026-09-01, referenced inline where relevant)

---

## 0. What this plan does and does not change

**SUPERSEDED BY A CORRECTION 2026-09-05 (see §0.1 immediately below).** The
"Confirmed architecture" block that follows was accurate as of 2026-09-03 and
is kept for the historical record, but the user corrected it on 2026-09-05 —
**"features selected per client at build/deploy time, not by forking code"
is no longer the model.** Read §0.1 first; it is the current authority.

**Confirmed architecture as of 2026-09-03 (superseded — see §0.1):**

- ~~One shared codebase (this repo). Not forked per client.~~
- ~~One deployment per client — own database, own server process, full data
  isolation.~~
- ~~Features selected per client at build/deploy time, not by forking code.~~
- **Existing Row-Level Security (`tenant_id`, 14 `CREATE POLICY` statements,
  `withTenant` helper, `rls-policy-audit.test.ts`) is kept, not stripped.** Each
  client's database will only ever contain one tenant row, so RLS is inert but
  free — zero runtime cost, zero re-testing cost, and it stays as a second
  independent safety net against a bug in application-level tenant scoping. This
  was explicitly evaluated against "strip RLS since single-tenant DBs don't need
  it" and rejected — see research doc §"Security/compliance" for the reasoning.
  **This one point survives the 2026-09-05 correction unchanged** — RLS is kept
  in generated client codebases too, for the same reason.

**Not affected by this plan:** the peer session's Phase 3A-3 production-module
work (`bill_of_materials`, `bom_component`, and upcoming work
centers/routing/manufacturing-order tables) is schema-domain work that proceeds
unchanged — it's built on the existing RLS pattern, which this plan keeps. No
rework needed there.

### 0.1 CORRECTION 2026-09-05 — this is the current model, read this first

The 2026-09-03 model above ("one shared deployment, a manifest row gates
features at runtime") was **wrong** — it does not match what the user actually
wants. The corrected model, exactly as the user specified:

**What it is:** a local, offline, feature-catalog-driven project **generator
and updater** — not a runtime config switch on a shared deployment.

**Phase 1 — building a new client's software:**
1. Features are presented as a menu/checkbox list (CRM modules, ERP modules,
   AI automations, channels, etc.) — a **fixed catalog**, not open-ended.
2. The client (or the developer, on their behalf) selects which features that
   client gets.
3. The dev-page tool assembles a **complete, real, standalone codebase — both
   frontend and backend, every file** — by pulling in the already-written
   source for each selected feature from the shared repo.
4. Anything **not** selected is excluded from the output entirely. The
   delivered project contains only what was chosen — no dead code, no unused
   modules sitting inert behind a flag.
5. The underlying implementation of each feature is written **once**, in the
   shared repo. The tool performs **selective assembly** of a subset per
   client from that shared source. It does **not** invent new code per client
   and is **not** templating or LLM-generating new implementations per
   feature combination.

**Phase 2 — updating an existing client's software later:**
6. The same tool is used again whenever a client requests a change, at any
   point after initial delivery.
7. It's pointed at that client's existing generated project (their
   folder/repo).
8. Updates are **menu-driven only** — a feature is toggled on or off from the
   same fixed catalog used at initial build, and the tool adds/removes the
   corresponding files in that client's real, existing codebase to match.
9. This is explicitly **not** open-ended custom code editing through this
   tool — no "change this button's color," no bespoke one-off logic requests.
   Scope is bounded to the fixed feature catalog, both at build time and at
   update time. This is what keeps the tool well-defined: it always knows
   exactly what "feature X" means in code.

**Hosting and data — client-owned, not centrally shared, once past the trial:**
- **Right now, during the trial/dev phase:** one shared Neon/Supabase project
  is fine, for internal testing only.
- **For real clients, going forward:** each client gets their own **separate**
  infrastructure — their own VPS and/or their own Supabase/Neon account. §2.1's
  "each client owns their own Supabase project" decision (2026-09-05, made
  earlier the same day as this correction) is **consistent with and required
  by** this corrected model — it was already heading this direction before the
  user made it explicit here.
- **We do not host or centrally store any client's data long-term in one
  shared project/database.** A design where we ourselves keep every client's
  data in one DB as the delivery model is explicitly rejected for the
  post-trial, real-client phase.

**What this replaces:** the 2026-09-03 model's "one shared deployment reads a
per-client config/manifest flag at runtime" is **incorrect** for the real
client-delivery phase. It is replaced by: each client gets a **separately
generated, separately hosted, standalone codebase**, built and later updated
by the dev-page tool from one shared source of truth.

**Reconciling this against §1's research (the user explicitly asked this be
addressed, not silently contradicted):** §1 found that no credible operator
maintains genuinely *forked* per-client codebases, because a fork means a
security fix must be manually reapplied in N places forever. This correction
is **deliberately closer to per-client generation than that research
recommended** — but it is not the same failure mode §1 warns against, for one
load-bearing reason: **a client's codebase here is never independently
hand-edited or forked from shared source — it is mechanically regenerated
from a fixed, small catalog of shared-repo features, by one tool, every time.**
A security fix lands once in the shared repo; the next time the dev-page tool
runs an update pass for a client (Phase 2, item 6-9 above), that client's
generated output picks up the fix automatically, the same way a template
re-render would. This is closer to "one artifact, compiled many ways" than to
"one artifact, manually forked N times" — but it is a **real, open
architectural tension** the user should be aware of, not a settled non-issue:
- The propagation is only as good as the discipline of re-running the tool
  for every client after every shared-repo change. §1's research found
  *automatic* propagation (a redeploy) was what made the shared-deployment
  model safe; this model's propagation is update-triggered per client, not
  automatic — an unpatched client is possible if nobody re-runs the tool for
  them.
- A client's generated codebase, once delivered, is a real standalone
  artifact on their own infrastructure — nothing stops them (or an operator
  under time pressure) from hand-editing it directly, at which point it
  silently becomes exactly the forked-codebase failure mode §1 warns against.
  This plan does not yet specify any guardrail against that (e.g. a checksum/
  provenance marker the tool could check before an update-pass, to warn if
  the client's codebase has drifted from a clean tool-generated state).

These two points are **flagged as open questions for the user**, not resolved
here — see §3.5.1's "Open questions this correction raises" for the full list.

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

**SUPERSEDED 2026-09-05 by §0.1's correction.** The topology below (one
shared Worker fleet reading a per-client manifest row at runtime) described
the WRONG model. Kept for the historical record only — **§2.1.1 is the
current model.**

**Revised 2026-09-05 — database ownership moved to the client (this part
survives the §0.1 correction unchanged, see below).** The original design
(below, kept for the record) had us provisioning a Neon project per client,
under our own account. That hit a real wall: the working Neon account has a
**Projects Limit: 0** on its current plan, unable to create a second project
at all. Rather than treat that as a plan-doc-only workaround, the user made a
deliberate ownership decision (2026-09-05, via brainstorming): **each client
creates and owns their own Supabase project — their account, their billing,
their credentials.** They hand us a connection string / a service-role key;
we never touch their Supabase billing relationship.

```
SUPERSEDED — this described one shared Worker fleet reading a per-client
manifest row at runtime. See §2.1.1 for the current model (a separately
generated, separately hosted, standalone codebase per client).

                     +-------------------------------+
                     |   Golden codebase (this repo)  |
                     |   -- single source of truth    |
                     +----------------+----------------+
                                      |
                     provision-client.ts (idempotent;
                     takes a client-supplied DB connection
                     string as input, does not create the DB)
                                      |
        +-----------------+----------+----------+-----------------+
        v                 v                     v                 v
  +-----------+     +-----------+         +-----------+     +-----------+
  | Client A  |     | Client B  |   ...   | Client N  |     |  (new)    |
  | Worker    |     | Worker    |         | Worker    |     | provision |
  | Client's  |     | Client's  |         | Client's  |     | on demand |
  | own       |     | own       |         | own       |     |           |
  | Supabase  |     | Supabase  |         | Supabase  |     |           |
  | manifest  |     | manifest  |         | manifest  |     |           |
  | own domain|     | own domain|         | own domain|     |           |
  +-----------+     +-----------+         +-----------+     +-----------+
```

- **Compute:** Cloudflare Workers (current platform, via OpenNext), one Worker
  per client. Unaffected by the database-ownership change — still our infra.
  **Forward-looking note (not designed yet, flagged by the user 2026-09-05):**
  compute may move from Cloudflare Workers to a self-hosted VPS at some future
  point. This is a separate, later decision — noted here so it isn't lost, not
  scoped or designed as part of this revision.
- **Database:** each client's own Supabase project (Postgres-compatible —
  same engine Neon uses, so the existing schema/RLS/`withTenant()` pattern
  carries over unchanged; see 2.1.1). **Onboarding now has a new manual step:**
  a client must create their Supabase account and hand us a connection string
  before `provision-client.ts` can run against it — this replaces the fully
  automated "we create the database ourselves" step the original Neon design
  had. `provision-client.ts` still runs the migrations and RLS setup remotely
  once it has that connection string (§3.1).
- **Domain:** one custom domain or subdomain per client, DNS + SSL automated
  through the provisioning script.
- **Schema:** every client runs the *same* migration set (all tables always
  exist). A disabled feature means unused tables, not absent ones — this is what
  keeps the codebase genuinely shared and updatable, and avoids the worst failure
  mode found in research (per-client schema drift).

### 2.1.1 Current model (2026-09-05 correction) — generated, standalone, client-hosted

Per §0.1: each client's deliverable is a **separately generated, separately
hosted, standalone codebase** — not a shared deployment gated by a runtime
manifest flag. The revised topology:

```
                     +-------------------------------+
                     |   Golden codebase (this repo)  |
                     |   -- single source of truth,   |
                     |   organized as a feature catalog|
                     +----------------+----------------+
                                      |
                     dev-page tool (§3.5, offline, local):
                     developer/client picks features from
                     the fixed catalog -> tool ASSEMBLES a
                     complete standalone codebase, excluding
                     every unselected feature's files entirely
                                      |
        +-----------------+----------+----------+-----------------+
        v                 v                     v                 v
  +-----------+     +-----------+         +-----------+     +-----------+
  | Client A  |     | Client B  |   ...   | Client N  |     |  (new)    |
  | generated |     | generated |         | generated |     | generate  |
  | codebase  |     | codebase  |         | codebase  |     | on demand |
  | own infra |     | own infra |         | own infra |     |           |
  | (VPS/     |     | (VPS/     |         | (VPS/     |     |           |
  |  Supabase)|     |  Supabase)|         |  Supabase)|     |           |
  +-----------+     +-----------+         +-----------+     +-----------+
```

- **Compute:** each client's own infrastructure — a VPS and/or their own
  Cloudflare/hosting account, not a Worker on our shared account. Exact
  hosting mechanics per client are an implementation detail to work out; the
  binding constraint is that it's the client's own infra, not ours, once past
  the trial phase (see §0.1).
- **Database:** each client's own Supabase (or Neon) project — unchanged from
  the 2026-09-05 database-ownership decision above; that decision already
  anticipated this direction.
- **Trial/dev phase exception:** one shared Neon/Supabase project is fine for
  our own internal testing right now — this is explicitly not the model for
  real clients (§0.1).
- **Schema:** a generated client's codebase only contains the migrations for
  the features it was assembled with — NOT every migration unconditionally,
  unlike the superseded model above. This is a real open question the tool's
  design must answer (see §3.5.1) — most tables so far don't have per-feature
  migration boundaries drawn yet.
- **No runtime feature manifest.** §2.3's manifest concept (a DB row gating
  features at runtime) is **not part of this model** — feature selection
  happens once, at generation/update time, not on every request. §2.3 below
  is retained only for its "which modules exist" catalog content, not its
  runtime-enforcement mechanism.

#### 2.1.1 What does and doesn't change with this switch

- **Unaffected:** all existing schema, `FORCE ROW LEVEL SECURITY` +
  `tenant_isolation` policies, `current_tenant_id()`, and the `withTenant()`
  `SET LOCAL`-per-transaction pattern — Supabase is standard Postgres, so none
  of this needed redesigning, only confirming (per the user's explicit
  decision to keep the RLS approach as-is rather than adopt Supabase's own
  `auth.uid()`-based conventions).
- **Unaffected:** the existing Neon project (`AI CRM-ERP-Promo`) stays exactly
  as it is — the developer's own dev/test database (`DATABASE_URL` in
  `.env`). This switch only changes what *client* databases run on, not the
  dev workflow.
- **Unaffected:** the offline dev-page tool (§3.5), the feature-manifest shape
  (§2.3), and the AI-automation roadmap (§4) — none of these are
  database-provider-specific.
- **Changed:** §3.1's `provision-client.ts` no longer creates the database
  itself — it takes a connection string as input (see revised §3.1).
- **Changed:** onboarding a new client now requires them to complete a
  Supabase signup step before provisioning can start — this plan does not yet
  specify the exact hand-off mechanism (a form, an email, a dashboard) and
  that detail is deferred to implementation, not designed here.

**Original design, for the record (superseded by the above):** we would
provision a Neon Postgres project per client under our own account,
leveraging Neon's scale-to-zero pricing to keep idle-client cost near zero
(contrast an always-on-VM provider, which would cost roughly $1,000/mo for
100 small tenants per the research). This is no longer the plan for
client databases; Neon remains only as the dev/test database.

### 2.2 The known ceiling on this platform, planned around now

Cloudflare's standard account allows **500 Workers**; the mechanism for going
beyond that (Workers for Platforms) is **Enterprise-only with custom pricing**.
Custom domains are capped at **100 per zone**. This plan assumes the client count
stays within these limits through the roadmap below; §6 names re-evaluating the
platform (or negotiating an Enterprise plan) as an explicit trigger once the
client count approaches ~80-100, well before either limit is hit.

### 2.3 Feature catalog (was "per-client feature manifest" — re-scoped 2026-09-05)

**Re-scoped by the §0.1 correction.** The content below (which
modules/features exist) is still accurate and still useful — it's the
catalog the dev-page tool's menu (§3.5) presents. What's **no longer true**:
this is not a runtime-enforced manifest gating a shared deployment. There is
no shared deployment to gate. Feature selection happens once, when the
dev-page tool assembles or updates a client's codebase — a client's generated
output simply does not contain the files for features they didn't select, so
there's nothing to gate at runtime.

The catalog shape (conceptual — see §3.5.1 for the real open question of how
this maps to actual file lists):

```jsonc
// conceptual catalog shape -- NOT a runtime-read config row anymore.
// This is the menu the dev-page tool presents and the selection it records
// for a given client, at generation/update time only.
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

**The three-layer enforcement idea below is SUPERSEDED — there is no runtime
enforcement in the corrected model, because there is no shared runtime to
enforce against:**

~~1. Route/UI layer — a disabled module's routes 404 and its nav items don't
   render.~~ **Superseded:** in the corrected model, a disabled module's
   routes/nav files are simply never present in the generated codebase — not
   present-but-blocked, actually absent. Stronger guarantee, not a weaker one.
~~2. API/data-access layer — server actions and API handlers check the
   manifest before executing.~~ **Superseded:** same reasoning — the
   server actions and API handlers for a disabled module aren't in the
   generated codebase to be hit.
~~3. AI tool-contract layer — the agent's available tools are filtered per
   client.~~ **Not fully superseded — still needed, in a different form.**
   The AI tool-contract (`lib/crm/tool-contract.ts`-equivalent) is *code*, so
   for a given client it will only ever be built with the tool definitions
   for features that client has — same "absent, not hidden" guarantee as
   routes/API above. But this only holds if the tool-contract file itself is
   correctly excluded/included per the feature catalog when the codebase is
   assembled — this is a real design requirement for the dev-page tool's file
   manifest (§3.5.1), not automatic.

Changing a client's feature set later means re-running the dev-page tool in
update mode (§0.1 Phase 2) against that client's existing codebase — it adds
or removes the relevant files and the client redeploys, rather than a
manifest-row update + redeploy of a shared Worker.

---

## 3. Provisioning and update-propagation tooling

Per this project's own WAT rules (`.claude/rules/wat.md` §1, §7): this is
mechanical, repeatable work and belongs in `tools/`, not reasoned through by hand
per client.

### 3.1 `tools/provision-client.ts` — SCOPE NARROWED 2026-09-05 by §0.1's correction

**What this tool still does, unchanged:** given a client's connection string
(client-owned Supabase, per the 2026-09-05 database-ownership decision —
independent of and compatible with the §0.1 correction) and the client's
feature selection, run the migrations that selection needs and set up RLS.
This part of the tool is real, already built (see §3.1.1 note below), and
still correct.

**What changes:** this script is no longer the FULL provisioning pipeline —
it's one step the dev-page tool's generation/update flow (§3.5) calls or
wraps. The steps below that assumed a shared-Worker deployment model are
superseded; kept struck through for the historical record, with the current
answer noted:

1. Does not create a database — unchanged, still correct.
2. Run the (feature-scoped, not full-15+) migration set against it, RLS
   included — **narrowed**: per §2.1.1, a generated client's codebase (and
   therefore its database) should only need the migrations for the features
   it was assembled with, not every migration unconditionally. This tool's
   current implementation still runs the *full* migration set regardless of
   feature selection — that's a real gap the §3.5.1 open questions call out;
   not yet fixed.
3. Insert the client's feature-manifest row — **superseded as "runtime
   manifest," kept as record-keeping**: per §2.3's re-scoping, there's no
   runtime enforcement reading this row anymore, but recording which features
   a client's generated codebase was assembled with is still useful metadata
   (e.g. for the update flow in §3.5 Phase 2 to know the client's current
   state) — not dropped, just re-purposed.
4. ~~Create a Cloudflare Worker for the client~~ — **superseded.** Per
   §2.1.1, each client hosts on their own infra (VPS and/or their own
   Cloudflare/hosting account), not a Worker on our shared account. This step
   does not apply in the corrected model.
5. ~~Attach the client's domain, verify SSL issuance~~ — **superseded** for
   the same reason; this becomes the client's own responsibility (or a
   separate, later-designed piece of tooling if we choose to help with it),
   not a step this shared-account script performs.
6. Write the client's connection secrets to the deploy environment (never
   into source control) — unchanged, still applies regardless of hosting
   model.
7. ~~Record the client in a central fleet registry~~ — **open question,
   not superseded outright.** A fleet registry across client-owned,
   separately-hosted infrastructure is a different (and less automatic) thing
   than one across our own Worker fleet — see §3.5.1's open questions.

#### 3.1.1 Current implementation status

`tools/provision-client.ts` exists (built 2026-09-04, before this correction)
and correctly implements items 1, 2 (unscoped — runs all migrations, not
feature-scoped), part of 3 (writes the manifest row, framed as a runtime
gate rather than assembly metadata), and 6. It needs updating once the
dev-page tool's file-manifest design (§3.5.1) exists, to: (a) run only the
migrations the client's selected features need, and (b) be callable by the
dev-page tool's generation flow rather than standing alone as "the whole
provisioning pipeline." Not yet done — tracked as follow-up work, not
redone in this revision.

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

### 3.5 The dev-page tool — CORRECTED 2026-09-05: a generator and updater, not a config-selector

**This entire section describes the WRONG tool as of the previous revision.**
The tool built 2026-09-04 (`dev-tools/client-config.html`) generates a
manifest config file — that matched the superseded §2.1/§2.3 model, not the
corrected §0.1 model. This section is rewritten to describe the tool §0.1
actually specifies. The already-built file needs rewriting to match (tracked
as follow-up implementation work, not done as part of this doc-only pass —
see `EXECUTION_PLAN.md`).

**Non-negotiable constraint, unchanged from the prior revision (per the
user's explicit instruction, 2026-09-04):** this tool is visible only to the
developer, on their own machine, and is never part of any production build a
client can reach. Nothing about its existence, its code, or its UI ships
anywhere. It is not a hosted page gated by auth — it does not run on any
server at all.

**What it actually is, per §0.1:** a local, offline, feature-catalog-driven
project **generator and updater**. Not a config-selector for a shared
deployment — there is no shared deployment. It produces (Phase 1) or updates
(Phase 2) a **complete, standalone, per-client codebase**.

**Mechanism — File System Access API, unchanged, following the user's own
working reference implementation** (`dev.html`, a sibling project;
independently verified against the live file 2026-09-05):

- `window.showDirectoryPicker({ mode: 'readwrite', id: '<project-id>' })`
  grants the page direct read/write access to a folder on the developer's
  local disk. No server involvement, no upload.
- Full-overwrite file writes: `dirHandle.getFileHandle(name, { create: true })`
  → `fileHandle.createWritable()` → `writable.write(content)` →
  `writable.close()`. Nested paths walk `getDirectoryHandle(part,
  { create: true })` per path segment before the final `getFileHandle` call.
- **New requirement this corrected model adds, not present in the prior
  design:** the tool must be able to **copy whole files** (not just write
  generated text) from this repo's source tree into the target folder — e.g.
  reading `lib/erp/bom.ts`'s contents and writing an identical copy into the
  client's output folder — and, for Phase 2 updates, **delete** files in the
  target folder that correspond to a feature just turned off. The File System
  Access API supports both (`FileSystemDirectoryHandle.removeEntry()` for
  deletion; read via `getFile()` + write via the existing `writeTextFile`
  pattern for copying) — this is a real, buildable capability, not a gap in
  the API, but it is new surface area the prior tool didn't need.
- Still a **single self-contained HTML file** — no build step, no server, no
  framework. Chrome/Edge only, acceptable for a developer-only tool.

**What it does, Phase 1 (new client):**
1. Presents the fixed feature catalog (§2.3's shape) as a menu.
2. Developer/client selects features.
3. Tool walks the shared repo's source tree, and for each selected feature,
   copies that feature's files (frontend + backend + its migrations) into a
   fresh output folder. Files belonging only to unselected features are never
   copied.
4. Writes a manifest recording which features this client's codebase was
   assembled with (§2.3, re-purposed as assembly metadata, not a runtime
   gate) into the output folder, alongside the copied code.
5. `provision-client.ts` (§3.1) is then run against that output — but scoped
   to only the migrations the selected features need, once §3.1.1's gap is
   fixed (not yet done).

**What it does, Phase 2 (update an existing client):**
6. Developer points the tool at the client's *existing* output folder
   (`showDirectoryPicker` on that folder, not a fresh one).
7. Tool reads that folder's recorded manifest (from step 4, above) to know
   the client's current feature selection.
8. Presents the same fixed catalog, pre-checked to match the current
   selection.
9. On a toggle, the tool copies in the newly-selected feature's files, or
   removes the newly-deselected feature's files, and rewrites the manifest to
   match. Bounded to catalog features only — no open-ended file editing.

**Where this fits relative to `provision-client.ts` (§3.1):** unchanged in
spirit — the dev-page tool is the human-facing, file-assembling step;
`provision-client.ts` is the scripted step that sets up the resulting
codebase's database. The dev-page tool's output (a real codebase) is what
`provision-client.ts` is then run against.

**One naming note, corrected from an earlier informal comparison:** `dev.html`
also has an `FF_GROUPS`-driven feature-flag panel (`ffLoad`/`ffSave`/
`ffRender`/`ffToggle`/`ffResetAll`, `localStorage`-backed), but that panel
toggles *that app's own UI sections* for its own single deployment — it is
not a per-client selector. It is structurally similar to what this tool needs
(a grouped list of `{key, label, sub}` toggles) and worth reusing as a UI
pattern, but it solves a different problem than the per-client generation
described above; the two should not be conflated when building this tool.

### 3.5.1 Open questions this correction raises — flagged for the user, not resolved here

Per the user's explicit request to surface these rather than silently
assume an answer:

1. **How does the tool know which files belong to which feature?** Today,
   the codebase has no per-feature file manifest — `lib/erp/bom.ts`,
   `lib/erp/work-centers.ts`, etc. map roughly one-to-one to ERP
   sub-features by convention, but nothing declares this in a machine-
   readable way, and some files (e.g. `lib/db/with-tenant.ts`,
   `lib/auth/dev-tenant.ts`) are shared infrastructure every client's
   codebase needs regardless of feature selection. This mapping needs to be
   built and maintained — likely a small JSON/TS manifest listing, per
   catalog feature, the files/migrations it needs, plus a separate
   "always included" core-infrastructure list. Not designed yet.
2. **How does the tool detect a client's "current state" before an
   update?** §3.5 Phase 2 assumes the tool's own previously-written manifest
   file in the client's output folder is trustworthy. What if a client (or
   an operator) hand-edited that folder directly since the last generation?
   The tool has no way to detect drift from a clean generated state right
   now — this is the same gap named in §0.1's reconciliation with §1's
   research. A future revision could add a checksum or provenance marker per
   generated file, checked before an update pass, but this is not designed
   or built.
3. **Do per-feature file manifests need to be maintained alongside each
   feature's code, or can they be inferred?** Related to (1) — if a new ERP
   sub-feature is added later, does its own migration/file list get declared
   explicitly at that time (extra discipline required per new feature), or
   can the tool infer file-to-feature mapping some other way (e.g. directory
   convention)? Explicit declaration is safer but adds a step to every future
   feature's own implementation plan; inference is more fragile. Not decided.
4. **What happens to `provision-client.ts`'s "runs all 22 migrations
   unconditionally" behavior?** Per §3.1's narrowed scope, it should run only
   the migrations a client's selected features need — but migrations have
   real ordering dependencies (e.g. `0006_tenant_erp_settings.sql` before
   anything reading `tenant_erp_settings`) that don't necessarily align with
   feature boundaries one-to-one. This needs its own design pass once (1)'s
   file-manifest exists to reason about.
5. **Is there a target hosting story for the client-owned VPS path**
   (§0.1's "each client gets their own VPS and/or their own Supabase/Neon
   account")? The Supabase side is designed (§2.1's connection-string model);
   the VPS/compute side is explicitly a "forward-looking, not designed yet"
   note in §2.1. If a real client needs delivery before that's designed, this
   is the actual blocker, not the dev-page tool itself.

**Status:** design-only as of this revision. Not yet implemented — build
begins once this document is signed off (§5, §7).

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

## 5. Open decisions — resolved by the user (2026-09-05)

All four were previously flagged as needing a human answer. The user answered
directly via AskUserQuestion; recorded here verbatim in effect, with the
reasoning each answer implies for downstream design:

1. **Autonomy posture — graduated autonomy.** Not the conservative
   "prepare for approval only" baseline every incumbent stops at, and not full
   autonomy either: every workflow **starts** draft-only (human approves each
   action) and **earns** auto-execute rights over time, per workflow, based on
   a measured track record. This directly confirms §4.1.2's "graduated, earned
   autonomy" thesis as the actual product bet, not just a research finding —
   architect around an earned-trust ledger per workflow, not a flat global
   approval-queue setting.
2. **Pricing model — hybrid: both flat monthly per client AND
   usage/seat-based.** Not one exclusively. A base flat fee per client plus a
   usage- or seat-based component that scales with client size/activity. The
   exact mix (e.g. flat base + metered overage per automated action) is not
   yet specified — this still needs working out during implementation, but the
   direction (hybrid, not pure-seat or pure-outcome) is settled. This still
   benefits from §4.1.3's per-workflow cost instrumentation regardless of the
   exact split, since usage-based billing needs the same cost data outcome
   -based billing would have.
3. **Client-count scale — small, up to ~20 clients.** The §2.2 Cloudflare
   ceiling (500 Workers, 100 custom domains/zone) is **not** a near-term
   constraint at this scale — no need to design around Workers-for-Platforms
   or an Enterprise quote yet. Revisit only if actual growth outpaces this
   estimate (§6's "client count approaching ~80-100" trigger point stays as
   the re-evaluation signal, now known to be well above the currently
   -planned scale).
4. **Regulated-domain appetite — yes, eventually, not now.** Do not build
   compliance controls (HIPAA/SOC2/PCI-type work) for the first release —
   §4.3's existing deferral of "regulated-domain automation (tax, payroll)"
   stands. But do not architect in a way that forecloses adding them later:
   avoid decisions that would require a rewrite (rather than an addition) to
   support a regulated client in the future.

---

## 6. Trigger points to revisit this plan

- ~~**Client count approaching ~80-100** — re-evaluate the Cloudflare Workers
  ceiling (§2.2).~~ **Superseded by §0.1/§2.1.1** — there is no shared Worker
  fleet in the corrected model, so this ceiling doesn't apply the way §2.2
  originally framed it. §2.2 is retained for the historical record only.
- ~~**Any client needs genuinely different code**, not just different
  config/manifest selection~~ — **superseded**: the corrected model (§0.1) is
  already per-client-generated code by design, not a shared deployment with a
  config escape hatch. This trigger point no longer makes sense in the
  corrected model — genuinely custom code for one client is still explicitly
  out of scope (§0.1 item 9), but the "when does it become worth a real fork"
  question this bullet was gesturing at needs re-thinking from scratch, not
  answered by this revision.
- **First automated workflow (§4.3) completes shadow-mode evaluation** — informs
  whether the graduated-autonomy mechanism (§4.1.2) is working as designed before
  broadening to more workflows. **Unaffected by the §0.1 correction.**
- **New trigger, added 2026-09-05:** any of §3.5.1's 5 open questions being
  answered by the user should trigger revisiting the relevant part of §3/§3.5
  — several of them are load-bearing for actually building the tool.

---

## 7. What happens next

**Revised 2026-09-05 per §0.1's correction.** §5's four open decisions are
resolved. §3.5 (the dev-page tool) has been rewritten to describe the
correct generator/updater model, but the file already built
(`dev-tools/client-config.html`, and `tools/provision-client.ts`'s current
scope) still reflects the superseded config-selector model and needs
rewriting to match — tracked in `EXECUTION_PLAN.md` as active follow-up work,
not done as part of this doc-only revision. §3.5.1's 5 open questions are
genuinely open and several block real implementation (especially #1, the
per-feature file manifest). Next steps in order:

1. Resolve enough of §3.5.1's open questions (especially #1: how files map
   to catalog features) to make the file-assembly logic buildable.
2. Rewrite `dev-tools/client-config.html` to perform Phase 1/Phase 2
   generation and update (§3.5), not manifest-file writing.
3. Rewrite `tools/provision-client.ts` to (a) accept a generated codebase's
   feature selection and run only the migrations it needs, and (b) be
   callable as a step within the dev-page tool's flow rather than a
   standalone full pipeline.
4. Generate a single test client's codebase end-to-end (Phase 1) to prove the
   assembly logic before any real client depends on it.
5. Extend the tool-contract pattern (§4.2) with ERP tools, targeting MCP spec
   `2026-07-28`.
6. Build the first automated workflow (§4.3) in shadow mode against the test
   client's data.
7. Only then, provision the first real paying client — onto their own
   infrastructure, per §0.1/§2.1.1, not our shared account.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
