-- db/migrations/0012_location.sql
-- A place stock can live. Single-location tenants have exactly one row;
-- multi-location tenants have several — there is no separate schema for
-- "multi-location" (per design spec §4's module table), just more rows
-- in this same table. Stock quantity is always (product_id, location_id)
-- scoped, never global to a product — see stock_move in the next task.
CREATE TABLE location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX location_tenant_id_idx ON location (tenant_id, id);

ALTER TABLE location ENABLE ROW LEVEL SECURITY;
ALTER TABLE location FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON location
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON location TO app_runtime;
