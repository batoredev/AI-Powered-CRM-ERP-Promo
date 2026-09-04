# Research: Per-Client Deployment Model

**Date:** 2026-09-03
**Question:** Can an AI CRM+ERP product (Next.js/TS, Postgres+RLS, Cloudflare/OpenNext)
viably give every client their own fully separate deployed instance ("fresh copy per
customer"), and what is the real operating model for doing so at scale?

**Context:** the user's stated goal is a one-stop AI-automation business backend,
customized per client, with a "fresh copy for every customer." The initial framing
implied separate forked source repos per client. This research was commissioned to
find out how that pattern actually works at scale before committing to it.

---

## Answer, direct, first

**The pattern of full data/deployment isolation per client is real and proven.
The pattern of *forking source code* per client is not — nobody who succeeds at
this scale does it that way.**

Every successful operator found (Azure's own reference guidance, ProGlove/AWS at
6,000 accounts run by a 3-person team, GitLab Dedicated, Pantheon's agency upstream
model, Neon's database-per-tenant product) converges on the same shape:

> **One golden codebase → deployed N times → with per-client data/infrastructure
> isolation.**

The distinction that matters: *"each client gets their own deployment and database"*
and *"each client gets their own repo"* are two independent decisions. The first is
well-proven and directly achievable on this stack. The second is the thing that
breaks every case study found — unmergeable drift, O(N) manual conflict resolution,
features withheld to keep instances manageable (even GitLab does this on Dedicated).

**Outcome of this research, as reflected in the plan:** ship one shared codebase,
deploy it once per client (own Cloudflare Worker, own Neon Postgres project, own
domain), keep — not remove — the existing Row-Level Security layer as defense in
depth, and automate provisioning + update propagation as first-class tooling from
day one.

---

## Evidence

### Real-world precedent (verified)

- **ProGlove / AWS:** a **3-person team** operates **~6,000 tenant AWS accounts**
  (~50% active), ~120,000 deployed service instances, ~1,000,000 Lambda functions —
  from **one shared artifact**, fanned out via AWS Step Functions provisioning and
  CloudFormation StackSets + CodePipeline for updates. Source:
  [AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/6000-aws-accounts-three-people-one-platform-lessons-learned/).
- **GitLab Dedicated:** fully isolated per-customer instance, still **one codebase**,
  centrally scheduled weekly upgrades. Priced (third-party estimate, not GitLab's own
  published price) around **$26,000/month**, and GitLab still has to *withhold
  features* to keep per-instance updates manageable (LDAP/Kerberos auth, Reply-by-email,
  Service Desk, some AI features, Pages custom domains). Source:
  [GitLab Dedicated docs](https://docs.gitlab.com/subscriptions/gitlab_dedicated/).
- **Pantheon Custom Upstreams** (agency-many-client-sites model, closest commercial
  analogue to this goal): one shared upstream codebase, developers update it once,
  changes flow downstream via `terminus upstream:updates:apply` or a Mass Update
  plugin. Source: [Pantheon docs](https://docs.pantheon.io/certification/study-guide/custom-upstreams).
- **Vercel's own published decision guidance** (verified, updated 2026-06-26) splits
  explicitly into two columns:
  > *Multi-Tenant:* "all tenants use the same application... you want to deploy
  > once, update all tenants... lower operational overhead preferred."
  > *Multi-Project:* "tenants deploy their own code; each tenant needs custom
  > functionality; complete isolation is required."

  An AI CRM+ERP where every client gets the same product and features is the
  *Multi-Tenant* column almost verbatim — it only becomes *Multi-Project* if clients
  genuinely run different code, not just different data/config.
  Source: [Vercel Multi-Project Platforms](https://vercel.com/docs/platforms/multi-project-platforms/concepts).
- **Odoo/ERPNext partner agencies** (closest SMB-ERP business-model match):
  standard architecture is one database per client on shared application code.
  Practitioner accounts describe 10 clients as "a fundamentally different problem"
  from 1 — but the difficulty scales with *instance count*, not source forks, and
  is caused by *inconsistent versions* across instances (i.e. failure to keep them
  in sync), not by the isolation itself.
  Source: [DeployMonkey](https://deploymonkey.com/blog/odoo-for-agencies), [OEC.sh](https://oec.sh/guides/odoo-multi-tenant).

**Not found despite searching:** any credible published example of a team
successfully maintaining thousands (or even hundreds) of genuinely *forked*
per-client application codebases for the same product. The absence itself is a
finding — this tier does not appear to exist in published practice.

### Update propagation (verified)

- **Template-sync tooling exists** (Cruft, Copier) for keeping generated projects in
  sync with a template via git-merge-style updates — but these are designed for
  scaffolding drift (CI config, linters), with a human resolving each conflict per
  repo. Not evidenced to scale to shipping application bug fixes across hundreds of
  instances without O(N) human review.
- **The actionable pattern:** package the shared core as a **versioned dependency**,
  not forked source (the WordPress/Bedrock agency pattern — themes/plugins installed
  and updated like any other dependency, with Renovate bot opening batched update
  PRs across site repos). "Ship the fix to everyone" becomes a version bump, which
  is bot-mergeable; a source-level merge is not.
  Source: [Roots Bedrock](https://roots.io/bedrock/), [Kinsta agency stack](https://kinsta.com/blog/wordpress-agency-tech-stack/).
- **The tolerable-customization boundary is file-disjointness, not a percentage.**
  Pantheon's own troubleshooting docs: automated conflict resolution toward upstream
  (`-Xtheirs`) is *"safe to run if you don't have your own changes in any of the
  conflicting files."* Practical rule: automated propagation survives exactly as
  long as client customization and upstream changes never touch the same file.
  Enforce this structurally (per-client config/overlay directories that core code
  never writes to), not by discipline alone.
  Source: [Pantheon troubleshooting](https://docs.pantheon.io/guides/custom-upstream/troubleshooting).
- **Real failure modes documented:** partial rollouts when individual instances fail
  to deploy; pipeline duration growing at fleet scale; version drift across
  instances; unresolvable auto-merge conflicts on file renames/deletions;
  **observability cost becoming economically unsustainable at scale** — AWS/ProGlove
  specifically flag this as the cost line that surprised them.

### Provisioning automation (verified, stack-specific)

- **Vercel:** programmatic project creation from a template repo
  (`vercel.projects.createProject(...)` with `gitRepository` pointing at a template),
  plus programmatic custom-domain attachment with automatic SSL. A Pulumi provider
  exists for IaC-style provisioning.
- **Cloudflare (current platform) — hard limits that constrain this plan directly:**
  - **500 Workers per account** on the paid plan (100 on free). Cloudflare's own
    Workers-for-Platforms docs explicitly instruct: *"You should not create a
    namespace per customer."*
  - **Workers for Platforms (the mechanism for isolated per-customer Workers beyond
    the basic model) is an Enterprise-only feature with custom pricing** — get a
    quote before committing past ~500 clients.
  - **100 custom domains per zone** — likely to bite before the Worker cap if every
    client gets a vanity domain.
  Source: [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/index.md),
  [Workers for Platforms isolation](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/worker-isolation/).
- **Neon (current Postgres provider) is well-suited to per-client databases:** full
  lifecycle (provision/configure/scale/restore/delete) via public API; **scale-to-zero**
  means idle client instances cost near-nothing; the Scale plan includes **5,000
  projects**. This is the mechanism that makes per-client-database economics work at
  all — contrast Supabase, which provisions an always-on VM per project (~$1,000/mo
  for 100 tenants on Micro instances per third-party analysis).
  Source: [Neon: thousands of projects](https://neon.com/blog/thousands-of-neon-projects-now-included-in-your-pricing-plan),
  [Neon database-per-tenant](https://neon.com/use-cases/database-per-tenant).

### Cost reality (verified directional, unverified numbers)

- Azure states plainly: *"If a single tenant requires a specific infrastructure
  cost, 100 tenants probably require 100 times that cost."* Any per-instance fixed
  cost multiplies by client count — this is why scale-to-zero (Neon) matters more
  here than it would in a shared-infra model.
- **Do not use** the commonly repeated "single-tenant costs 3-5x more" or "multi-tenant
  saves 30-60% TCO" figures — these trace to vendor marketing blogs with no
  disclosed methodology, not to a verifiable study.
- No source gives a defensible single client-count threshold where this model
  "stops working." The evidence instead points to: **the threshold is not a client
  count, it's whether provisioning and updates are 100% automated.** Manual
  operations hit a wall near 10-20 clients; fully automated single-artifact fan-out
  scales to thousands (ProGlove is the existence proof).

### Security/compliance (verified)

**In favor of per-client deployment:**
- Genuine reduction in cross-tenant leakage risk — a bug cannot leak across clients
  that share no database, shifting the guarantee from "is this query correct" to
  "is this topology correct."
- Trivial data residency / region pinning per client.
- Progressive rollout reduces system-wide outage risk — a bad deploy can hit one
  client's instance without touching the fleet.
- Azure explicitly notes this can be sold as a pricing tier: isolation as a paid
  upgrade.

**Against (real costs to plan for):**
- Patch/audit scope multiplies — a security fix must reach every instance, and a
  fleet where some instances missed the patch is *less* secure than one correctly
  built multi-tenant deployment.
- Isolation is not automatic — Cloudflare's own docs warn a misconfigured KV/D1
  binding still leaks data across tenants even in a per-customer-Worker setup.
- Observability cost scales in a way that's easy to underestimate (see above).

**Relevant to this specific codebase:** the existing multi-tenant RLS layer
(`lib/db/with-tenant.ts`, 14 `CREATE POLICY` statements, a dedicated
`rls-policy-audit.test.ts`) is well-built and already tested. Discarding it to
reduce line count would be a one-way door with no real benefit — keeping it as
defense-in-depth underneath per-client database provisioning costs nothing and
preserves the option of a shared-instance tier for trial/small clients later.

---

## Recommended operating model (informed the written plan)

1. One shared, versioned codebase. Per-client variation is data/config, not code.
2. Each client gets their own Cloudflare Worker + Neon Postgres project + domain,
   provisioned by an idempotent script, not by hand.
3. Keep the existing RLS layer as defense-in-depth even though each client has a
   separate database — it costs nothing to leave in place and preserves future
   flexibility (e.g. a lower-tier shared-instance offering).
4. Customization happens through an overlay/config layer the core codebase never
   writes to — this is what keeps update propagation bot-automatable rather than a
   human merge per client per release.
5. Provisioning and fleet-status tooling are `tools/`-class scripts from day one,
   per this project's own WAT rules — this is exactly the kind of mechanical,
   repeatable operation those rules require pushing into scripts rather than
   reasoning through per client.
6. Instrument observability cost per instance explicitly before scaling past a
   handful of clients — this is the cost line every real case study says gets
   missed.

## Open items not resolved by research (need a human decision, tracked in the plan)

- Exact client-count ceiling to plan infrastructure around for the next 12-24 months
  (determines whether Cloudflare's Enterprise Workers-for-Platforms tier is needed).
- Whether any client will ever need genuinely different code (not just
  config/theming) — if yes for even one client, that client alone may warrant the
  Vercel "Multi-Project" treatment while everyone else stays on the shared model.
