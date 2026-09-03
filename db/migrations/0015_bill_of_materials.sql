-- db/migrations/0015_bill_of_materials.sql
CREATE TYPE bom_type AS ENUM ('manufacture', 'kit');

-- A BoM belongs to exactly one product (the finished good it produces),
-- but a product may have MULTIPLE BoMs — e.g. two different recipes for
-- the same finished good (research §3.1's asymmetric cardinality). Do
-- not add a UNIQUE constraint on product_id.
--
-- routing_id is nullable and added here (rather than only on the routing
-- table) because a BoM has AT MOST ONE routing (0..1), while a routing
-- may be attached to MULTIPLE BoMs (research §3.1) — the FK belongs on
-- the "many" side pointing at the "one" side it's optional toward, which
-- is bill_of_materials -> routing here. Task 3 adds the actual
-- REFERENCES constraint once the routing table exists (this table is
-- created before routing in migration order), via a follow-up
-- ALTER TABLE in Task 3's own migration — do not add a routing_id column
-- referencing a table that doesn't exist yet.
CREATE TABLE bill_of_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  product_id uuid NOT NULL REFERENCES product(id),
  name text NOT NULL,
  bom_type bom_type NOT NULL DEFAULT 'manufacture',
  routing_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Recursive by reference, not by a self-FK on this table: a component's
-- component_product_id can itself be a product with its own
-- bill_of_materials row (research §3.1/§3.3 — "component may have its
-- own BoM"). Multi-level explosion is a read-time graph walk
-- (product -> its BoMs -> their components -> those products' BoMs...),
-- not a schema-level recursive FK here.
CREATE TABLE bom_component (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  bill_of_materials_id uuid NOT NULL REFERENCES bill_of_materials(id),
  component_product_id uuid NOT NULL REFERENCES product(id),
  quantity numeric NOT NULL CHECK (quantity > 0)
);

CREATE INDEX bom_tenant_product_idx ON bill_of_materials (tenant_id, product_id);
CREATE INDEX bom_component_tenant_bom_idx ON bom_component (tenant_id, bill_of_materials_id);

ALTER TABLE bill_of_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_of_materials FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bill_of_materials
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE bom_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_component FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bom_component
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON bill_of_materials, bom_component TO app_runtime;
