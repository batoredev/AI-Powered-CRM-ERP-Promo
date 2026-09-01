-- db/migrations/0009_product.sql
CREATE TYPE product_type AS ENUM ('goods', 'service', 'non_inventoried');

-- The type discriminator is the gate described in design spec §2: a
-- 'service' product never touches the stock ledger (a later sub-plan).
-- 'non_inventoried' covers goods sold without stock tracking (e.g. a
-- dropship/made-to-order item) — distinct from 'service' because it is
-- still a physical good, just not one this tenant stocks.
--
-- Price fields follow the integer-minor-units + explicit-currency-code
-- convention established in db/migrations/0005_deal.sql (design spec
-- §8's round-4 currency-handling fix). Both nullable: a product's price
-- may be set per-order-line instead of catalog-fixed, matching how
-- Phase 2A's deal.value_minor_units is nullable for the same reason.
CREATE TABLE product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  product_type product_type NOT NULL,
  sku text,
  price_minor_units bigint,
  currency_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

CREATE INDEX product_tenant_id_idx ON product (tenant_id, id);
CREATE INDEX product_tenant_type_idx ON product (tenant_id, product_type);

ALTER TABLE product ENABLE ROW LEVEL SECURITY;
ALTER TABLE product FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON product
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON product TO app_runtime;
