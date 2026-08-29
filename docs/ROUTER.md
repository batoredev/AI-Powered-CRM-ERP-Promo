# Router — job to agents

The lead consults this before spawning. Signal words on the left, default team on the right.

**Cap every team at 3–5.** Where a row lists more, pick the subset the specific request needs, or split into sequential missions.

---

## Frontend and interface

| Signal in the request | Spawn | Why this one |
|---|---|---|
| "animation", "transition", "micro-interaction", "feels janky", "springs", "gesture" | `motion-engineer` + `design-engineer` | Motion is a deep specialty; the generalist defaults to 300ms ease-in-out everywhere |
| "component", "design system", "tokens", "reusable", "our button is a mess" | `design-engineer` + `design-director` | Component *API* design is distinct from visual design |
| "it looks generic", "looks AI-made", "needs personality", "aesthetic direction" | `taste-director` + `design-director` | Variance calibration, not implementation |
| "accessible", "a11y", "screen reader", "keyboard", "WCAG", "contrast" | `accessibility-engineer` (+ `design-engineer` to fix) | Read-only specialist; the fixes belong to the file owner |
| "Core Web Vitals", "LCP", "slow page", "SEO", "hydration", "bundle size" | `web-standards-engineer` + `performance-engineer` | Platform correctness and runtime cost are different lenses |
| "build the screen", "implement the page", ordinary UI work | `frontend-lead` | No dominant specialty — the generalist is correct |
| "mockup to code", "match the design" | `design-engineer` + `frontend-lead` | Fidelity under real data is the hard part |

## Backend, data, and integration

| Signal | Spawn | Why |
|---|---|---|
| "API shape", "endpoint contract", "versioning", "breaking change", "OpenAPI", "GraphQL schema" | `api-contract-engineer` + `backend-lead` | The contract is the parallel-work interface; get it explicit first |
| "schema", "migration", "index", "query is slow", "RLS", "data model" | `database-data-engineer` | **Sole owner of migrations.** No exceptions |
| "webhook", "third-party", "sync", "OAuth to X", "their API" | `integration-engineer` | Seams are where production incidents live |
| "endpoint", "business logic", "service", ordinary backend | `backend-lead` | |
| "RAG", "agent", "prompt", "eval", "LLM cost", "hallucination" | `ai-agent-engineer` | Eval sets and injection surfaces are a distinct discipline |
| "script", "export", "automate this", "we do this every week" | `integration-engineer` | Owns `tools/`. This is the WAT layer |

## Testing and verification

| Signal | Spawn | Why |
|---|---|---|
| "test the flow", "does it work", "click through it" — **web** | `qa-browser-lead` | Exploratory, stateful daemon |
| "e2e tests", "Playwright", "regression suite", "CI tests" | `e2e-automation-engineer` | Deterministic, code-defined, isolated per run |
| **React Native / Expo**, any QA | `mobile-qa-engineer` | The browse daemon cannot reach the app |
| "review this PR", "is this safe to merge" | `staff-code-reviewer` + `security-cso` + `performance-engineer` | Mission 2 |
| "security", "auth", "injection", "vulnerability", "pentest" | `security-cso` | OWASP + STRIDE |
| "second opinion", "am I sure about this" | `adversarial-second-model-reviewer` | Different model, different blind spots |
| "onboarding is confusing", "setup takes too long", "docs are wrong" | `devex-engineer` | TTHW and the docs-versus-reality gap |

## Planning and direction

| Signal | Spawn | Why |
|---|---|---|
| "should we build this", "is this worth it", "what's the real problem" | `product-ceo-strategist` (solo `/office-hours` first) | A team adds nothing to a conversation |
| "how should we build this", "architecture", "plan this out" | `solutions-architect` | Produces the file-ownership map everything depends on |
| "acceptance criteria", "what does done mean", "scope" | `business-analyst-spec` | |
| "what do users actually do", "journey", "research" | `ux-researcher` | |
| Full plan review, anything that matters | Mission 1: `product-ceo-strategist` + `design-director` + `devex-engineer` + `solutions-architect` | Matches `/autoplan`'s four gates |

## Ship, operate, document

