CREATE TABLE pipeline_stage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX pipeline_stage_tenant_id_idx ON pipeline_stage (tenant_id, sort_order);

ALTER TABLE pipeline_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stage FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON pipeline_stage
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline_stage TO app_runtime;
