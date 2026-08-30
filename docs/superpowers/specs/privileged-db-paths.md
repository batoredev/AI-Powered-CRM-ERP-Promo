# Privileged Database Access Paths

Per design spec §3's round-4 RLS-bypass fix: every code or operational
path that connects to Postgres as something other than `app_runtime`
(i.e., anything that could see across tenants) must be listed here, with
its own justification and its own tenant-filtering discipline, since RLS
does not protect these paths by construction.

**Rule: any new privileged path requires updating this file in the same
PR, and requires `security-cso` review before merge.**

## Current privileged paths

| Path | Role used | Why it's privileged | Tenant-filtering discipline |
|---|---|---|---|
| Migrations (`db/migrations/*.sql`) | Neon owner/superuser role | Schema changes (CREATE TABLE, ALTER) require DDL privileges `app_runtime` doesn't have | N/A — migrations don't query tenant data, only define schema. `database-data-engineer` is sole owner (per `docs/ROUTER.md`). |
| Local dev connectivity checks (Task 2, Task 4 setup) | Neon owner role (`DATABASE_URL`) | Initial data setup before RLS policies are meaningful to test | Test-only, never used in application runtime code paths |
| `db/migrations/__tests__/rls-policy-audit.test.ts` (Task 8) | Neon owner role (`DATABASE_URL`) | Needs to read `pg_class`/`pg_policies`/`pg_roles` catalogs, which `app_runtime` isn't granted access to | Test-only CI gate, read-only catalog queries, never touches tenant data |

## As of Phase 1, no other privileged paths exist

Later phases (agent runtime, plugin typed-API bridge, admin tooling) may
introduce new ones — spec §6.1's round-5 fix specifically calls out the
agent runtime → typed-API → plugin path as needing tenant-context
propagation verification, not a bypass. When a later phase adds a
privileged path, add a row here in the same PR that introduces it.
