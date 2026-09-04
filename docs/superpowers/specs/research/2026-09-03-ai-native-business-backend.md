# Research: AI-Native Complete Business Backend

**Date:** 2026-09-03
**Question:** What would it take to build a genuinely unique, market-leading
AI-native "complete business backend" (CRM+ERP+full automation) that a small team
could actually defend against both enterprise incumbents and funded AI-native
startups?

**Scope note:** this deliberately does not re-cover basic CRM feature parity —
that's already documented in `docs/superpowers/specs/research/2026-09-01-erp-market-research.md`
and the earlier CRM feature-audit artifact. This is scoped to what's *new and
differentiating* for an AI-automation-first platform, beyond commodity chat/scoring
features.

---

## Answer, direct, first

**The "AI-native ERP/CRM" category is no longer open field — it is funded and
contested as of mid-2026.** Campfire (AI-native ERP) went seed → $35M Series A →
$65M Series B in ~15 months. Basis raised $100M at a $1.15B valuation for accounting
agents. SAP shipped "Autonomous Suite" (200+ specialized agents) at Sapphire in May
2026. Microsoft made agentic AI the centerpiece of Business Central's 2026 release
wave. **"We have AI agents" is already commodity at the incumbent level.**

Three things are still genuinely open and hard to copy, based on the evidence:

1. **Cross-domain agent handoff on one shared data model.** Every incumbent and
   funded startup found is domain-siloed (Basis = accounting only, Campfire =
   finance-ERP only, Sierra/Decagon = support only, SAP/Microsoft = many agents but
   bolted onto legacy separate modules). Nobody credibly has a sales agent handing
   to an ops agent handing to a finance agent on one schema. This matches this
   project's own stated differentiator in its design doc §5.
2. **The governance/autonomy substrate** — graduated autonomy levels, approval
   thresholds, immutable audit trail, shadow-mode simulation before activation.
   This is the actual gating factor on production deployment and is under-built
   industry-wide.
3. **Agent-executable business memory** — the accumulated record of how *this
   specific tenant* decides things, used to raise autonomy over time. The only real
   data flywheel available to a small team; not buyable, not fast to copy.

**Honest risk, stated plainly:** a small team cannot out-feature SAP or out-fund
Campfire on breadth. The viable wedge is the SMB one-stop position neither
enterprise incumbents (too heavy/expensive) nor point-solution startups (too
narrow) can occupy without abandoning their own business model.

---

## Evidence

### Who is building agentic back-office software (verified)

- **Microsoft Dynamics 365 Business Central, 2026 wave 1 (Apr-Sep 2026):**
  distinguishes *Copilot* (assistive) from *autonomous agents* (act end-to-end).
  Named example: the Payables Agent "automates accounts payable end-to-end, reading
  invoices, matching vendors and accounts, and **preparing invoices for approval
  with human oversight**." Even Microsoft's flagship autonomous agent stops at
  human approval for financial action — a useful calibration point for this
  project's own autonomy posture.
  Source: Microsoft Learn, Business Central 2026 release wave 1 overview.
- **SAP Autonomous Suite (Sapphire, May 2026):** five domains (Finance, Spend,
  Supply Chain, HCM, CX), 50+ domain "Joule Assistants" orchestrating 200+
  specialized agents, grounded in the SAP Knowledge Graph. Named capability:
  Autonomous Close Assistant compresses financial close "from weeks to days." No
  availability dates or pricing published as of the source date.
  Source: SAP news release, May 2026.
- **Campfire (YC S23):** AI-native ERP, $3.5M seed → $35M Series A (Accel, Jun
  2025) → $65M Series B (Accel + Ribbit, Oct 2025). Replaced NetSuite/QuickBooks at
  100+ companies including Replit, Trust & Will, Midi Health.
- **Basis:** accounting/tax/audit agents, $100M Series B at $1.15B (Accel, GV,
  Khosla, Feb 2026), $138M total raised, used by ~30% of top-25 accounting firms.
  Demonstrated an agent autonomously completing a 1065 tax return (unverified
  independently — vendor demo).
- **Ramp Agents for AP** (launched Oct 7, 2025): applies GL codes from historical
  data, provides approval recommendations, flags card-payment opportunities. Vendor
  claims 85% of accounting fields correct first-try, fraud model flagged >$1M in
  fraudulent invoices in 90 days among early-access customers. **Read the 85%
  figure honestly — it implies ~15% of the work still needs a human, which is the
  real operating reality behind "full automation" claims industry-wide.**

