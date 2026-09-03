-- db/migrations/0016_work_center.sql
-- A place/resource where a production operation happens (a machine, a
-- workstation, an assembly line). Deliberately minimal for this phase —
-- capacity/scheduling fields are a later extension per research §3.2
-- ("work centers and capacity... a shop doing simple assembly may not
-- need it" — so this table starts with just identity, not capacity).
CREATE TABLE work_center (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX work_center_tenant_id_idx ON work_center (tenant_id, id);

ALTER TABLE work_center ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_center FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON work_center
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON work_center TO app_runtime;
