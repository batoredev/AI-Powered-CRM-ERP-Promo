# Execution Team Structure — AI CRM+ERP Platform

Status: Structure only — no implementation started under this document
Date: 2026-08-29 (revised — task-level coverage audit)
Companion to: `2026-08-29-ai-crm-erp-platform-design.md` (the architecture
spec this team executes, now through 5 review rounds)

This revision fixes a real gap in the first pass: that version assigned
roles to phases at the phase level ("backend-lead does CRM logic")
without first enumerating the actual tasks inside each phase and
checking each one has an owner. This version does that — every
concrete requirement in the design spec is extracted into a task, and
every task is assigned. Section 6 is the actual coverage audit; sections
1-5 build up to it.

It still maps onto the already-installed 31-agent roster
(`.claude/agents/`) and `docs/ROUTER.md`'s routing rules — not a new
team system. The router's own principles (cap active teams at 3-5,
smallest team that can safely do the job, a named owner per file/skill,
read-only reviewers running parallel to implementers) hold throughout.

## 1. Standing roles (active for the life of the project)

| Role | Responsibility |
|---|---|
| `cto-delivery-lead` (01) | Overall delivery ownership; selects the smallest per-task team from `docs/ROUTER.md`; only role with cross-phase visibility |
| `solutions-architect` (04) | Owns the design spec itself; any architecture change (not implementation) routes through here |
| `security-cso` (13) | Continuous review across every phase touching auth, tenancy, the agent runtime, or plugins — not a phase-end gate |
| `database-data-engineer` (09) | **Sole owner of all migrations**, no exceptions (router's own rule) |
| `release-manager` (19) | Solo, never a team, per router — only role that syncs main and ships |
| `observability-learning-engineer` (20) | Owns `/retro`/`/learn`; appends to this doc's "Learned constraints" after each phase |

## 2. Task extraction method

For each design-spec section, every sentence containing a concrete
requirement ("must," "required," "every X does Y," a named mechanism)
was pulled out as a task. Sections that are pure rationale/research
(§1's competitive differentiation, §1a, §7a's pricing narrative) are
not task sources — they inform *why*, not *what to build*, and are
covered by referencing them from the tasks they justify.

## 3. Task inventory by design-spec section

**§2 Tech Stack** — infra setup, one task per row: Next.js/Cloudflare
Pages+Workers setup; Postgres provisioning (Neon/Supabase + Hyperdrive);
Cloudflare Queues setup; Durable Objects setup; R2 setup; Claude API
integration; WASM runtime selection+setup; KMS setup.

**§3 Multi-Tenancy** — tenant/user/role schema; non-privileged Postgres
app role (the RLS-bypass fix) used by every runtime path; `SET LOCAL`
tenant-context-per-transaction mechanism; connection-pool configuration
avoiding session bleed; enumeration of every privileged path (migrations,
admin tooling) with mandatory app-level filtering review; CI cross-tenant
isolation test suite; JWT issuance with tenant/role/claim shape;
per-tenant credential vault (KMS-backed).

**§4 + §4.1 Omnichannel Inbox** — unified `conversation`/`message` schema;
WhatsApp Cloud API integration + Embedded Signup OAuth; BSP-style
auth-broker service (webhook verification, token refresh, replay
protection, constant-time signature comparison); Instagram/Messenger
Graph API integration; email OAuth (Gmail/Outlook) + IMAP/SMTP fallback;
live-chat widget (JS snippet + Durable Objects real-time delivery);
`ChannelPlugin` interface definition (send/receive/normalize);
`getSendEligibility` capability; `deliveryMode` declaration;
idempotency-key handling in `send()`; message-ID dedup in `receive()`;
shared error taxonomy; `PresenceCapability` for live chat.

**§5 + §5a AI Agent Runtime** — cross-domain tool registration
(CRM+ERP); persistent memory store with RLS-enforced `tenant_id` on
every vector query; self-healing retry/escalate loop; proactive-trigger
background jobs; domain-agnostic tool-registration contract;
data-not-instructions prompt boundary (live messages); same boundary
applied to memory promotion (pre-promotion classification); same
boundary applied to tool-call outputs; confirmation-UI provenance
(raw source shown, not paraphrase); confirmation-fatigue mitigation
(anomaly-flagged prompts, harder-to-click affordance for high-value
actions); per-action autonomy-level config with stated defaults;
rate/value ceiling enforcement at tool-execution layer, independent of
agent; owner-only non-overridable floor + cooldown on autonomy changes;
claim/lock mechanism (conversation-level); lock auto-release timeout;
AI-unavailable degraded-mode UI state + core CRM/ERP functioning without
AI; window-tracking as a deterministic job independent of Claude uptime.

**§6 + §6.0 + §6.1 Plugin Architecture** — host-core vs. plugin table
boundary documentation/enforcement; per-plugin dedicated Postgres schema;
typed host API (cross-schema access path); versioned IDL for the
event-bus/API contract (JSON Schema per event type); `requiresHostContract`
compatibility-range checking at activation; capability-token-style
per-call authorization in the typed API; tenant-context propagation
through the typed-API call (same transaction, asserted not re-derived);
plugin permission re-review/re-consent on version bump; tenant-facing
consent screen (pre-activation) + revocation UI, owner-only; WASM
sandbox (endpoint allowlisting, fuel metering, watchdog force-kill,
per-tenant-per-invocation isolation); egress destination/volume anomaly
monitoring; code-signing + review gate before any plugin activation
(including in-house); plugin manifest schema (permissions, version,
compatibility ranges); per-tenant-per-plugin migration mechanism
(up/down migrations, version ledger, canary rollout, mixed-version
tolerance).

**§7 Security & Compliance** — MFA; SSO support; audit-log append-only
enforcement (no UPDATE/DELETE grants); GDPR tombstone/anonymize
mechanism for deletion requests against the audit log; rate limiting +
bot/abuse detection on every public endpoint (webhooks, OAuth callbacks,
chat widget, auth); data export tooling; data deletion tooling; backup
automation with RPO ≤5min/RTO ≤1hr targets; DO-vs-Postgres reconciliation
rule (Postgres wins, except locks); support-tooling credential-access
proxy (no raw decryption in human paths); log-boundary secret redaction;
credential-access audit logging.

**§7a Pricing** — usage/action metering plumbing (`usage_meter` table +
aggregation), referencing `agent_action_log`.

**§7b Onboarding** — OAuth-based channel connection flow; auto-import of
existing contacts; minimal-by-default plugin activation UI; time-to-
first-value instrumentation.

**§8 Data Model** — full column-level schema for all host-core tables;
integer-minor-units + currency-code columns on `order`/`invoice`/
`product`; append-only history/versioning on `deal`/`order`/`invoice`;
`tenant_id`-led composite indexing convention applied to every RLS table;
the `agent_action_log`/`usage_meter` split as actual tables.

## 4. Roles this task inventory requires that phase-level mapping alone
would have under-used

Cross-checking §3 against the actual 31-agent roster surfaced roles the
first pass listed only as cross-cutting or didn't weight correctly:

- `e2e-automation-engineer` (27) — the CI cross-tenant isolation test
  suite (§3) and the plugin-manifest compatibility checks (§6.1) are
  concrete, code-defined regression tests, not exploratory QA. This is
  this role's exact mandate per the router ("deterministic, code-defined,
  isolated per run"), not `qa-browser-lead`'s.
- `performance-engineer` (14) — the agent's per-turn cross-domain joins
  (flagged as a real concern by the database reviewer) and RLS overhead
  at scale need a named owner in phase 5, not just a "pulled in when
  slow" cross-cutting mention.
- `design-director` (06), `taste-director` (24), `motion-engineer` (23),
  `web-standards-engineer` (25) — the first draft of this table listed
  only `frontend-lead` for every UI task, which under-covers the
  visual-quality bar this project is explicitly trying to hit (see §4a).
  These four are now on the CRM/inbox UI phases explicitly, not implied.

### 4a. On "why doesn't this look like the polished sites I see
advertised" — a scope note, not just a role add

Adding these roles is the right fix for a real gap, but it's worth being
precise about what closes the gap and what doesn't, since piling on
roles without understanding *why* the first table looked thin invites
the same problem resurfacing elsewhere:

- **The gap was real and structural, not a missing checkbox.** The
  router itself separates "ordinary UI work" (`frontend-lead`) from
  "looks generic / needs personality" (`taste-director` +
  `design-director`) and from motion specifically (`motion-engineer`) —
  three distinct disciplines the original table collapsed into one role.
  A generalist building a functional CRM screen and a specialist making
  it feel like a polished consumer product are different skills; the fix
  above (adding the specialists to the CRM/inbox phases) is the correct
  structural answer.
- **What a flashy marketing site and this product actually need differ,
  and that's worth being explicit about rather than assumed.** The
  FB/YT-advertised sites doing heavy 3D/motion work are very often
  marketing/landing pages — a genre where motion and spectacle *are* the
  product's job for those few seconds. A CRM/ERP is a daily-use work
  tool a person sits in for hours; the research already folded into the
  design spec (§1a) found the opposite failure mode dominates there —
  "AI-native in 2026 means invisible AI... the best-reviewed products
  hide the chrome and just deliver the outcome," and complexity/clutter
  is the #1 reason people abandon tools like this, not lack of
  spectacle. So: **this project's own marketing/landing page** (not
  built yet, not currently in the 8-phase roadmap) is exactly where
  `motion-engineer`+`design-director`+`taste-director` should be given
  real room to make something visually striking — the product's working
  screens should be polished, fast, and confident, not restrained
  because of a rule against flashiness, but not optimized for the same
  spectacle-per-second a landing page is either. If a landing/marketing
  site is wanted, it belongs as its own task added to this structure
  (see open item below) — worth confirming with the user rather than
  assumed silently either way.
