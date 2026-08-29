# Routing Rules — how the lead picks agents

The lead reads this before spawning anything. Wrong selection is a worse failure than a missing specialist, because the mission produces confident output from the wrong lens.

## 1. Match the job to the roster, not to habit

Read `docs/ROUTER.md`. It maps job phrasing to agents. If the request contains a signal word listed there, the mapped agent is the default — deviate only with a stated reason.

## 2. Three to five teammates. Always.

31 roles is a **roster**, not a team size. Each teammate is a full Claude instance with its own context window; cost and coordination overhead scale with headcount, and quality does not.

If more than five roles seem to apply, the mission is too broad. **Split it into sequential missions** rather than spawning eight agents.

## 3. Specialists over generalists when the signal is clear

If the work is animation, spawn `motion-engineer` rather than `frontend-lead`. If it is API shape, spawn `api-contract-engineer` rather than `backend-lead`. The specialist bodies carry domain knowledge the generalist does not.

But when the work spans a whole layer with no dominant specialty, the generalist is correct. Do not spawn three frontend specialists for one ordinary form.

## 4. Capability gap → research, never guess

**If no agent and no skill covers what the request needs, spawn `research-analyst` before implementing anything.**

Signals that you have hit a gap:
- An unfamiliar API, protocol, library, or vendor
- A framework version newer than an agent's knowledge
- A regulation, standard, or compliance requirement nobody has stated
- Any moment an agent would otherwise write "typically" or "usually" about something specific
- A teammate reports it cannot proceed without information nobody has

`research-analyst` produces a brief from primary sources, labelling what it verified versus inferred and stating plainly what it could not determine. **An honest "unknown" is a valid mission output.** Confident invention is not — a fabricated API signature costs more than a delay.

If research shows the plan is unworkable, stop and report. Do not proceed with a workaround nobody approved.

## 5. Read-only first

Missions 1, 2, and 3 use only read-only agents and cannot corrupt the repo. When the right composition is unclear, run a read-only mission first and let its output determine the build team.

## 6. Platform gates the roster

- **React Native / Expo** → `mobile-qa-engineer`, never `qa-browser-lead`. The browse daemon cannot reach the app.
- **Web** → `qa-browser-lead` for exploratory, `e2e-automation-engineer` for deterministic Playwright specs. Both may run in one mission; they use different browsers.
- **No UI** → skip `design-director`, `taste-director`, `design-engineer`, `motion-engineer`, `accessibility-engineer` entirely.

## 7. One browser-daemon owner, always

Only `qa-browser-lead` drives the gstack browse daemon. Playwright is separate and isolated per run — `e2e-automation-engineer` does not conflict with it.

## 8. State the selection

Before spawning, say which agents, why each, the file-ownership map, and the browser owner. If you cannot justify a teammate in one sentence, do not spawn it.
