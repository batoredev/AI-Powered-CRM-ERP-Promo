# Skill Routing

## Stack responsibilities

### Anthropic official
Trusted baseline for Claude Code, official tooling, frontend, security, review, language support, MCP, and code-development workflows.

### ECC
Engineering specialists:
- architecture
- backend
- frontend
- testing/TDD
- security
- DevOps
- debugging
- refactoring
- documentation
- research-first workflows
- hooks/rules
- language/framework expertise

### gstack
Workflow system:
- product discovery
- specification
- planning
- design
- browser QA
- security
- performance
- review
- DevEx
- ship/deploy
- canary
- docs
- learning
- safety
- cross-model review

### UI/UX Pro Max
Design intelligence:
- UX
- UI
- typography
- color
- layout
- components
- accessibility
- responsive behavior
- visual quality

### Karpathy
Behavioral quality:
- no assumptions
- expose confusion
- simplicity
- surgical edits
- verify goal

### Ruflo
Orchestration and memory:
- task routing
- swarm execution
- memory
- RAG
- coordination
- learned patterns

---

## Skill binding — read this before the tables above mislead you

**You cannot preload skills per agent.** The `skills:` and `mcpServers:` frontmatter fields are
**ignored** when a definition runs as a teammate. Teammates load skills from project and user
settings, exactly like a normal session — every teammate sees the same pool.

An earlier version of this document showed YAML like `skills: [architecture, gstack:/plan-eng-review]`.
That does not work, and the `ecosystem:/skill` syntax is not a form the field accepts in any case.
It has been removed rather than corrected, because a plausible-looking snippet is worse than none.

### What actually specialises an agent

| Mechanism | Where | Enforced by the platform? |
|---|---|---|
| **Skill guidance in the body** | The agent's markdown body, which becomes its system prompt | No — but it genuinely steers behaviour |
| **`tools:` allowlist** | Agent frontmatter | **Yes.** A reviewer with no `Write` cannot write, whatever it decides |
| **File ownership** | The architect's plan, passed to `/freeze` | Partly — `/freeze` blocks Edit and Write, though Bash paths can escape |

So the ecosystem tables above are a **routing reference for you and for the agent bodies** — which
skill to reach for, in which role. They are not a configuration format.

### The one thing worth doing

Name real skills in the agent bodies. Every role file ends with a skills section; the gstack
entries are already concrete. Replace the generic references to ECC, Ruflo, UI/UX Pro Max, and
karpathy-skills with the actual skill names from `ls ~/.claude/skills/`. Named skills steer far
better than "invoke available skills."

---

## Dynamic capabilities

When a project needs:
- payments -> activate payment/integration skills
- WhatsApp -> activate messaging/Meta skills
- Supabase -> activate PostgreSQL/RLS/Supabase skills
- iOS -> activate gstack iOS workflows
- data extraction -> activate `/scrape`
- reusable workflow creation -> activate `/skillify`
- multi-model comparison -> activate `/benchmark-models`
- dangerous production work -> activate `/careful`, `/freeze`, `/guard`

---

## Quality routing

```text
UI issue          -> Design Director + Frontend + /design-review
Bug                -> QA + /investigate + implementation owner
Security issue     -> Security/CSO + implementation owner
Performance issue  -> Performance + relevant engineer
Code quality       -> Staff Reviewer
Critical review    -> Staff Reviewer + /codex
Production issue   -> SRE + /investigate + CTO
Knowledge gap      -> Research + /learn
```
