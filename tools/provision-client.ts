#!/usr/bin/env node
/**
 * Provisions a client's application setup against a Supabase Postgres
 * database THEY created and own.
 *
 * REWRITTEN 2026-09-05 per the deployment plan's §0.1 correction and §3.1's
 * narrowed scope (docs/superpowers/specs/2026-09-03-per-client-deployment-
 * and-ai-automation-plan.md). This script is now one step in the dev-page
 * tool's generation/update flow (dev-tools/client-config.html), not the
 * standalone full provisioning pipeline the earlier version assumed —
 * see the doc's §3.1/§3.1.1 for what changed and why.
 *
 * COST: none directly (no paid API calls) — but every successful run
 * mutates a real client-owned database (creates a role, runs migrations,
 * inserts a tenant row). Confirm the target connection string is correct
 * before running; there is no "undo" step in this script.
 *
 * Ownership model (§2.1, revised 2026-09-05): the client creates and owns
 * their own Supabase project — their account, their billing. They hand us
 * a connection string. This script does NOT create a database or a
 * Supabase project; it only connects to one that already exists and sets
 * it up.
 *
 * What this script does, in order:
 *   1. Connects to the client-supplied admin/owner connection string
 *      (must have privileges to CREATE ROLE, CREATE TABLE, CREATE POLICY,
 *      GRANT — the client's Supabase project owner/service-role
 *      connection, NOT the eventual app_runtime role).
 *   2. Reads the client's feature-selection manifest (--manifest,
 *      required — the exact `clients/<slug>/manifest.json` shape written
 *      by dev-tools/client-config.html's generate/update flow: {client,
 *      slug, features: string[], migrations: string[]}). The `migrations`
 *      array is the ALREADY topologically-sorted, feature-scoped list the
 *      generator tool computed from dev-tools/feature-manifest.json — this
 *      script trusts that ordering rather than recomputing it, so the two
 *      tools share one source of truth (see that manifest file's own
 *      header comment).
 *   3. Runs db/migrations/0001_create_app_role.sql FIRST regardless of
 *      whether the manifest lists it (every client needs the app_runtime
 *      role — this is core infrastructure per feature-manifest.json's
 *      "core" section, always included), with a freshly generated
 *      app_runtime password substituted for the psql-style
 *      :'app_runtime_password' variable (see db/README.md — this script
 *      replicates that documented procedure without depending on the
 *      psql binary being installed).
 *   4. Runs every other migration file the manifest lists — ONLY those,
 *      not the full migration set — in the order the manifest specifies.
 *      This is the fix for the prior version's §3.5.1-flagged gap (it used
 *      to run all migrations unconditionally regardless of feature
 *      selection).
 *   5. Inserts one row into `tenant` for this client.
 *   6. Prints the generated app_runtime connection string and password to
 *      stdout ONCE, with a loud warning to store it as a deploy secret
 *      immediately — never into source control (per
 *      .claude/rules/security.md).
 *
 * What this script explicitly does NOT do (out of scope, per §3.1's
 * superseded items — the corrected model has each client on their own
 * infra, not a Worker on our shared account):
 *   - Create a Cloudflare Worker for the client (superseded — client hosts
 *     on their own infra now, per §2.1.1).
 *   - Attach a custom domain / verify SSL (superseded, same reason).
 *   - Record the client in a fleet registry — open question, see §3.5.1.
 *   - Write secrets to any deploy environment automatically — this script
 *     only prints them; a human copies them into place.
 *
 * Idempotency: safe to re-run against the same connection string.
 * CREATE ROLE / CREATE TABLE / CREATE POLICY are all guarded (IF NOT
 * EXISTS or equivalent, matching each migration file's own existing
 * pattern) except the tenant-row insert, which is skipped if a tenant
 * with the given name already exists in that database.
 *
 * Usage:
 *   npx tsx tools/provision-client.ts \
 *     --client-name "Acme Co" \
 *     --connection-string "postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres" \
 *     --manifest clients/acme-co/manifest.json \
 *     [--dry-run]
 *
 * --manifest is now REQUIRED (not optional) — there is no sensible default
 * feature selection to fall back to; the whole point of the corrected
 * model is that a client's database only gets the migrations their
 * selected features actually need.
 *
 * --dry-run: connects and validates (privilege check, manifest + migration
 * file discovery) but does not execute any DDL/DML. Use this to verify a
 * client-supplied connection string and manifest before committing to a
 * real run.
 */

import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface Args {
  clientName: string;
  connectionString: string;
  manifestPath: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : null;
  };
  const clientName = get('--client-name');
  const connectionString = get('--connection-string');
  const manifestPath = get('--manifest');
  if (!clientName) {
    throw new Error('Missing required --client-name "<name>"');
  }
  if (!connectionString) {
    throw new Error('Missing required --connection-string "<postgres-url>"');
  }
  if (!manifestPath) {
    throw new Error(
      'Missing required --manifest "<path>" — generate one with dev-tools/client-config.html first. ' +
        'There is no default feature selection: the whole point of the corrected model (deployment plan §0.1) ' +
        "is that a client's database only gets the migrations their selected features actually need.",
    );
  }
  return { clientName, connectionString, manifestPath, dryRun: argv.includes('--dry-run') };
}

