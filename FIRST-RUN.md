# First Run

Verify the install, then prove the team works on something that cannot break.

---

## Part 1 — Three checks before any mission

If any of these fails, the mission will misbehave in ways that look like the agents being bad rather than the install being incomplete.

### Check 1 — Are the hooks live?

From your project root, in WSL2 or Git Bash (PowerShell cannot do this):

```bash
bash bootstrap.sh
```

It must print **`ENFORCEMENT LAYER LIVE`**. If it doesn't, it tells you exactly what failed.

Manual equivalent, if you prefer:

```bash
chmod +x .claude/hooks/*.sh
echo '{"command":"python3 tools/_template.py"}' | ./.claude/hooks/tool-cost-guard.sh; echo "exit=$?"
```

Want `-rwxr-xr-x` on all three files and `exit=0`.

**Why this matters:** without executable hooks, all three quality gates — including the one blocking paid API re-runs — silently never fire. The setup looks installed and isn't.

### Check 2 — Did you restart Claude Code?

Settings load **only at startup**. If Claude Code was open during the install, close it completely and reopen it in the project.

### Check 3 — Is `CLAUDE.md` filled in?

Open it. Look for a `## Domain` section describing your system in business terms.

If it only has stack and commands, **stop and write it now.** Ten minutes here determines whether the mission produces something useful or something generic. Teammates start with an empty context window — this file is everything they know.

---

## Part 2 — Configure

```
/config
```

Set **Default teammate model → Sonnet**. The lead stays Opus. Teammates are where cost multiplies.

---

## Part 3 — Smoke test (30 seconds)

```
Spawn a teammate named scout to list the top-level files in this repo and report what stack it detects.
```

**Success:** a `scout` row appears in a panel below your prompt box.

- `↑` / `↓` — select a teammate
- `Enter` — open its transcript; type to send it instructions
- `Esc` — back to the lead
- `Ctrl+T` — toggle the shared task list
- `x` — stop the selected teammate

**No row?** The env var didn't load. Check `.claude/settings.json` contains `"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"` under `env`, and that the file is valid JSON.

---

## Part 4 — Semantic code search

```
/sync-gbrain
```

Every teammate starts blank and greps around to orient. Four doing that at once is exactly what this pays for.

On client repos, set the trust tier to **read-only** so one client's patterns never write into another's shared brain.

---

## Part 5 — First real mission

**Pick a module you already understand well.** That's the point — you need to be able to judge whether the output is any good.

Three teammates, not four. `/codex` needs the Codex CLI installed, and a missing dependency on your first run would look like a failure.

```
Create an agent team to review the current implementation of [MODULE] in this repo.

Spawn three teammates, all read-only:
- security-cso, named "sec" — run /cso on that module
- performance-engineer, named "perf" — static analysis only, no browser
- staff-code-reviewer, named "staff" — run /review, report findings, do NOT apply fixes

Have sec and perf message each other about anything that is both a security
and a performance concern.

Rank all findings into one list by severity. Fix nothing.
```

None of these three has a `Write` or `Edit` tool. They physically cannot modify your repo. Worst case is a wasted run.

---

## What success looks like

**~30 seconds in:** three rows in the agent panel, each showing "working."

**During:** open any transcript and watch it read files. You may see a message pass between `sec` and `perf`.

**At the end:** the lead returns one ranked list — each finding with a file, a line, and a concrete fix.

**The real test:** do the findings tell you something true about your codebase that you didn't already know?

- **Yes** → the setup works. Move to Mission 1 in `docs/MISSIONS.md`.
- **Generic** ("consider adding input validation") → your `CLAUDE.md` domain section is too thin. That's the fix, not the agents.

---

## Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| No teammate rows | Feature flag not loaded | Check `settings.json`, restart Claude Code |
| "That skill doesn't exist" | gstack not installed | `ls ~/.claude/skills/` — reinstall gstack |
| Lead starts reviewing itself | Known stall | Type: *"Wait for your teammates to complete their tasks before proceeding."* |
| A teammate sits idle | Stopped on an error | Select it, `Enter`, read the transcript, give it an instruction |
| Findings vague and generic | Thin `CLAUDE.md` | Add domain meaning, not just schema |
| Task blocked forever | Task status lag | Check the task list (`Ctrl+T`) and nudge the owner |
| Phantom bugs in QA | Two agents on the browser daemon | One browser owner per mission, always |

---

## Then what

Once the review mission feels routine:

1. **Mission 1** — four-lens plan review. Still read-only. Produces the file-ownership map everything downstream needs.
2. **Mission 3** — competing-hypothesis debug, next time a bug is genuinely unclear.
3. **Mission 4** — cross-layer build. The first mission where teammates write concurrently. Verify the ownership map before running it.
4. **Mission 6.5** — codify. After every mission, ask what an agent reasoned through that should have been a script.

Full list in `docs/MISSIONS.md`. Full per-agent detail in `docs/AGENT-HANDBOOK.md`.

---

**Do not start at Mission 4.** Parallel implementation is where file conflicts and coordination failures appear. Get the ownership-map habit first, on missions that can't damage anything.
