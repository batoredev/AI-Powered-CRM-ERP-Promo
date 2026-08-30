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