interface ClientManifest {
  client: string;
  slug: string;
  features: string[];
  migrations: string[];
}

function loadClientManifest(manifestPath: string): ClientManifest {
  const raw = JSON.parse(readFileSync(resolve(manifestPath), 'utf-8'));
  if (
    typeof raw.client !== 'string' ||
    typeof raw.slug !== 'string' ||
    !Array.isArray(raw.features) ||
    !Array.isArray(raw.migrations)
  ) {
    throw new Error(
      `Manifest at ${manifestPath} does not match the shape written by dev-tools/client-config.html ` +
        '(expected { client: string, slug: string, features: string[], migrations: string[] })',
    );
  }
  return { client: raw.client, slug: raw.slug, features: raw.features, migrations: raw.migrations };
}

const CORE_ROLE_MIGRATION = '0001_create_app_role.sql';

function loadMigrationFiles(fileNames: string[]): { fileName: string; sql: string }[] {
  const migrationsDir = resolve(process.cwd(), 'db/migrations');
  // Always include the core role migration first, even if the caller's
  // manifest omitted it — every client needs app_runtime regardless of
  // feature selection (feature-manifest.json's "core" section is meant to
  // guarantee this, but this script doesn't trust that guarantee blindly).
  const ordered = fileNames.includes(CORE_ROLE_MIGRATION)
    ? fileNames
    : [CORE_ROLE_MIGRATION, ...fileNames];
  return ordered.map((fileName) => {
    const path = join(migrationsDir, fileName);
    let sql: string;
    try {
      sql = readFileSync(path, 'utf-8');
    } catch {
      throw new Error(`Manifest lists migration "${fileName}" but ${path} does not exist.`);
    }
    return { fileName, sql };
  });
}

function generateAppRuntimePassword(): string {
  // Matches db/README.md's documented `openssl rand -base64 32` — same
  // entropy, generated in Node instead of shelling out to openssl so
  // this script has no external binary dependency.
  return randomBytes(32).toString('base64');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientManifest = loadClientManifest(args.manifestPath);
  const migrations = loadMigrationFiles(clientManifest.migrations);

  console.log(`Provisioning client "${args.clientName}"`);
  console.log(`  Features selected: ${clientManifest.features.join(', ') || '(none)'}`);
  console.log(`  Migrations to apply: ${migrations.length} (${migrations.map((m) => m.fileName).join(', ')})`);
  console.log(`  Mode: ${args.dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);

  const sql = postgres(args.connectionString, { max: 1 });

  try {
    // Privilege check: confirm this connection can create roles/tables
    // before attempting anything destructive-adjacent.
    const [{ can_create_role }] = await sql<{ can_create_role: boolean }[]>`
      SELECT rolcreaterole AS can_create_role FROM pg_roles WHERE rolname = current_user
    `;
    if (!can_create_role) {
      throw new Error(
        `Connection string's role (current_user) cannot CREATE ROLE. ` +
          `This script needs the client's Supabase project owner/service-role connection, not app_runtime.`,
      );
    }
    console.log('  Privilege check: OK (current_user can CREATE ROLE)');

    if (args.dryRun) {
      console.log('Dry run complete — no migrations applied, no rows written.');
      return;
    }

    const appRuntimePassword = generateAppRuntimePassword();

    for (const migration of migrations) {
      let migrationSql = migration.sql;
      if (migration.fileName === CORE_ROLE_MIGRATION) {
        // Substitute the psql-style :'app_runtime_password' variable
        // with a literal, matching db/README.md's documented procedure
        // (`psql ... -v app_runtime_password=...`) without requiring
        // the psql binary.
        migrationSql = migrationSql.replaceAll(":'app_runtime_password'", `'${appRuntimePassword.replaceAll("'", "''")}'`);
      }
      await sql.unsafe(migrationSql);
      console.log(`  Applied: ${migration.fileName}`);
    }

    // Insert the tenant row — skipped if a tenant with this name already
    // exists, so re-running the script is safe.
    const existing = await sql<{ id: string }[]>`SELECT id FROM tenant WHERE name = ${args.clientName}`;
    let tenantId: string;
    if (existing.length > 0) {
      tenantId = existing[0].id;
      console.log(`  Tenant "${args.clientName}" already exists (id=${tenantId}) — skipping insert`);
    } else {
      const [{ id }] = await sql<{ id: string }[]>`
        INSERT INTO tenant (name) VALUES (${args.clientName}) RETURNING id
      `;
      tenantId = id;
      console.log(`  Created tenant "${args.clientName}" (id=${tenantId})`);
    }

    console.log('');
    console.log('=== app_runtime credentials — store as a deploy secret NOW, never in source control ===');
    console.log(`  Role:     app_runtime`);
    console.log(`  Password: ${appRuntimePassword}`);
    console.log(`  Build the app_runtime connection string using this password against the same host/database as the connection string you supplied.`);
    console.log('===');
    console.log('');
    console.log(`Provisioning complete for tenant "${args.clientName}" (id=${tenantId}).`);
    console.log('NOT done by this script (per the corrected deployment model, §2.1.1): Cloudflare Worker/hosting setup, domain attachment, and fleet registry recording — client hosts on their own infrastructure now, not a shared Worker.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Provisioning failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