**Notable finding:** Accel led both the Campfire and Basis rounds — a top-tier
firm has concluded the AI-native back-office is a category-defining opportunity and
is funding it along domain lines, i.e. accounting-only and finance-ERP-only, not
one unified cross-domain platform. This is exactly the gap this project's design
doc already identified.

### What "full AI automation" means operationally, beyond CRM (verified, by domain)

- **AP/invoice processing** — most mature category (Ramp, above). Real operating
  reality: ~85% first-pass accuracy, not full automation.
- **Bank reconciliation/close** — SAP's Autonomous Close Assistant; Business
  Central's account reconciliation agent.
- **Tax** — Basis's autonomous 1065 completion is the most aggressive autonomy
  claim found in any regulated domain; unverified independently.
- **Procurement/supply chain** — SAP Autonomous Spend/SCM; Business Central 2026
  wave 1 adds price-demand correlation, capacity-to-promise protection, AI-powered
  picking/inventory rebalancing.
- **Support with real system actions** — Sierra/Decagon category, notable for
  **outcome-based pricing** (~$1.50/resolution, reported/estimated) rather than
  seat-based — only works if the agent can actually close the loop in the system
  of record, which a combined CRM+ERP is structurally positioned to do better than
  a point solution.
- **Compliance/e-invoicing** — underrated, durable workload (rules change
  continuously, jurisdiction-specific, never commoditizes). Business Central
  devotes real release surface to e-documents, CSRD, CBAM.
- **HR/payroll** — SAP Autonomous HCM exists; no detailed primary capability
  breakdown found. Unknown.

### Multi-agent orchestration architecture (verified, directly actionable)

**MCP (Model Context Protocol) — the current spec is `2026-07-28`, a major
breaking revision from earlier versions any pre-mid-2026 model knowledge would
assume.** This is the single most load-bearing technical finding in this brief for
any agent/tool-contract work on this project:

- **MCP is now stateless** — the `initialize`/`notifications/initialized`
  handshake is removed; every request carries protocol version and capabilities.
- **Protocol-level sessions and `Mcp-Session-Id` are gone.** A long-running
  business workflow spanning many tool calls must now carry its own state handle
  as an explicit, server-minted argument.
- **Multi Round-Trip Requests (MRTR)** replace server-initiated requests. A server
  returns `InputRequiredResult` (`resultType: "input_required"`) to request more
  input; the client retries with `inputResponses`. **This is a standards-native
  human-approval mechanism** — an agent needing sign-off to pay an invoice returns
  `input_required` instead of needing bespoke approval-UI plumbing.
- **Tasks moved to an official extension** (`io.modelcontextprotocol/tasks`):
  `tasks/get` / `tasks/update` / `tasks/cancel` — the primitive for modeling
  long-running business processes (a month-end close is not request/response).
- **Roots, Sampling, and Logging are deprecated** (SEP-2577) — do not build new
  code against them.
- **OpenTelemetry trace-context propagation is now spec'd** for `_meta`
  (`traceparent`/`tracestate`/`baggage`, SEP-414) — gives standards-based agent
  tracing, satisfying this project's own `ai-systems.md` tracing requirement for
  free if adopted.
- MCP's own security principles: hosts must get explicit user consent before any
  tool invocation, and tool-behavior descriptions must be treated as untrusted —
  but MCP explicitly cannot enforce this at the protocol level; enforcement is the
  application's job (directly relevant to this project's own `security.md` rule on
  treating retrieved/tool content as untrusted input).
  Source: modelcontextprotocol.io/specification, changelog.

