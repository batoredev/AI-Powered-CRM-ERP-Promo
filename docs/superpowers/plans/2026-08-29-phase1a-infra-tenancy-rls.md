# Phase 1A: Infrastructure + Tenant/RLS Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js/Cloudflare project skeleton, provision Postgres with Hyperdrive, and implement the multi-tenant RLS foundation with the non-privileged application role and `SET LOCAL` tenant-context mechanism — the highest-severity fix identified across 5 rounds of design review.

**Architecture:** A Next.js (App Router) app deployed to Cloudflare Pages/Workers, backed by a Postgres database (Neon, chosen per Task 1 below) fronted by Cloudflare Hyperdrive. All application database access goes through one dedicated, non-superuser Postgres role (`app_runtime`) that has zero `BYPASSRLS` privilege. Every request sets `tenant_id` via `SET LOCAL` inside its own transaction — never at the connection level — so Row-Level Security, forced on every tenant-scoped table, cannot be silently bypassed by a pooled-connection variable leak. This plan does not implement any product feature (CRM, ERP, inbox, agent) — it produces the tenancy substrate every later phase is built on.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Cloudflare Pages + Workers, Postgres via Neon, Cloudflare Hyperdrive, `postgres` (porsager/postgres) npm client, Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-08-29-ai-crm-erp-platform-design.md` (see §2 Tech Stack, §3 Multi-Tenancy Model — especially the RLS enforcement mechanics fix, which this plan implements directly). Companion: `docs/superpowers/specs/2026-08-29-execution-team-structure.md` (Phase 1 task table).

## Global Constraints

- **No `BYPASSRLS` anywhere.** The application role (`app_runtime`) created in Task 3 must never be granted `BYPASSRLS` or superuser. This is non-negotiable per spec §3's round-4 fix — verified by Task 8's CI test, which must fail the build if violated.
- **`tenant_id` is always set via `SET LOCAL`, inside the request's own transaction — never `SET` at connection or session level.** This is the exact mechanism that prevents PgBouncer transaction-mode session-variable bleed (spec §3).
- **Every tenant-scoped table gets `ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`** — no table is added without both, verified by Task 8.
- **TypeScript strict mode** on the whole project (`tsconfig.json` `"strict": true`) — set in Task 1, never relaxed later.
- **No secrets in code or `.env` committed to git** — the project's `.gitignore` and `settings.json` deny rules (already installed) enforce this; this plan does not touch that configuration.
- **Every task ends with passing tests before moving to the next task.**

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `wrangler.toml`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `.gitignore` (extend existing root `.gitignore` — do not overwrite; append Next.js-specific entries)

**Interfaces:**
- Produces: a running Next.js dev server (`npm run dev`) and a Cloudflare Workers-compatible build (`npm run build` via `@opennextjs/cloudflare`), both verifiable locally before any later task depends on them.

**Amendment (execution ruling, fix round 1, Task 1):** the plan originally
specified `@cloudflare/next-on-pages`. During execution, this package's
own compiled code (`spawn('npx', ...)` internally) was found to fail with
`ENOENT` on Windows/Git Bash — a genuine, non-workaroundable platform
incompatibility, not an implementer error. Verified via web research that
`@cloudflare/next-on-pages` is officially deprecated; Cloudflare's own
recommended replacement is `@opennextjs/cloudflare`, which also runs the
full Node.js runtime (not Edge-only) — a better fit for this project's
later use of the Anthropic SDK, KMS, and WASM sandboxing. Steps 3, 5, and
7 below are updated accordingly.

- [ ] **Step 1: Initialize the Next.js project**

Run:
```bash
npx create-next-app@latest . --typescript --app --no-tailwind --no-eslint --src-dir=false --import-alias "@/*" --use-npm
```
When prompted about the non-empty directory (it contains `.claude/`, `docs/`, etc.), confirm proceeding — those are unrelated to the Next.js scaffold.

- [ ] **Step 2: Verify TypeScript strict mode is on**

Open `tsconfig.json` and confirm `"strict": true` is present under `compilerOptions`. `create-next-app` sets this by default with the `--typescript` flag — if absent, add it.

- [ ] **Step 3: Install Cloudflare adapter and Wrangler**

Run:
```bash
npm install --save-dev @opennextjs/cloudflare wrangler
```

- [ ] **Step 4: Create `wrangler.toml`**

```toml
name = "ai-crm-erp"
compatibility_date = "2026-08-29"
compatibility_flags = ["nodejs_compat"]

