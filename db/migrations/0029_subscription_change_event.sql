-- db/migrations/0029_subscription_change_event.sql
-- Append-only ledger, matching stock_move's precedent exactly (design
-- spec §3 point 2's explicit principle: "subscription proration is
-- never computed by editing a subscription row -- it's recorded on a
-- subscription_change_event row at the moment of the change"). No
-- update/delete function will ever exist for this table -- if a mistake
-- needs correcting, a new compensating event is recorded, the existing
-- one is never edited.
--
-- previous_plan_id / new_plan_id are BOTH nullable: an 'upgrade' or
-- 'downgrade' event has both (moving from one plan to another); a
-- 'cancellation' or 'reactivation' event may have neither, since those
-- are subscription-lifecycle events, not necessarily plan changes.
CREATE TYPE subscription_change_event_type AS ENUM ('upgrade', 'downgrade', 'cancellation', 'reactivation');

CREATE TABLE subscription_change_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  subscription_id uuid NOT NULL REFERENCES subscription(id),
  event_type subscription_change_event_type NOT NULL,
  effective_date date NOT NULL,
  previous_plan_id uuid REFERENCES plan(id),
  new_plan_id uuid REFERENCES plan(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_change_event_tenant_sub_idx ON subscription_change_event (tenant_id, subscription_id);

ALTER TABLE subscription_change_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_change_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription_change_event
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_change_event TO app_runtime;
