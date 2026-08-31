CREATE TABLE contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  full_name text NOT NULL,
  email text,
  phone text,
  company text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contact_tenant_id_idx ON contact (tenant_id, id);
CREATE INDEX contact_tenant_email_idx ON contact (tenant_id, email) WHERE email IS NOT NULL;

ALTER TABLE contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contact
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON contact TO app_runtime;