[vars]
ENVIRONMENT = "development"
```

- [ ] **Step 5: Add build scripts to `package.json`**

Add to the `"scripts"` section:
```json
"pages:build": "opennextjs-cloudflare build",
"pages:dev": "opennextjs-cloudflare preview"
```

Also create the required OpenNext config file, `open-next.config.ts`, at the repo root:
```typescript
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig();
```

- [ ] **Step 6: Verify the dev server runs**

Run: `npm run dev`
Expected: server starts on `http://localhost:3000` with no errors. Stop the server (Ctrl+C) once confirmed.

- [ ] **Step 7: Verify the Cloudflare build succeeds**

Run: `npm run pages:build`
Expected: build completes with no errors, producing a Cloudflare Workers-compatible output directory (`.open-next/` by default) — confirm this is genuinely Cloudflare-adapted output, not a generic build, by checking for the Workers-specific entrypoint the tool generates (e.g. `.open-next/worker.js` or equivalent — check the actual output structure `@opennextjs/cloudflare` produces at the installed version, since exact paths can shift between versions).

- [ ] **Step 8: Extend `.gitignore`**

Append to the existing root `.gitignore` (already contains `.tmp/`, `.claude-backup-before-os/`, `.env`, `.env.*`, `credentials.json`, `token.json` from the earlier install):
```
node_modules/
.next/
.vercel/
.wrangler/
```

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json next.config.ts wrangler.toml app/ .gitignore package-lock.json
git commit -m "chore: scaffold Next.js + Cloudflare Pages project"
```

---

## Task 2: Neon Postgres Provisioning + Hyperdrive Connection

**Files:**
- Create: `docs/superpowers/plans/notes/2026-08-29-neon-setup.md` (records the provisioning steps taken, since this task involves external account setup, not just code)
- Create: `.env.example`
- Modify: `wrangler.toml` (add Hyperdrive binding)

**Interfaces:**
- Consumes: nothing from Task 1 except the existing `wrangler.toml`.
- Produces: a `DATABASE_URL` environment variable (documented in `.env.example`, actual value never committed) and a Hyperdrive binding named `HYPERDRIVE` in `wrangler.toml`, both of which Task 3 onward depend on for database connectivity.

- [ ] **Step 1: Provision the Neon project**

This step requires a human with account access — not automatable from this plan alone. Document in `docs/superpowers/plans/notes/2026-08-29-neon-setup.md`:
```markdown
# Neon Setup Notes

1. Create a Neon project at https://console.neon.tech (or via `neonctl` CLI
   if installed: `npx neonctl projects create --name ai-crm-erp`).
2. Note the connection string from the Neon dashboard (Connection Details
   panel) — format: `postgresql://<user>:<password>@<host>/<dbname>?sslmode=require`
3. This connection string is the `DATABASE_URL` — store it in `.env.local`
   (gitignored) for local dev, and as a Cloudflare Pages secret
   (`wrangler pages secret put DATABASE_URL`) for deployed environments.
   Never commit it.
```

- [ ] **Step 2: Create `.env.example`** (documents required vars without real values)

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

- [ ] **Step 3: Add the Hyperdrive binding to `wrangler.toml`**

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<hyperdrive-id-from-cloudflare-dashboard>"
```

Document in the same notes file: "Create the Hyperdrive config via `wrangler hyperdrive create ai-crm-erp-db --connection-string=\"$DATABASE_URL\"`, then copy the returned `id` into `wrangler.toml`."

- [ ] **Step 4: Verify local connectivity**

