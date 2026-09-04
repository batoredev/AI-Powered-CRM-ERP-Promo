-- db/migrations/0018_manufacturing_order.sql
CREATE TYPE manufacturing_order_status AS ENUM ('draft', 'planned', 'in_progress', 'completed', 'cancelled');

-- Same two-independent-state-columns principle as purchase_order
-- (Phase 3A-2, design spec §3 boundary call #3): approval_state answers
-- "was this approved" (defaults 'draft' so a future Phase 5 agent action
-- never auto-approves itself, per .claude/rules/ai-systems.md); status
-- answers "where is this in the production lifecycle". Collapsing them
-- would make "approved but not yet planned" and "planned without ever
-- being approved" indistinguishable from their opposites — exactly the
-- mistake purchase_order's own header comment already warns against.
CREATE TABLE manufacturing_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  product_id uuid NOT NULL REFERENCES product(id),
  bill_of_materials_id uuid NOT NULL REFERENCES bill_of_materials(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  target_location_id uuid NOT NULL REFERENCES location(id),
  document_number bigint NOT NULL,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  status manufacturing_order_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_number)
);

CREATE INDEX manufacturing_order_tenant_id_idx ON manufacturing_order (tenant_id, id);
CREATE INDEX manufacturing_order_tenant_product_idx ON manufacturing_order (tenant_id, product_id);

ALTER TABLE manufacturing_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing_order FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON manufacturing_order
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON manufacturing_order TO app_runtime;
