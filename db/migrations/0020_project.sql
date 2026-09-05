-- db/migrations/0020_project.sql
-- A project is tied to a CRM contact (the client it's being done for) —
-- reusing the existing contact table per this project's "contact is one
-- record, not duplicated per module" principle (design spec §8), the
-- same way deal already links to contact in Phase 2A.
CREATE TABLE project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contact_id uuid NOT NULL REFERENCES contact(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_tenant_id_idx ON project (tenant_id, id);
CREATE INDEX project_tenant_contact_idx ON project (tenant_id, contact_id);

ALTER TABLE project ENABLE ROW LEVEL SECURITY;
ALTER TABLE project FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON project
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON project TO app_runtime;