| Signal | Spawn | Why |
|---|---|---|
| "deploy", "CI", "Docker", "proxy", "runbook" | `devops-sre` | Under `/guard` near production |
| "ship it", "merge", "release" | `release-manager` — **solo, never a team** | Syncs main and pushes |
| "migrate to", "move off", "new infrastructure" | Mission 6: `devops-sre` + `database-data-engineer` + `backend-lead` | |
| "runbook", "handover", "how do we operate this" | `documentation-engineer` | |
| "API docs", "integration guide", "SDK docs", "examples" | `technical-writer-dx` | Developer-facing, distinct from runbooks |
| "why did prod break", "monitoring", "what did we learn" | `observability-learning-engineer` | |

## Debugging

| Signal | Spawn | Why |
|---|---|---|
| "bug, and I know roughly where" | Solo `/investigate` | A team is overkill |
| "bug, no idea why", "intermittent", "can't reproduce" | Mission 3: five `solutions-architect` instances, one hypothesis each | Adversarial framing breaks anchoring |
| "it worked yesterday" | Solo `/investigate` first, escalate to Mission 3 if inconclusive | |

## Capability gap — the fallback

| Signal | Spawn |
|---|---|
| Unfamiliar API, library, protocol, vendor, regulation, or framework version | **`research-analyst`, before implementing anything** |
| A teammate says it cannot proceed without information nobody has | `research-analyst` |
| An agent is about to write "typically" or "usually" about something specific | `research-analyst` |

It produces a brief from primary sources, labelling verified versus inferred and stating plainly what it could not determine. **An honest "unknown" is a valid output; confident invention is not.**

---

## Skill ownership index

Every installed skill has an owner. Nothing is unused.

| Skill | Primary owner | Also used by |
|---|---|---|
| `gstack` planning (`/office-hours`, `/plan-*-review`, `/autoplan`) | `product-ceo-strategist`, `solutions-architect` | `design-director`, `devex-engineer` |
| `gstack` review (`/review`, `/cso`, `/codex`) | `staff-code-reviewer`, `security-cso`, `adversarial-second-model-reviewer` | lead, after shutdown |
| `gstack` browser (`/browse`, `/qa-only`, `/scrape`, `/benchmark`, `/canary`) | `qa-browser-lead` — **exclusive** | requested by `performance-engineer`, `devex-engineer` |
| `gstack` safety (`/freeze`, `/careful`, `/guard`) | every implementer | |
| `gstack` ship (`/ship`, `/land-and-deploy`, `/document-release`) | `release-manager` | |
| `gstack` memory (`/learn`, `/retro`, `/context-save`, gbrain) | `observability-learning-engineer` | `solutions-architect` |
| `gstack` design (`/design-consultation`, `/design-shotgun`, `/design-html`) | `design-director` | `design-engineer` |
| **`ui-ux-pro-max`** | `design-engineer` | `design-director`, `taste-director`, `accessibility-engineer`, `web-standards-engineer` |
| **`taste`** | `taste-director` | |
| **`awesome design`**, **`impeccable`** | `taste-director` | `design-director` |
| **`ui-skills`**, **`ui.live`**, **`animos`** | `design-engineer` | `frontend-lead` |
| **`Emil Kowalski`** | `motion-engineer` | `accessibility-engineer` (focus in overlays) |
| **`motion`**, **`motion-dom`**, **`motion-utils`**, **`framer-motion`**, **`animejs`** | `motion-engineer` | |
| **`vercel web guidelines`** | `web-standards-engineer` | `accessibility-engineer`, `technical-writer-dx`, `frontend-lead` |
| **`playwright`**, **`playwright-core`** | `e2e-automation-engineer` | |
| **ECC** engineering, TDD, refactoring, research-first | `backend-lead`, `frontend-lead`, `solutions-architect` | all implementers |
| **Ruflo** memory / RAG | `ai-agent-engineer`, `observability-learning-engineer` | |
| **karpathy-skills** | every agent, as the shared preamble | not invoked — applied |
| **Anthropic document skills** | `documentation-engineer`, `technical-writer-dx` | |

**Before your first serious mission:** run `ls ~/.claude/skills/` and replace the generic ecosystem references in each agent body with the real skill names. Named skills steer far better than category references. This remains the single highest-leverage edit available.
