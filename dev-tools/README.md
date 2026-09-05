# dev-tools/

Offline, developer-only tooling. **Nothing here is ever bundled, deployed, or
shipped to a client.** This directory is outside `app/` and every path
Next.js scans for routes or components — it is structurally invisible to the
build, not just hidden by convention.

## `client-config.html` — the client codebase generator/updater

**Rewritten 2026-09-05** to match the corrected design in
`docs/superpowers/specs/2026-09-03-per-client-deployment-and-ai-automation-plan.md`
§0.1/§3.5 — this is a **generator and updater**, not a config-file writer.
It assembles a real, complete, standalone codebase per client by selectively
copying already-written source files from this repo, per a fixed feature
catalog. It does not invent code, template anything, or LLM-generate
per-client implementations — it copies files that already exist in the
shared repo.

A single self-contained HTML file. No build step, no server, no framework.
Open it directly in Chrome or Edge (`file://` or double-click) — it uses the
[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
to read/write folders on your local disk directly, with zero network
requests.

**Two folder grants, in order:**
1. **This repo's root** (read-only) — the tool reads
   `dev-tools/feature-manifest.json` (the single source of truth for which
   files/migrations belong to which catalog feature) and copies source files
   from here.
2. **An output folder** (read-write) — either empty (Phase 1: generate a new
   client) or an existing generated client's folder (Phase 2: update it —
   detected automatically by the presence of `_client-manifest.json`).

**Phase 1 (new client):** pick features from the fixed catalog (dependencies
auto-selected — e.g. selecting "Production" pulls in "Inventory" since
`erp.production` depends on `erp.inventory`), click Generate. The tool copies
every file the selection needs (plus the always-included core
infrastructure) into the output folder, and writes `_client-manifest.json`
(recording the selection) and `clients/<slug>/manifest.json` (the shape
`tools/provision-client.ts` reads).

**Phase 2 (update existing client):** point the tool at the client's
existing output folder. It reads `_client-manifest.json` to know the current
selection, pre-checks the catalog to match, and — on any toggle — copies in
newly-selected features' files or removes newly-deselected ones. Bounded to
the fixed catalog only; this is explicitly not open-ended code editing (per
the plan's §0.1 item 9).

**`dev-tools/feature-manifest.json`** is the manifest both this tool and
`tools/provision-client.ts` read — one source of truth, so the two tools
never drift out of sync. Each catalog feature declares its own `files`,
`migrations`, and `dependsOn` explicitly (hand-written per feature, not
inferred from folder structure — per the user's 2026-09-05 decision, since
migration ordering has real dependencies that don't align one-to-one with
directory conventions). Add a new feature's own entry here when it ships.

**Known open gap (plan §3.5.1 #2, not solved by this rewrite):** the tool
trusts `_client-manifest.json` as the source of truth for a client's current
state. If someone hand-edits a generated client's codebase directly, this
tool has no way to detect that drift before an update pass. A future
revision could add a checksum/provenance marker per generated file.

**Browser support:** Chrome/Edge only — the File System Access API isn't
implemented in Firefox or Safari. Acceptable since this is a developer-only
tool.

Pattern verified against the user's own reference implementation,
`dev.html` (a sibling project), independently re-read line-by-line
2026-09-05 — not just summarized from an earlier pass.
