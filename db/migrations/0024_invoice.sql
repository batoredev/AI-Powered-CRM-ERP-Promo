-- db/migrations/0024_invoice.sql
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'void');
CREATE TYPE invoice_source_type AS ENUM ('sales_order', 'time_entries', 'subscription');

-- Per design spec §2: "universal terminus of every vertical" -- an
-- invoice can originate from a sales order, from unbilled time/
-- milestones, or from a subscription billing cycle. source_type + a
-- nullable per-type source FK records which, without forcing all three
-- origins through one shape. Only sales_order_id exists today: time-
-- entry invoicing and subscription billing don't have a caller yet
-- (both are future sub-plans built on top of this core), so this
-- migration only wires the discriminator + the one FK that's reachable
-- now. Adding a nullable time_entries/subscription source FK is a
-- forward-compatible additive migration when those callers exist --
-- deliberately not guessed at here.
CREATE TABLE invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  source_type invoice_source_type NOT NULL,
  sales_order_id uuid REFERENCES sales_order(id),
  document_number bigint NOT NULL,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  status invoice_status NOT NULL DEFAULT 'draft',
  due_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_number)
);

-- invoice_line is NOT always tied to a product (per design spec §2) --
-- a time-based line item needs a free-text description, not a product
-- reference. product_id is deliberately absent from this table; a
-- future sub-plan that needs to trace an invoice line back to a
-- specific product can add a nullable FK additively then.
CREATE TABLE invoice_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  invoice_id uuid NOT NULL REFERENCES invoice(id),
  description text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price_minor_units bigint NOT NULL,
  currency_code text NOT NULL
);

CREATE INDEX invoice_tenant_id_idx ON invoice (tenant_id, id);
CREATE INDEX invoice_tenant_sales_order_idx ON invoice (tenant_id, sales_order_id);
CREATE INDEX invoice_line_tenant_invoice_idx ON invoice_line (tenant_id, invoice_id);

ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE invoice_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_line
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON invoice, invoice_line TO app_runtime;
