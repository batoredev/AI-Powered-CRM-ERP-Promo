#!/usr/bin/env node
/**
 * Provisions a client's application setup against a Supabase Postgres
 * database THEY created and own.
 *
 * COST: none directly (no paid API calls) — but every successful run
 * mutates a real client-owned database (creates a role, runs 19
 * migrations, inserts a tenant + feature-manifest row). Confirm the
 * target connection string is correct before running; there is no
 * "undo" step in this script.
 *
 * Ownership model (per docs/superpowers/specs/2026-09-03-per-client-
 * deployment-and-ai-automation-plan.md §2.1, revised 2026-09-05):
 * the client creates and owns their own Supabase project — their
 * account, their billing. They hand us a connection string. This
 * script does NOT create a database or a Supabase project; it only
 * connects to one that already exists and sets it up.
 *
 * What this script does, in order:
 *   1. Connects to the client-supplied admin/owner connection string
 *      (must have privileges to CREATE ROLE, CREATE TABLE, CREATE POLICY,
 *      GRANT — the client's Supabase project owner/service-role
 *      connection, NOT the eventual app_runtime role).
 *   2. Runs db/migrations/0001_create_app_role.sql first, with a
 *      freshly generated app_runtime password substituted for the
 *      psql-style :'app_runtime_password' variable that migration
 *      uses (see db/README.md — this script replicates that documented
 *      procedure without depending on the psql binary being installed).
 *   3. Runs every other migration file (0002-NNNN) in numeric order,
 *      unchanged.
 *   4. Inserts one row into `tenant` for this client.
 *   5. Inserts the client's feature-manifest row into
 *      `tenant_erp_settings` (goods_handling + billing_modes), reading
 *      the ERP axes from the manifest.json a developer generated with
 *      dev-tools/client-config.html, if one is supplied via --manifest.
 *   6. Prints the generated app_runtime connection string and password
 *      to stdout ONCE, with a loud warning to store it as a deploy
 *      secret immediately — never into source control (per
 *      .claude/rules/security.md).
 *
 * What this script explicitly does NOT do yet (out of scope, see the
 * deployment plan §3.1's remaining steps — future work, not faked here):
 *   - Create a Cloudflare Worker for the client.
 *   - Attach a custom domain / verify SSL.
 *   - Record the client in a fleet registry (tools/fleet-status.ts,
 *     not yet built).
 *   - Write secrets to any deploy environment automatically — this
 *     script only prints them; a human copies them into place.
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
 *     [--manifest clients/acme-co/manifest.json] \
 *     [--dry-run]
 *
 * --dry-run: connects and validates (privilege check, migration-file
 * discovery) but does not execute any DDL/DML. Use this to verify a
 * client-supplied connection string before committing to a real run.
 */

import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface Args {
  clientName: string;
  connectionString: string;
  manifestPath: string | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : null;
  };
  const clientName = get('--client-name');
  const connectionString = get('--connection-string');
  if (!clientName) {
    throw new Error('Missing required --client-name "<name>"');
  }
  if (!connectionString) {
    throw new Error('Missing required --connection-string "<postgres-url>"');
  }
  return {
    clientName,
    connectionString,
    manifestPath: get('--manifest'),
    dryRun: argv.includes('--dry-run'),
  };
}

interface ManifestErpAxes {
  goodsHandling: 'off' | 'basic_stock' | 'production';
  billingModes: Array<'transactional' | 'effort_based' | 'recurring'>;
}

function loadManifest(manifestPath: string | null): ManifestErpAxes {
  if (!manifestPath) {
    // No manifest supplied — default to the most conservative setting
    // (everything off) rather than guessing what the client wants.
    return { goodsHandling: 'off', billingModes: [] };
  }
  const raw = JSON.parse(readFileSync(resolve(manifestPath), 'utf-8'));
  if (!raw.erp || typeof raw.erp.goodsHandling !== 'string' || !Array.isArray(raw.erp.billingModes)) {
    throw new Error(
      `Manifest at ${manifestPath} does not match the shape written by dev-tools/client-config.html ` +
        `(expected { erp: { goodsHandling: string, billingModes: string[] } })`,
    );
  }
  return { goodsHandling: raw.erp.goodsHandling, billingModes: raw.erp.billingModes };
}

function loadMigrationFiles(): { fileName: string; sql: string }[] {
  const migrationsDir = resolve(process.cwd(), 'db/migrations');
  const fileNames = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // numeric prefixes (0001_, 0002_, ...) sort correctly as strings
  if (fileNames.length === 0) {
    throw new Error(`No .sql migration files found in ${migrationsDir}`);
  }
  return fileNames.map((fileName) => ({
    fileName,
    sql: readFileSync(join(migrationsDir, fileName), 'utf-8'),
  }));
}

function generateAppRuntimePassword(): string {
  // Matches db/README.md's documented `openssl rand -base64 32` — same
  // entropy, generated in Node instead of shelling out to openssl so
  // this script has no external binary dependency.
  return randomBytes(32).toString('base64');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const migrations = loadMigrationFiles();
  const manifest = loadManifest(args.manifestPath);

  console.log(`Provisioning client "${args.clientName}"`);
  console.log(`  Migrations to apply: ${migrations.length} (${migrations[0].fileName} .. ${migrations[migrations.length - 1].fileName})`);
  console.log(`  ERP manifest: goods_handling=${manifest.goodsHandling}, billing_modes=${JSON.stringify(manifest.billingModes)}`);
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
      if (migration.fileName === '0001_create_app_role.sql') {
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

    // Upsert the feature-manifest row.
    await sql`
      INSERT INTO tenant_erp_settings (tenant_id, goods_handling, billing_modes)
      VALUES (${tenantId}, ${manifest.goodsHandling}, ${sql.array(manifest.billingModes)})
      ON CONFLICT (tenant_id) DO UPDATE
        SET goods_handling = EXCLUDED.goods_handling,
            billing_modes = EXCLUDED.billing_modes,
            updated_at = now()
    `;
    console.log('  Feature manifest written to tenant_erp_settings');

    console.log('');
    console.log('=== app_runtime credentials — store as a deploy secret NOW, never in source control ===');
    console.log(`  Role:     app_runtime`);
    console.log(`  Password: ${appRuntimePassword}`);
    console.log(`  Build the app_runtime connection string using this password against the same host/database as the connection string you supplied.`);
    console.log('===');
    console.log('');
    console.log(`Provisioning complete for tenant "${args.clientName}" (id=${tenantId}).`);
    console.log('NOT done by this script yet (see deployment plan §3.1): Cloudflare Worker creation, domain attachment, fleet registry recording.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Provisioning failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