**A2A (Agent-to-Agent):** version 1.0 stable spec as of its one-year anniversary
(April 2026), 150+ supporting orgs (AWS, Cisco, Google, IBM, Microsoft, Salesforce,
SAP, ServiceNow), production deployments in supply chain/financial
services/insurance/IT ops. Division of labor: **A2A is for cross-organization
agent communication; MCP connects agents to internal tools/data.** For this
project (single-vendor, internal CRM+ERP tools), MCP is the primary need now; A2A
becomes relevant only for cross-company cases (e.g. a procurement agent negotiating
with a supplier's agent) — worth deferring.
Source: Linux Foundation press release, April 9 2026.

**AP2 (Agent Payments Protocol):** Google's protocol for accountable agent
spending, 60+ launch partners (Mastercard, PayPal, Coinbase, Amex, Salesforce),
v0.2.0 shipped April 2026. Every agent purchase = three signed Mandates (Intent →
Cart → Payment), each a W3C Verifiable Credential. **AP2 doesn't move money — it
produces a verifiable, replayable authorization record any rail can settle
against.** The mandate pattern generalizes well beyond payments to *any*
consequential agent action (refund, inventory adjustment, payroll change) and is
the best-designed answer found to "how does an agent act accountably."
Source: Google AP2 announcement and v0.2.0 release notes.

**Multi-agent cost reality (verified, directly constrains architecture choices):**
Anthropic's own engineering writeup on their multi-agent research system:
- Agents use ~4x more tokens than chat; **multi-agent systems use ~15x more
  tokens than chat.**
- Token usage explains 80% of variance in performance on research-style tasks.
- Multi-agent is a **poor fit** for "domains that require all agents to share the
  same context or involve many dependencies between agents" — Anthropic's own
  words. **Business back-office workflows (a quote becoming an order becoming an
  invoice) are exactly this shared-context, high-dependency case.**
- Correct read for this project: **one orchestrator with domain-specialized tools
  and skills over a shared data model**, spawning subagents only for genuinely
  parallel, context-heavy sub-tasks — not a standing committee of persistent
  domain-specific agents constantly handing off.
- Evaluation approach: LLM-as-judge, 0.0-1.0 rubric, start with ~20 eval queries
  before scaling, supplement with human testing on edge cases.
  Source: anthropic.com/engineering, "How we built our multi-agent research
  system."

### Governance frameworks (secondary-sourced, lower confidence)

NIST AI RMF and ISO/IEC 42001 are what enterprise buyers check against in
procurement. ISO 42001 control A.6.2.8 (AI system event log recording) functions
as the closest existing standard for an agent-reasoning audit trail, but multiple
secondary sources note the standard does not specifically address agentic systems
— tool authorization, delegation-chain integrity, and multi-agent emergent
behavior need supplementary controls this project would need to define itself.
**Flagged as secondary-sourced; the standards documents themselves were not read.**

### What is actually defensible vs. commodity (verified + reasoned)

**Confirmed commodity** (consistent with the earlier CRM-feature research already
done for this project): chat drafting, basic lead scoring, "AI assistant" framing,
document OCR extraction, conversational reporting.

**What the evidence supports as genuinely defensible for a small team, in order:**

1. **Unified CRM+ERP schema traversed by agents.** Structural, not a feature —
   SAP and Microsoft cannot retrofit this onto decades of module boundaries. This
   is precisely this project's own already-stated differentiator (design doc §5:
   "customer asks about order status → check ERP order + CRM history → draft/send
   reply, in one pass").
2. **Graduated, earned autonomy as a visible product surface.** Every agent action
   carries an autonomy level that *rises per-workflow-per-tenant based on measured
   accuracy*, not a fixed posture. Nobody surveyed has made "how much do I trust
   this agent, and how did it earn that" a first-class, auditable, visible feature.
   This is the single highest-defensibility item found — a genuine data flywheel.
3. **Mandate-based authorization for every consequential action**, generalizing
   AP2's pattern beyond payments — signed, verifiable, replayable records for
   refunds, inventory changes, discount approvals, not just money movement.
4. **Immutable, full-provenance audit trail** (inputs, retrieved context, tool
   calls, model version, confidence, human touchpoints) — mapped to MCP's
   OpenTelemetry trace propagation and ISO 42001's event-log control. Being early
   here matters because the standards genuinely don't cover agentic systems yet.
5. **Shadow-mode simulation before activation** — every new automated workflow
   runs read-only against live data, scored against what a human actually did,
   before being allowed to act. Appears in every credible production account
   found and is what generates the evidence stream powering #2.
6. **Tenant-specific business decision memory** — every human override or
   exception becomes a labeled signal for *that tenant's* future autonomy. SAP's
   answer is a generic knowledge graph; the differentiated version is per-tenant
   and behavioral.
7. **Outcome-instrumented unit economics per automated transaction** — required
   both to enable Sierra-style outcome-based pricing and because of the 15x
   multi-agent token-cost multiplier above; this project's own `ai-systems.md`
   rule already requires cost-per-request accounting, so this is a compliance
   item as much as a business one.

### Case studies / build-in-public accounts (weakest section — stated honestly)

No credible primary engineering account of a team building agentic back-office
software was found; searches returned only content-farm and SEO material. The
widely-circulated "95% of GenAI pilots fail" (MIT Project NANDA) and "77% of
autonomous agent projects die in shipping" statistics are **not reliable enough to
cite as fact** — the NANDA study's actual finding is narrower than its headline
(no P&L impact within ~6 months, not "failed"; n=52 interviews, not peer
reviewed), and the 77% figure could not be traced to any primary source at all.
The *qualitative* pattern behind both — narrow high-volume task, human on risky
steps, tight permission scoping, shadow mode before autonomy — is independently
corroborated by Anthropic's own account and Microsoft's "prepare for approval"
design choice, so the advice is sound even where the statistics are not.

---

## Ranked: most differentiating AI automation capabilities

Ranked by (differentiation × defensibility) ÷ feasibility for a small team. This
list is what the written plan's roadmap is built from.

1. **Cross-domain agent handoff on the single unified CRM+ERP schema** — the core
   thesis; everything else supports it.
2. **Graduated autonomy with earned trust thresholds** — highest defensibility;
   a genuine data flywheel, not a feature.
3. **Mandate-based action authorization** (generalized AP2 pattern) for every
   consequential agent action, not just payments.
4. **Immutable agent audit trail with full decision provenance**, standards-mapped
   (MCP OpenTelemetry propagation, ISO 42001 A.6.2.8).
5. **Shadow-mode simulation before activation** — the practice every credible
   production account converges on.
6. **Tenant-specific business decision memory** — compounding, unbuyable,
   switching-cost-raising.
7. **Long-running business processes as first-class agent tasks**, modeled on
   MCP's `tasks` extension rather than request/response chat turns.
8. **Protocol-native human-in-the-loop** via MCP's MRTR (`input_required`)
   pattern instead of bespoke approval-UI plumbing.
9. **Autonomous exception handling as the headline metric** — competing on the
   "touchless rate" and the *exception* path, not just the happy path (honest
   framing given Ramp's own 85%-not-100% figure).
10. **Cash-flow-aware cross-domain decisioning** — e.g. an agent that won't
    approve a PO because a large receivable is overdue and payroll runs Thursday.
    Requires sales+procurement+AR+AP+payroll on one schema — only possible because
    of #1.
11. **Outcome-instrumented unit economics per automated transaction** — enables
    outcome-based pricing and is mandated by this project's own AI cost rules.
12. **Continuous regulatory/compliance agents** (e-invoicing, tax-schema changes)
    — durable, never-commoditizing workload, but jurisdiction-sprawling and
    expensive for a small team. Strong v2, not v1.

**Recommended cut for an initial build:** items 1, 2, 4, 5 are the irreducible
core — unified schema, earned autonomy, audit trail, shadow mode — together they
form a coherent thesis ("the business backend where agents earn the right to act,
and you can prove what they did"), not just a feature list. Items 3 and 6 follow
immediately after. Item 12 waits.

## Open questions for a human decision (carried into the plan)

1. **Autonomy posture** — match Microsoft's conservative "prepare for approval"
   baseline, or make *earned* higher autonomy the actual product? This is the
   core strategic bet and determines whether the system is architected around an
   approval queue or an earned-trust ledger — not refactorable into each other
   later.
2. **Scope discipline vs. the "complete business backend" promise** — the one
   verified production-success pattern is narrow + high-volume + clear
   definition of done, which is in tension with "one-stop for any business."
   Recommendation carried into the plan: unified *schema* from day one, but ship
   one automated *workflow* first, end to end, before broadening.
3. **Pricing model** — seat-based vs. outcome-based per automated transaction.
   Outcome-based is a real moat (Sierra's proof point) but requires per-workflow
   cost instrumentation from the start, which item 11 above already requires
   regardless.
4. **Regulated-domain appetite** — tax/payroll carry legal liability distinct
   from ordinary software bugs. In or out of scope for the first release.
