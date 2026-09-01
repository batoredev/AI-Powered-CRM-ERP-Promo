-- db/migrations/0008_vendor.sql
-- Separate from `contact` (Phase 2A) per explicit design decision in
-- docs/superpowers/specs/2026-09-01-phase3-erp-design.md §2: a vendor is
-- not a contact with a role flag, since vendor-specific fields
-- (payment terms, tax id) don't belong on the shared CRM contact.
CREATE TABLE vendor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  email text,
  phone text,
  payment_terms_days integer,
  tax_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_tenant_id_idx ON vendor (tenant_id, id);

ALTER TABLE vendor ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON vendor
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor TO app_runtime;
