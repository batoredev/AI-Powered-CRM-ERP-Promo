-- db/migrations/0023_sales_order.sql
CREATE TYPE sales_order_status AS ENUM ('draft', 'confirmed', 'fulfilled', 'cancelled');

-- Mirrors purchase_order (migration 0014) deliberately: same two-state-
-- column split (approval_state: was this approved? vs status: where is
-- it in its lifecycle?), same document_number + UNIQUE(tenant_id,
-- document_number) mechanism. Per design spec §3 point 1, this stays a
-- SEPARATE table from purchase_order rather than one polymorphic `order`
-- table with a direction flag -- different party (contact/customer vs
-- vendor), different downstream document (invoice vs stock receipt).
CREATE TABLE sales_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contact_id uuid NOT NULL REFERENCES contact(id),
  document_number bigint NOT NULL,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  status sales_order_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_number)
);

CREATE TABLE sales_order_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  sales_order_id uuid NOT NULL REFERENCES sales_order(id),
  product_id uuid NOT NULL REFERENCES product(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price_minor_units bigint NOT NULL,
  currency_code text NOT NULL
);

CREATE INDEX sales_order_tenant_id_idx ON sales_order (tenant_id, id);
CREATE INDEX sales_order_tenant_contact_idx ON sales_order (tenant_id, contact_id);
CREATE INDEX sales_order_line_tenant_so_idx ON sales_order_line (tenant_id, sales_order_id);

ALTER TABLE sales_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_order
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE sales_order_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_order_line
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON sales_order, sales_order_line TO app_runtime;
