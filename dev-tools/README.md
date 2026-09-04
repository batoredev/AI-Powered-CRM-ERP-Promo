# dev-tools/

Offline, developer-only tooling. **Nothing here is ever bundled, deployed, or
shipped to a client.** This directory is outside `app/` and every path
Next.js scans for routes or components — it is structurally invisible to the
build, not just hidden by convention.

## `client-config.html`

A single self-contained HTML file. No build step, no server, no framework.
Open it directly in Chrome or Edge (`file://` or double-click) — it uses the
[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
to read/write a folder on your local disk directly, with zero network
requests.

**What it's for:** pick a client's ERP feature manifest (goods-handling mode
+ billing modes, matching `tenant_erp_settings` from migration `0006`) and it
generates `clients/<slug>/manifest.json` + `clients/<slug>/seed.sql` in the
folder you choose. Every change regenerates the files immediately. Only
those generated files — never this tool — are meant to be pushed to a
client's own repo or fed into `tools/provision-client.ts` once that's built.

**Scope note:** only the ERP axes (`goods_handling`, `billing_modes`) are
wired up — those are the only fields with real schema today. The broader
CRM/AI/channels manifest sketched in
`docs/superpowers/specs/2026-09-03-per-client-deployment-and-ai-automation-plan.md`
§2.3 has no schema yet, so this tool doesn't fabricate toggles for it. Extend
this tool once that schema exists, rather than guessing its shape now.

**Browser support:** Chrome/Edge only — the File System Access API isn't
implemented in Firefox or Safari. Acceptable since this is a developer-only
tool.

Pattern verified against the user's own reference implementation,
`dev.html` (a sibling project), independently re-read line-by-line
2026-09-05 — not just summarized from an earlier pass.