Run (with `DATABASE_URL` set in the shell environment, from `.env.local`):
```bash
npx --yes pg@latest -c "SELECT version();" "$DATABASE_URL"
```
Expected: prints a Postgres version string, confirming the connection string works. (If `pg` CLI isn't available, use `psql "$DATABASE_URL" -c "SELECT version();"` instead — either confirms connectivity.)

- [ ] **Step 5: Commit**

```bash
git add .env.example wrangler.toml docs/superpowers/plans/notes/2026-08-29-neon-setup.md
git commit -m "chore: provision Neon Postgres + Hyperdrive binding"
```

---

## Task 3: Non-Privileged Application Role (the RLS-bypass fix)

This is the task that implements spec §3's highest-severity round-4
finding: a single dedicated, non-superuser role used by every runtime
path, with `SET LOCAL` tenant-context per transaction.

**Files:**
- Create: `db/migrations/0001_create_app_role.sql`
- Create: `db/README.md`

**Interfaces:**
- Produces: a Postgres role `app_runtime` with `NOSUPERUSER NOBYPASSRLS`, and a `set_tenant_context(uuid)` SQL function that later tasks and later phases call at the start of every transaction.

- [ ] **Step 1: Write the migration SQL**

`db/migrations/0001_create_app_role.sql`:
```sql
-- Non-privileged application role. Every runtime code path (Next.js API
-- routes, the future agent runtime, the future plugin typed-API bridge)
-- connects as this role and ONLY this role. It must never be granted
-- BYPASSRLS or SUPERUSER — that is the exact bypass spec §3 identifies.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'app_runtime_password';
  END IF;
END
$$;

-- GRANT ... ON DATABASE requires a literal database-name identifier, not
-- a function-call expression — current_database() cannot be used
-- directly here. Resolve it dynamically instead (execution correction,
-- Task 3 fix round: verified this is a genuine Postgres grammar
-- limitation, not implementer error; the fix below preserves identical
-- resulting privileges — CONNECT on the current database, to
-- app_runtime, nothing more).
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO app_runtime;

-- Tenant context is set via SET LOCAL inside each transaction — never at
-- connection/session level — to avoid PgBouncer transaction-mode
-- session-variable bleed between pooled connections (spec §3, round-4 fix).
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true); -- true = transaction-local (SET LOCAL semantics)
END;
$$;

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;
```

Note: `:'app_runtime_password'` is a `psql` variable placeholder — Step 2 documents supplying it at migration-run time so the password is never hardcoded in the committed SQL file.

- [ ] **Step 2: Document how the migration is run with a real password**

`db/README.md`:
```markdown
# Database Migrations

Migrations live in `db/migrations/`, numbered sequentially, applied in
order. `database-data-engineer` is the sole owner of this directory
(per `docs/ROUTER.md`).

## Running migration 0001 (creates the app_runtime role)

This migration takes a password variable so the role's password is never
committed to git:

    psql "$DATABASE_URL" -v app_runtime_password="$(openssl rand -base64 32)" -f db/migrations/0001_create_app_role.sql

Store the generated password as a Cloudflare Pages secret
(`APP_RUNTIME_DB_PASSWORD`) — the application connects to Postgres using
this role's credentials, never the Neon-provisioned superuser/owner
credentials from Task 2.
```

- [ ] **Step 3: Run the migration against the dev database**

Run the command from `db/README.md` (Step 2) against the local dev `DATABASE_URL`.
Expected: completes with no errors.

- [ ] **Step 4: Verify the role has no bypass privileges**

Run:
```bash
psql "$DATABASE_URL" -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_runtime';"
```
Expected: one row, `rolsuper = f`, `rolbypassrls = f`.

- [ ] **Step 5: Verify `set_tenant_context` and `current_tenant_id` work correctly**

Run:
```bash
psql "$DATABASE_URL" -c "
BEGIN;
SELECT set_tenant_context('11111111-1111-1111-1111-111111111111');
SELECT current_tenant_id();
COMMIT;
SELECT current_tenant_id();
"
```
Expected: the `SELECT current_tenant_id()` inside the transaction returns `11111111-1111-1111-1111-111111111111`; the one after `COMMIT` returns `NULL` (proving it was transaction-local, not session-level — this is the actual verification that the bleed-prevention mechanism works).

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0001_create_app_role.sql db/README.md
git commit -m "feat: add non-privileged app_runtime role and transaction-local tenant context"
```

---

## Task 4: Tenant/User/Role Schema with Forced RLS

**Files:**
- Create: `db/migrations/0002_tenant_user_role.sql`
- Test: `db/migrations/__tests__/0002_tenant_user_role.test.ts`

**Interfaces:**
- Consumes: `app_runtime` role and `current_tenant_id()` function from Task 3.
- Produces: `tenant`, `app_user` tables (named `app_user` not `user` — `user` is a reserved-adjacent name in some Postgres tooling and the spec's `user` entity is represented here), each with `FORCE ROW LEVEL SECURITY` and a policy scoping to `current_tenant_id()`. Later phases' migrations (`contact`, `conversation`, etc.) follow this exact pattern.

- [ ] **Step 1: Write the schema migration**

`db/migrations/0002_tenant_user_role.sql`:
```sql
CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- tenant table itself has no RLS — it's the root of tenancy, not
-- tenant-scoped data. Every OTHER table in this project is tenant-scoped
-- and MUST have both lines below (this is what Task 8's CI test checks).
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
-- tenant rows are visible only via explicit application logic (signup,
-- admin), not via current_tenant_id() scoping — no tenant-scoping policy
-- is created here, deliberately, since a row's own id IS the tenant.

CREATE TYPE user_role AS ENUM ('owner', 'admin', 'agent');

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  email text NOT NULL,
  role user_role NOT NULL DEFAULT 'agent',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE INDEX app_user_tenant_id_idx ON app_user (tenant_id, id);

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON app_user
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant, app_user TO app_runtime;
```

- [ ] **Step 2: Run the migration**

Run: `psql "$DATABASE_URL" -f db/migrations/0002_tenant_user_role.sql`
Expected: completes with no errors.

- [ ] **Step 3: Write the failing isolation test**

`db/migrations/__tests__/0002_tenant_user_role.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

// Connects as app_runtime specifically — the whole point is verifying
// what THIS role can and cannot see, not the superuser/owner role.
const sql = postgres(process.env.APP_RUNTIME_DATABASE_URL!);

describe('tenant isolation on app_user', () => {
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    // Use the owner connection for setup (inserting tenants themselves
    // is out of scope for RLS, per the migration's design).
    const setupSql = postgres(process.env.DATABASE_URL!);
    const [tenantA] = await setupSql`INSERT INTO tenant (name) VALUES ('Tenant A') RETURNING id`;
    const [tenantB] = await setupSql`INSERT INTO tenant (name) VALUES ('Tenant B') RETURNING id`;
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    await setupSql`INSERT INTO app_user (tenant_id, email, role) VALUES (${tenantAId}, 'a@example.com', 'owner')`;
    await setupSql`INSERT INTO app_user (tenant_id, email, role) VALUES (${tenantBId}, 'b@example.com', 'owner')`;
    await setupSql.end();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('a transaction scoped to tenant A cannot see tenant B users', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantAId})`;
      return tx`SELECT * FROM app_user`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(tenantAId);
  });

  it('a transaction with no tenant context set sees zero rows', async () => {
    const rows = await sql.begin(async (tx) => {
      return tx`SELECT * FROM app_user`; // no set_tenant_context call
    });
    expect(rows).toHaveLength(0);
  });

  it('tenant context does not leak across transactions on the same pooled connection', async () => {
    await sql.begin(async (tx) => {
      await tx`SELECT set_tenant_context(${tenantAId})`;
    });
    const rows = await sql.begin(async (tx) => {
      return tx`SELECT * FROM app_user`; // fresh transaction, no context set
    });
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails (before `APP_RUNTIME_DATABASE_URL` env var exists)**

Run: `npx vitest run db/migrations/__tests__/0002_tenant_user_role.test.ts`
Expected: FAILs with a connection error (`APP_RUNTIME_DATABASE_URL` undefined) — confirms the test file is wired up and actually attempts to run.

- [ ] **Step 5: Set the app_runtime connection string**

Add to `.env.local` (gitignored): `APP_RUNTIME_DATABASE_URL=postgresql://app_runtime:<password-from-task-3>@<host>/<dbname>?sslmode=require` — same host/db as `DATABASE_URL`, different user/password.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run db/migrations/__tests__/0002_tenant_user_role.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/0002_tenant_user_role.sql db/migrations/__tests__/0002_tenant_user_role.test.ts .env.example
git commit -m "feat: add tenant/app_user schema with forced RLS, add isolation tests"
```

---

## Task 5: Database Connection Helper (transaction-scoped tenant context)

**Files:**
- Create: `lib/db/connection.ts`
- Create: `lib/db/with-tenant.ts`
- Test: `lib/db/__tests__/with-tenant.test.ts`

**Interfaces:**
- Consumes: `APP_RUNTIME_DATABASE_URL`, `set_tenant_context()` from Task 3/4.
- Produces: `withTenant<T>(tenantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>` — the one function every future API route, the future agent runtime, and the future plugin bridge use to run any tenant-scoped query. This is the enforcement point spec §6.1's round-5 fix (tenant-context propagation across the agent→typed-API boundary) will build on in a later phase — it must be the single chokepoint, not one of several ways to touch the database.

- [ ] **Step 1: Write the connection singleton**

`lib/db/connection.ts`:
```typescript
import postgres from 'postgres';

let sqlInstance: postgres.Sql | null = null;

/**
 * The single Postgres connection pool for the application. Always
 * connects as app_runtime (never a superuser/owner role) — enforced by
 * which connection string is configured in the environment, not by this
 * function, which is why db/README.md documents the required setup.
 */
export function getSql(): postgres.Sql {
  if (!sqlInstance) {
    const url = process.env.APP_RUNTIME_DATABASE_URL;
    if (!url) {
      throw new Error('APP_RUNTIME_DATABASE_URL is not set');
    }
    sqlInstance = postgres(url, { max: 10 });
  }
  return sqlInstance;
}
```

- [ ] **Step 2: Write the failing test for `withTenant`**

`lib/db/__tests__/with-tenant.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { withTenant } from '../with-tenant';

describe('withTenant', () => {
  it('scopes queries to the given tenant', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const result = await withTenant(tenantId, async (tx) => {
      return tx`SELECT current_tenant_id() as id`;
    });
    expect(result[0].id).toBe(tenantId);
  });

  it('does not leak tenant context to a call without withTenant', async () => {
    const { getSql } = await import('../connection');
    const sql = getSql();
    const rows = await sql`SELECT current_tenant_id() as id`;
    expect(rows[0].id).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/db/__tests__/with-tenant.test.ts`
Expected: FAILs — `with-tenant.ts` doesn't exist yet.

- [ ] **Step 4: Implement `withTenant`**

`lib/db/with-tenant.ts`:
```typescript
import type postgres from 'postgres';
import { getSql } from './connection';

/**
 * Runs `fn` inside a single Postgres transaction with tenant context set
 * via SET LOCAL (transaction-scoped, never connection-scoped — spec §3's
 * round-4 fix). This is the ONLY sanctioned way to run a tenant-scoped
 * query anywhere in this codebase — no other code path may call
 * getSql() directly for tenant data.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const sql = getSql();
  return sql.begin(async (tx) => {
    await tx`SELECT set_tenant_context(${tenantId}::uuid)`;
    return fn(tx);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/db/__tests__/with-tenant.test.ts`
Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/connection.ts lib/db/with-tenant.ts lib/db/__tests__/with-tenant.test.ts
git commit -m "feat: add withTenant transaction helper as the single tenant-scoped query entrypoint"
```

---

## Task 6: JWT Issuance with Tenant/Role Claims

**Files:**
- Create: `lib/auth/jwt.ts`
- Test: `lib/auth/__tests__/jwt.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure function module).
- Produces: `signSessionToken({ userId, tenantId, role }): Promise<string>` and `verifySessionToken(token: string): Promise<{ userId: string; tenantId: string; role: 'owner' | 'admin' | 'agent' }>` — used by a later API-route middleware (Phase 1B/1C or Phase 2, not built in this sub-plan) to determine which `tenantId` to pass into `withTenant`.

- [ ] **Step 1: Install the JWT library**

Run: `npm install jose`

- [ ] **Step 2: Write the failing test**

`lib/auth/__tests__/jwt.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { signSessionToken, verifySessionToken } from '../jwt';

describe('session JWT', () => {
  it('round-trips tenant id and role through sign/verify', async () => {
    const token = await signSessionToken({
      userId: 'user-1',
      tenantId: '11111111-1111-1111-1111-111111111111',
      role: 'owner',
    });
    const claims = await verifySessionToken(token);
    expect(claims.userId).toBe('user-1');
    expect(claims.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(claims.role).toBe('owner');
  });

  it('rejects a tampered token', async () => {
    const token = await signSessionToken({
      userId: 'user-1',
      tenantId: '11111111-1111-1111-1111-111111111111',
      role: 'owner',
    });
    const tampered = token.slice(0, -5) + 'XXXXX';
    await expect(verifySessionToken(tampered)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/auth/__tests__/jwt.test.ts`
Expected: FAILs — `jwt.ts` doesn't exist yet.

- [ ] **Step 4: Implement JWT signing/verification**

`lib/auth/jwt.ts`:
```typescript
import { SignJWT, jwtVerify } from 'jose';

const SESSION_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) {
    throw new Error('SESSION_JWT_SECRET is not set');
  }
  return new TextEncoder().encode(secret);
}

export interface SessionClaims {
  userId: string;
  tenantId: string;
  role: 'owner' | 'admin' | 'agent';
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TOKEN_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, getSecret());
  return {
    userId: payload.userId as string,
    tenantId: payload.tenantId as string,
    role: payload.role as SessionClaims['role'],
  };
}
```

- [ ] **Step 5: Add `SESSION_JWT_SECRET` to `.env.example`**

Append: `SESSION_JWT_SECRET=<32+ byte random string, generate with: openssl rand -base64 32>`

- [ ] **Step 6: Set a real value in `.env.local` for testing**

Run: `echo "SESSION_JWT_SECRET=$(openssl rand -base64 32)" >> .env.local`

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run lib/auth/__tests__/jwt.test.ts`
Expected: both tests PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/auth/jwt.ts lib/auth/__tests__/jwt.test.ts .env.example package.json package-lock.json
git commit -m "feat: add session JWT signing/verification with tenant and role claims"
```

---

## Task 7: Privileged-Path Enumeration Document

Per spec §3's round-4 fix: "every privileged path (migrations, admin
tooling) enumerated explicitly and required to do its own
application-level tenant filtering under mandatory review, since it is
by definition outside RLS's protection." This task creates that
enumeration as a living document — required before Task 8's CI test can
assert completeness.

**Files:**
- Create: `docs/superpowers/specs/privileged-db-paths.md`

**Interfaces:**
- Produces: a document later tasks and later phases must update whenever a new privileged (non-`app_runtime`) database access path is introduced.

- [ ] **Step 1: Write the enumeration document**

`docs/superpowers/specs/privileged-db-paths.md`:
```markdown
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

## As of Phase 1, no other privileged paths exist

Later phases (agent runtime, plugin typed-API bridge, admin tooling) may
introduce new ones — spec §6.1's round-5 fix specifically calls out the
agent runtime → typed-API → plugin path as needing tenant-context
propagation verification, not a bypass. When a later phase adds a
privileged path, add a row here in the same PR that introduces it.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/privileged-db-paths.md
git commit -m "docs: enumerate privileged database access paths per spec §3"
```

---

## Task 8: CI Cross-Tenant Isolation Test Suite

This is the automated enforcement Task 4's manual tests demonstrated —
turned into a standing CI gate so a future table added without correct
RLS fails the build, per spec §3's explicit requirement.

**Files:**
- Create: `db/migrations/__tests__/rls-policy-audit.test.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `APP_RUNTIME_DATABASE_URL`, `DATABASE_URL` (both from earlier tasks' env setup).
- Produces: a CI job that runs on every push/PR and fails if any table lacks `FORCE ROW LEVEL SECURITY` (except `tenant` itself, which is the documented exception from Task 4).

- [ ] **Step 1: Write the RLS policy audit test**

`db/migrations/__tests__/rls-policy-audit.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!); // owner connection — needs to read pg_class/pg_policy catalogs

// The one documented exception (Task 4): tenant is the root of tenancy,
// not tenant-scoped data, so it has no tenant-scoping policy.
const EXEMPT_TABLES = ['tenant'];

describe('RLS policy audit (CI gate)', () => {
  afterAll(async () => {
    await sql.end();
  });

  it('every non-exempt public table has FORCE ROW LEVEL SECURITY enabled', async () => {
    const rows = await sql`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `;
    const violations = rows.filter(
      (r) => !EXEMPT_TABLES.includes(r.relname) && (!r.relrowsecurity || !r.relforcerowsecurity),
    );
    expect(
      violations,
      `Tables missing FORCE ROW LEVEL SECURITY: ${violations.map((v) => v.relname).join(', ')}`,
    ).toHaveLength(0);
  });

  it('every non-exempt tenant-scoped table has a tenant_isolation policy', async () => {
    const rows = await sql`
      SELECT c.relname, EXISTS (
        SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation'
      ) as has_policy
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `;
    const violations = rows.filter((r) => !EXEMPT_TABLES.includes(r.relname) && !r.has_policy);
    expect(
      violations,
      `Tables missing a tenant_isolation policy: ${violations.map((v) => v.relname).join(', ')}`,
    ).toHaveLength(0);
  });

  it('app_runtime role has no BYPASSRLS or SUPERUSER privilege', async () => {
    const [role] = await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_runtime'`;
    expect(role.rolsuper, 'app_runtime must not be SUPERUSER').toBe(false);
    expect(role.rolbypassrls, 'app_runtime must not have BYPASSRLS').toBe(false);
  });
});
```

- [ ] **Step 2: Run the test locally to verify it passes against the current schema**

Run: `npx vitest run db/migrations/__tests__/rls-policy-audit.test.ts`
Expected: all 3 tests PASS (Task 4's `app_user` table and Task 3's role setup already satisfy these checks).

- [ ] **Step 3: Verify the test actually catches a violation**

Temporarily run against the dev database:
```bash
psql "$DATABASE_URL" -c "ALTER TABLE app_user NO FORCE ROW LEVEL SECURITY;"
npx vitest run db/migrations/__tests__/rls-policy-audit.test.ts
```
Expected: the first test FAILs, naming `app_user` in the violation list — confirms the test has real teeth, not just a passing assertion.

Then revert: `psql "$DATABASE_URL" -c "ALTER TABLE app_user FORCE ROW LEVEL SECURITY;"`
Run the test again to confirm it passes: `npx vitest run db/migrations/__tests__/rls-policy-audit.test.ts` — expected: PASS.

- [ ] **Step 4: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run build
      - run: npx vitest run
        env:
          DATABASE_URL: ${{ secrets.CI_DATABASE_URL }}
          APP_RUNTIME_DATABASE_URL: ${{ secrets.CI_APP_RUNTIME_DATABASE_URL }}
          SESSION_JWT_SECRET: ${{ secrets.CI_SESSION_JWT_SECRET }}
```

Document in `docs/superpowers/plans/notes/2026-08-29-neon-setup.md` (append): "CI requires its own Neon branch/database with migrations 0001-0002 (and later) applied, and its connection strings + a test JWT secret added as GitHub Actions repository secrets: `CI_DATABASE_URL`, `CI_APP_RUNTIME_DATABASE_URL`, `CI_SESSION_JWT_SECRET`. This is an account-setup step for whoever has repo admin access, not automatable from this plan."

- [ ] **Step 5: Commit**

```bash
git add db/migrations/__tests__/rls-policy-audit.test.ts .github/workflows/ci.yml docs/superpowers/plans/notes/2026-08-29-neon-setup.md
git commit -m "test: add CI-enforced RLS policy audit gate per spec §3"
```

---

## Self-Review Notes (per writing-plans skill requirement)

**Spec coverage check** against `2026-08-29-ai-crm-erp-platform-design.md`
§2/§3 (this sub-plan's scope):
- Next.js/Cloudflare Pages+Workers setup → Task 1 ✓
- Postgres provisioning + Hyperdrive → Task 2 ✓
- Non-privileged `app_runtime` role, no `BYPASSRLS` → Task 3 ✓
- `SET LOCAL` transaction-scoped tenant context (not session-level) → Task 3 (function), Task 4 (verification test) ✓
- Connection-pool bleed prevention → Task 4 Step 5's third test explicitly verifies this ✓
- `FORCE ROW LEVEL SECURITY` on every tenant-scoped table → Task 4 (app_user), Task 8 (CI enforcement for all future tables) ✓
- JWT with tenant/role claims → Task 6 ✓
- Enumerated privileged paths with mandatory review → Task 7 ✓
- CI cross-tenant isolation tests, fails build on missing policy → Task 8 ✓

**Out of scope for this sub-plan** (belongs to Phase 1B/1C per the
3-way split, or to Phase 1's other tasks not yet planned): Cloudflare
Queues/Durable Objects/R2 setup, WASM runtime, KMS/credential vault,
plugin runtime skeleton, rate limiting, backup/DR automation. Each of
these needs its own plan following this same process — do not treat
Phase 1 as complete once this sub-plan ships.

**Type consistency check:** `withTenant`'s `tenantId: string` param
(Task 5) matches `SessionClaims.tenantId: string` (Task 6) and the
`uuid` column type used throughout the SQL (Tasks 3-4) — string at the
TypeScript boundary, uuid at the Postgres boundary, consistent
end-to-end.

**Placeholder scan:** no TBD/TODO/"handle appropriately" found — every
step has concrete code or an exact command.
