-- db/migrations/0014_purchase_order.sql
CREATE TYPE purchase_order_status AS ENUM ('draft', 'submitted', 'received', 'cancelled');

-- Deliberately two separate state columns, per design spec §3's boundary
-- call #3 ("split states that look like one boolean but aren't"):
--   - approval_state (shared enum from 0007/0011): was this PO approved
--     by a human/policy? Defaults to 'draft' so a future Phase 5 agent
--     action never auto-approves itself.
--   - status: has this PO actually been fulfilled? Independent axis —
--     an approved PO can still be unsubmitted, and (in principle) a
--     submitted PO's approval could still be pending in a stricter
--     workflow. Collapsing these into one field would make "approved
--     but not yet received" and "received without ever being approved"
--     indistinguishable from their opposites.
CREATE TABLE purchase_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  vendor_id uuid NOT NULL REFERENCES vendor(id),
  document_number bigint NOT NULL,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  status purchase_order_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_number)
);

CREATE TABLE purchase_order_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  purchase_order_id uuid NOT NULL REFERENCES purchase_order(id),
  product_id uuid NOT NULL REFERENCES product(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price_minor_units bigint NOT NULL,
  currency_code text NOT NULL
);

CREATE INDEX purchase_order_tenant_id_idx ON purchase_order (tenant_id, id);
CREATE INDEX purchase_order_tenant_vendor_idx ON purchase_order (tenant_id, vendor_id);
CREATE INDEX purchase_order_line_tenant_po_idx ON purchase_order_line (tenant_id, purchase_order_id);

ALTER TABLE purchase_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE purchase_order_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_line
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_order, purchase_order_line TO app_runtime;
