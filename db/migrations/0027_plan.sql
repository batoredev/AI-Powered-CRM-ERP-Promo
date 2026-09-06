-- db/migrations/0027_plan.sql
-- Per research §4.1: "Plan is separate from subscription" (Zoho Billing
-- models Plans in a product catalog, Subscriptions as customer-bound
-- instances). recurring_template_id gives the plan its billing cadence
-- via the generic core entity from Task 1 -- the plan does not carry
-- its own interval_unit/interval_count fields, since that would
-- duplicate what recurring_template already models.
CREATE TABLE plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  price_minor_units bigint NOT NULL,
  currency_code text NOT NULL,
  recurring_template_id uuid NOT NULL REFERENCES recurring_template(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX plan_tenant_id_idx ON plan (tenant_id, id);

ALTER TABLE plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plan
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON plan TO app_runtime;
