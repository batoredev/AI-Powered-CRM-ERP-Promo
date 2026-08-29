# Company Claude OS v2

A 31-agent Claude Code **agent teams** setup for a software solutions company. Roles, rules, quality-gate hooks, mission templates, and a deterministic tools layer.

---

## Start here

**Everything begins with one line.** Open your project in Claude Code and paste:

```
Read INSTALL.md at <path-to-this-folder> and execute it fully. Don't ask me to confirm steps.
```

Then, from your project root in WSL2 or Git Bash:

```
bash bootstrap.sh
```

That makes the quality-gate hooks executable and verifies they actually fire — the one step
Claude Code often cannot complete on Windows. It must print `ENFORCEMENT LAYER LIVE`.

Then read `FIRST-RUN.md` — three verification checks and a first mission that cannot damage your repo.

That's the whole path. The rest of this file explains what you just installed.

---

## What's in here

| File | What it's for | When you read it |
|---|---|---|
| **`INSTALL.md`** | Autonomous install runbook. Claude Code executes this. | You don't — you point Claude Code at it |
| **`bootstrap.sh`** | Fixes hook permissions, verifies the gates fire | Right after installing |
| **`FIRST-RUN.md`** | 3 verification checks, smoke test, and a safe first mission | Immediately after installing |
| **`docs/agent-teams-operating-guide.pdf`** | The full printable guide, A–Z | Read once, keep nearby |
| **`docs/ROUTER.md`** | Job phrasing → which agents to spawn, plus the skill ownership index | The lead reads it every mission |
| `docs/MISSIONS.md` | 11 ready-to-paste team compositions | Every time you start a mission |
| `docs/AGENT-HANDBOOK.md` | All 21 agents — job, workflow, skills, blocking chains | Reference |
| `docs/SKILL-COVERAGE.md` | Every gstack skill mapped to an owner | Reference |
| `docs/WAT-AUDIT.md` | Why the `tools/` layer exists and what it fixes | Worth reading once |
| `MERGE-NOTES.md` | What changed from company-claude-os v1 and why | If you used v1 |
| `SETUP.md` | Manual install, if you'd rather drive it yourself | Fallback only |
| `CLAUDE.md` | Governance doctrine, copied into your project | Installed, then you extend it |
| `.claude/agents/` | The 21 role definitions | Installed |
| `.claude/rules/` | 8 inherited constraint files | Installed |
| `.claude/hooks/` | 3 quality gates enforced by exit code | Installed |
| `tools/`, `workflows/` | The deterministic execution layer, with templates | You fill these over time |

---

## The design in five sentences

**31 agents, in five phases.** Shape (01–06, no code), Build (07–11, each frozen to its own file glob), Attack (12–17, read-only by enforced tool allowlist), Ship & Learn (18–21).

**You spawn 3–5 per mission, never all 31.** The roster is deep so the right specialist exists; teams stay small so coordination doesn't eat the gain. `docs/ROUTER.md` maps request phrasing to agents, and when nothing covers a request, `research-analyst` investigates from primary sources rather than anyone guessing. Token cost scales linearly per teammate and coordination overhead grows faster than that.

**Three constraints prevent lost work:** one browser owner per mission, auto-committing skills only in the lead after teammates shut down, and every implementer runs `/freeze <glob>` first.

**Reviewers physically cannot write.** The `tools:` allowlist is the only per-teammate restriction the platform enforces, which is what makes parallel review safe.

**The `tools/` layer is what makes it improve.** Reasoning is probabilistic; scripts are not. Mission 6.5 asks after every run what should have been a script.

---

## What you must supply

The system cannot supply these, and every failure mode traces back to one of them missing.

**Once per project**
- **Domain knowledge** in `CLAUDE.md` — what your entities actually mean, not just the schema. Teammates start with an empty context window and none of your conversation history.
- **Design decisions** via `/design-consultation` — real values, not preferences. Without them, UI output drifts to the statistical mean.

**Every feature**
- **The problem, not your solution** — let the strategist find a better answer than the one you pre-committed to.
- **The commercial frame** — say `HOLD SCOPE` on fixed-price client work, or watch your margin go.
- **Two checks on the ownership map** — does every path exist, is any listed twice.
- **Sequencing** — who publishes what to whom before the next agent starts.

---

## Requirements

- Claude Code, recent version (agent teams is experimental and off by default)
- gstack — `INSTALL.md` installs it if absent
- A bash shell for the hooks (WSL2 or Git Bash on Windows)
- A git repo with at least one commit before agents touch it

---

## Honest limits

Agent teams is experimental: teammates can't be resumed, one team per session, no nested teams, the lead is fixed, task status can lag, and once enabled a subagent Claude names on its own launches as a teammate.

gstack ships changes frequently — skill names referenced here were read in August 2026. `/gstack-upgrade` keeps the skills current; this pack's references to them are a snapshot.

React Native projects: the browse daemon can't reach the app, so agent 12 and every browser skill are inapplicable. `INSTALL.md` detects this and writes a note into `CLAUDE.md`.

**And the honest one:** this pack has been built from documentation and architecture, not from production use. The first real mission will surface things it doesn't predict. That's expected — Mission 6.5 and `/learn` exist to fold those corrections back in.

---

## Off switch

Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` to `"0"` in `.claude/settings.json`. No reinstall needed.
