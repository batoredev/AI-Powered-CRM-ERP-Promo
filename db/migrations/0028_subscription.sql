-- db/migrations/0028_subscription.sql
CREATE TYPE subscription_status AS ENUM ('active', 'paused', 'cancelled');

-- contact_id reuses the existing CRM contact table per this project's
-- established "one record, not duplicated per module" principle (same
-- as project.contact_id from Phase 3A-4, sales_order.contact_id and
-- payment.contact_id from Phase 3A-5).
--
-- Two independent state axes, per this project's now-established
-- pattern (purchase_order's approval_state vs status; time_entry's
-- three independent booleans): approval_state (was cancelling this
-- subscription approved? -- per research's explicit approval-gate note,
-- cancelling a subscription is an irreversible external action) vs
-- status (is it currently active/paused/cancelled?). anchor_date is the
-- date the subscription started, used to compute billing cycles
-- (billing-cycle computation itself is future scope, not this plan).
CREATE TABLE subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contact_id uuid NOT NULL REFERENCES contact(id),
  plan_id uuid NOT NULL REFERENCES plan(id),
  status subscription_status NOT NULL DEFAULT 'active',
  anchor_date date NOT NULL,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_tenant_id_idx ON subscription (tenant_id, id);
CREATE INDEX subscription_tenant_contact_idx ON subscription (tenant_id, contact_id);
CREATE INDEX subscription_tenant_plan_idx ON subscription (tenant_id, plan_id);

ALTER TABLE subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON subscription TO app_runtime;
