-- db/migrations/0017_routing.sql
-- A routing defines an ordered list of operations. Per research §3.1: a
-- routing may be attached to MULTIPLE BoMs (the operations list is
-- reusable), while a BoM has AT MOST ONE routing (0..1) — the FK for
-- that relationship was added as a nullable column on bill_of_materials
-- in Task 1's migration (0015); this migration adds the REFERENCES
-- constraint now that the routing table exists.
CREATE TABLE routing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  routing_id uuid NOT NULL REFERENCES routing(id),
  work_center_id uuid NOT NULL REFERENCES work_center(id),
  sequence integer NOT NULL,
  name text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0)
);

ALTER TABLE bill_of_materials ADD CONSTRAINT bill_of_materials_routing_id_fkey
  FOREIGN KEY (routing_id) REFERENCES routing(id);

CREATE INDEX routing_tenant_id_idx ON routing (tenant_id, id);
CREATE INDEX operation_tenant_routing_idx ON operation (tenant_id, routing_id, sequence);

ALTER TABLE routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON routing
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON operation
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON routing, operation TO app_runtime;