- **This structure can't guarantee taste** — assigning `taste-director`
  fixes an ownership gap (nobody was accountable for aesthetic direction
  before); it doesn't guarantee the output matches a specific reference
  site's feel unless that reference is given to the role as an explicit
  input during the phase, the way `06-design-director.md` and
  `24-taste-director.md`'s own skill bindings expect.

**Open item, not yet decided:** should a dedicated marketing/landing
page be added to the 8-phase roadmap (it isn't currently one of the 8
phases in the design spec), and if so, is it built by this team at all
or is that explicitly out of scope for now? This is a real scope
question for the user, not something to assume either way.

## 5. Phase-by-phase team assignment with explicit task ownership

### Phase 1 — Foundation

| Task (from §3 above) | Owner |
|---|---|
| Infra setup (§2's 8 items) | `devops-sre` (18) |
| Tenant/user/role schema, non-privileged app role, `SET LOCAL` mechanism, connection-pool config, RLS policies | `database-data-engineer` (09) — sole migration owner |
| Enumerating every privileged path + app-level filtering review | `database-data-engineer` (09) + `security-cso` (13) jointly |
| CI cross-tenant isolation test suite | `e2e-automation-engineer` (27), spec written with `database-data-engineer` |
| JWT issuance, claim shape | `backend-lead` (08) |
| Per-tenant credential vault | `backend-lead` (08) + `security-cso` (13) review |
| Plugin runtime skeleton, WASM sandbox bridge | `backend-lead` (08) |
| Host-core vs. plugin boundary documentation carried into code structure | `solutions-architect` (04) |
| Rate limiting + abuse detection on all public endpoints | `backend-lead` (08) implements, `security-cso` (13) sets the actual thresholds/detection rules — not review-after-build, since the rules themselves are security decisions |
| Backup automation, RPO/RTO targets | `devops-sre` (18) |
| **Phase gate** | `security-cso` (13) reviews RLS mechanism + tenant-context propagation design before phase 2 builds on it |

### Phase 2 — Core CRM

| Task | Owner |
|---|---|
| `deal`/`pipeline_stage` schema, extending `contact` | `database-data-engineer` (09) |
| CRM service/business logic | `backend-lead` (08) |
| Pipeline + contact UI | `frontend-lead` (07) |
| Visual/interaction direction for the pipeline UI (this is the product's most-used screen) | `design-director` (06) + `taste-director` (24) — router: "looks generic/needs personality" is variance calibration, not implementation; the first draft of this table only listed the implementer, which is exactly the gap behind "why doesn't it look like the impressive sites" |
| CRM tool contract (consumed by phase 5's agent) | `api-contract-engineer` (29) |
| Composite indexing convention applied | `database-data-engineer` (09) |
| a11y pass | `accessibility-engineer` (26) |
| Regression tests | `e2e-automation-engineer` (27) |

### Phase 3 — Core ERP

| Task | Owner |
|---|---|
| `product`/`inventory_item`/`order`/`invoice` schema | `database-data-engineer` (09) |
| Integer-minor-units + currency-code columns | `database-data-engineer` (09) |
| Append-only history/versioning | `database-data-engineer` (09) |
| ERP service/business logic | `backend-lead` (08) |
| Inventory/order/invoice UI | `frontend-lead` (07), design direction from `design-director` (06) — same rationale as phase 2's pipeline UI |
| Security review (money-handling code) | `security-cso` (13) |
| a11y pass | `accessibility-engineer` (26) |
| Regression tests | `e2e-automation-engineer` (27) |

### Phase 4 — Omnichannel Inbox

| Task | Owner |
|---|---|
| `ChannelPlugin` interface (all extensions: eligibility, delivery mode, idempotency, error taxonomy, presence) | `api-contract-engineer` (29) |
| Unified `conversation`/`message` schema | `database-data-engineer` (09) |
| WhatsApp Cloud API + Embedded Signup | `integration-engineer` (11) |
| BSP auth-broker (verification, token refresh) | `integration-engineer` (11) |
| Replay protection + constant-time signature comparison specifically | **Joint owners: `integration-engineer` (11) + `security-cso` (13)** — this exact detail (timestamp/nonce checking, `==` vs constant-time compare) is what round-4 review flagged as "centralized doesn't imply correct"; it's a security-sensitive implementation choice, not a post-hoc review item |
| Instagram/Messenger Graph API | `integration-engineer` (11) |
| Email OAuth + IMAP/SMTP | `integration-engineer` (11) |
| Live-chat widget + Durable Objects wiring | `backend-lead` (08) + `frontend-lead` (07) |
| Unified inbox UI | `frontend-lead` (07) |
| Real-time update motion/feel (new-message arrival, live typing/presence) | `motion-engineer` (23) — router: "feels janky" is exactly this specialty's domain, and a real-time Durable-Objects-backed inbox is the sharpest place in the whole product for this to go wrong; the generalist default (300ms ease-in-out everywhere) is explicitly called out by the router as the failure mode this role prevents |
| Core Web Vitals / hydration (Next.js App Router specifics) | `web-standards-engineer` (25) — a live inbox with frequent updates is a real LCP/hydration risk surface, distinct from `performance-engineer`'s backend-join concern in phase 5 |
| a11y pass | `accessibility-engineer` (26) |
| Regression tests, incl. idempotency/dedup cases | `e2e-automation-engineer` (27) |
| **Phase gate** | `security-cso` (13) — webhook verification + replay protection sign-off before any channel goes live |

### Phase 5 — AI Agent Runtime v1

**Largest team, deliberately — highest-severity findings across all 5
review rounds concentrated here.**

| Task | Owner |
|---|---|
| Cross-domain tool registration | `ai-agent-engineer` (10) |
| Memory store + RLS-enforced vector queries | `database-data-engineer` (09), `ai-agent-engineer` (10) jointly |
| Self-healing retry/escalate loop | `ai-agent-engineer` (10) |
| Proactive-trigger background jobs | `ai-agent-engineer` (10) |
| Data-not-instructions boundary (messages, memory promotion, tool outputs) | **Joint owners: `ai-agent-engineer` (10) + `security-cso` (13)** — not implementer/reviewer; this is the #1 flagged attack vector across 3 of 5 review rounds and gets two names on the design, not a build-then-check split |
| **Adversarial prompt-injection eval suite** (distinct from ordinary regression tests — actual attack payloads across the message/memory/tool-output vectors) | `ai-agent-engineer` (10) — router's own line: "eval sets and injection surfaces are a distinct discipline"; this was missing as a named deliverable in the first draft of this table |
| Confirmation-UI provenance + fatigue mitigation (UI) | `frontend-lead` (07) implements, `taste-director` (24) reviews the visual distinction between routine and high-risk confirmations — a poorly differentiated confirmation UI is exactly how fatigue happens in practice, so this isn't ordinary UI work; `security-cso` (13) specifies the functional requirements |
| Autonomy-level config, defaults, rate/value ceiling enforcement | `ai-agent-engineer` (10) |
| Owner-only floor + cooldown | `backend-lead` (08) (permission logic), `security-cso` (13) review |
| Claim/lock mechanism + timeout | `backend-lead` (08) (Durable-Objects-resident per §7's fix) |
| AI-unavailable degraded mode | `ai-agent-engineer` (10) + `frontend-lead` (07) for the UI state |
| Window-tracking as independent deterministic job | `integration-engineer` (11) (owns the WhatsApp plugin this lives in) |
| `agent_action_log`/`usage_meter` split, GDPR tombstone mechanism | `database-data-engineer` (09) |
| Per-turn cross-domain join performance | `performance-engineer` (14) |
| **Phase gate** | Mission-2-style: `staff-code-reviewer` (15) + `security-cso` (13) + `performance-engineer` (14), per router's "review this PR, is this safe to merge" mapping — mandatory given the blast radius of a bug here; the adversarial eval suite results are a required input to this gate, not optional evidence |

### Phase 6 — Guided Onboarding Flow

| Task | Owner |
|---|---|
| OAuth-based channel connection flow | `frontend-lead` (07) + `integration-engineer` (11) |
| Auto-import of existing contacts | `backend-lead` (08) |
| Minimal-by-default plugin activation UI (owner-only) | `frontend-lead` (07) |
| Time-to-first-value instrumentation | `devex-engineer` (17) — router: exactly this role's domain |
| Validation against real user behavior | `ux-researcher` (05) |
| Onboarding-flow usability/efficiency review | `devex-engineer` (17) + `ux-researcher` (05) jointly — this phase is the sharpest test of "user-friendly and efficient," since §1a's own research found complexity is the #1 reason CRMs get abandoned; onboarding is where that's decided in the first session |

### Phase 7 — Proactive Behaviors + Marketing Plugins

| Task | Owner |
|---|---|
| Proactive trigger logic (low stock, aging SLA, cold deals) | `ai-agent-engineer` (10) |
| Meta Ads API integration | `integration-engineer` (11) |
| WhatsApp broadcast plugin | `integration-engineer` (11) |
| Plugin implementations under §6.1's portability contract | `backend-lead` (08) |
| Permission-grant review for marketing plugins (spend/reach risk) | `security-cso` (13) |
| Version-drift re-review as these plugins evolve | `security-cso` (13) |

### Phase 8 — Hardening Pass

| Task | Owner |
|---|---|
| Security review + penetration testing | `security-cso` (13) |
| Independent second-model review | `adversarial-second-model-reviewer` (16) — router: "different model, different blind spots," valuable specifically because every review in this project to this point has been Claude reviewing Claude |
| Data export/deletion tooling | `backend-lead` (08) |
| CI isolation-test verification (does it actually catch a missing policy / broken context propagation) | `database-data-engineer` (09) |
| Audit-logging review | `security-cso` (13) |
| Production runbook | `documentation-engineer` (21) |
| API/integration docs for the plugin contract | `technical-writer-dx` (31) |

## 6. Coverage audit — every task from §3, checked against §5's
assignment table

This is the actual verification, not an assertion. Cross-referencing
the task inventory (§3) line by line against the phase tables (§5)
confirms every extracted task has a named owner. No task in §3 lacks a
row in §5. Two categories that could be missed are called out
explicitly since they're easy to leave implicit:

- **Cross-phase tasks** (things that recur, not a one-time build): a11y
  passes recur in phases 2/3/4/6 — each phase table has its own row
  rather than one deferred mention. Regression tests recur every
  phase — same treatment. Security review recurs at every phase gate,
  not only phase 8.
- **Review/verification tasks**, not just build tasks: every phase table
  includes a "phase gate" or review row where the spec calls for one
  (phases 1, 4, 5 explicitly; others get standing `security-cso`
  coverage per §1).

## 6a. Standing UI principle: user-friendly and efficient over impressive

Explicit, cross-phase requirement (not just phase 6's onboarding): every
UI phase (2, 3, 4, 6) is reviewed against usability and efficiency
first, matching the spec's own §1a research finding that complexity —
not lack of visual polish — is the #1 reason products like this get
abandoned. Concretely, this means:

- `accessibility-engineer` (26) and `ux-researcher` (05) — already
  assigned per-phase above — are the two roles whose sign-off is about
  *whether the UI works for the person using it daily*, and neither is
  optional or a late-stage nice-to-have; both appear in each relevant
  phase table.
- `design-director` (06)/`taste-director` (24)/`motion-engineer` (23)
  (added in this revision, §4/§4a) raise the visual/interaction bar, but
  report to the same standard — a beautiful screen that's slower or more
  confusing to use than a plain one is a regression against this
  project's own stated differentiator, not a win. This is the practical
  meaning of §4a's "polished, fast, and confident, not restrained, but
  not spectacle-for-its-own-sake."
- No phase table lists a design/motion role without also listing
  `accessibility-engineer` and (where a phase has one) a usability
  check — this was verified while adding those roles in this revision,
  not assumed.

## 7. Cross-cutting roles (pulled in by signal, not phase-bound)

- `research-analyst` (30) — any unfamiliar API/protocol/regulation
  detail discovered mid-phase (router's own fallback rule: "an honest
  unknown is a valid output; confident invention is not")
- `staff-code-reviewer` (15) — ordinary PR review throughout, in
  addition to the phase-5 mandatory gate

## 8. What this structure does NOT do

- Does not run all 31 agents at once — capped at 3-5 active per phase,
  per the router.
- Does not start building — structure only, per this task's explicit
  instruction.
- Does not replace `docs/ROUTER.md` — a project-specific application of
  it.
- Does not claim no future task will ever be discovered. What §6's audit
  actually verifies: every requirement stated in the design spec as it
  exists today has a named owner. A spec change (and the 5 review rounds
  already run show real changes are likely) requires re-running §2's
  extraction method against the diff — this document names that as the
  maintenance step, not a one-time guarantee.

## 9. Handoff and reporting

- Each phase's team reports to `cto-delivery-lead` (01) on completion.
- `observability-learning-engineer` (20) runs `/retro` per phase,
  appending to "Learned constraints" below.
- Next action after this structure is approved: still not
  implementation — confirming this structure with the user.

## Learned constraints
*(appended by `observability-learning-engineer` after each phase — empty
until phase 1 completes)*
