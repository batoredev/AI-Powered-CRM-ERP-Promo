-- db/migrations/0013_stock_move.sql
CREATE TYPE stock_movement_type AS ENUM ('receipt', 'shipment', 'adjustment', 'transfer');

-- The append-only movement ledger. Per design spec §3's boundary call #2:
-- stock quantity is NEVER a stored column on product — always derived by
-- summing stock_move rows at query time (see getStockOnHand in
-- lib/erp/stock.ts). Every quantity change is a row here, never an
-- UPDATE to an existing balance.
--
-- location_id is the destination (where stock arrives) and is nullable
-- for movements that leave the tenant's stock entirely (a shipment/sale
-- has no destination location within this tenant). source_location_id
-- is nullable for movements with no internal origin (a receipt from a
-- vendor has no source_location_id — it enters stock from outside).
-- Both nullable, but a row should have at least one of the two set;
-- application code enforces this (recordStockMove), not a DB constraint,
-- since a CHECK constraint here would need to special-case 'adjustment'
-- movements which may legitimately set only one side depending on
-- direction (a positive adjustment sets location_id, a negative
-- adjustment sets source_location_id).
CREATE TABLE stock_move (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  product_id uuid NOT NULL REFERENCES product(id),
  location_id uuid REFERENCES location(id),
  source_location_id uuid REFERENCES location(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  movement_type stock_movement_type NOT NULL,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stock_move_tenant_product_location_idx ON stock_move (tenant_id, product_id, location_id);
CREATE INDEX stock_move_tenant_product_source_idx ON stock_move (tenant_id, product_id, source_location_id);

ALTER TABLE stock_move ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_move FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON stock_move
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_move TO app_runtime;
