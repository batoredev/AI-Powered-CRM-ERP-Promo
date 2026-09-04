-- db/migrations/0019_work_order.sql
CREATE TYPE work_order_status AS ENUM ('pending', 'in_progress', 'done');

-- "Perform this operation at this work center" for one specific
-- manufacturing order (research §3.1/§3.3: MO = "make N of this
-- product", WorkOrder = "perform this operation at this work center" —
-- two different entities). operation_id is nullable: an MO whose BoM
-- has no routing attached has no work orders at all (see
-- planManufacturingOrder in lib/erp/manufacturing-orders.ts) rather than
-- a work_order row with a null operation — so in practice this column
-- is always populated for any row that exists, but stays nullable
-- because a future "ad-hoc work order not tied to a routing operation"
-- use case is a real possibility this schema shouldn't foreclose.
CREATE TABLE work_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  manufacturing_order_id uuid NOT NULL REFERENCES manufacturing_order(id),
  operation_id uuid REFERENCES operation(id),
  status work_order_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_order_tenant_mo_idx ON work_order (tenant_id, manufacturing_order_id);

ALTER TABLE work_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_order
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON work_order TO app_runtime;
