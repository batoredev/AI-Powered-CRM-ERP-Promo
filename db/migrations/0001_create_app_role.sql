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

-- GRANT ... ON DATABASE requires a literal database-name identifier;
-- current_database() cannot be used directly there, so this is done
-- dynamically to stay portable across environments (dev/staging/prod
-- Neon databases may have different names).
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
