-- db/migrations/0030_usage_record.sql
-- Append-only event stream, per research §4.3's explicit framing:
-- "usage records are an append-only event stream, aggregated at cycle
-- close." This migration ships the raw event log only -- aggregation
-- into a billed quantity per cycle, and translating usage into a bill
-- via metered/tiered/overage pricing, are both explicitly future scope
-- (see this plan's Global Constraints out-of-scope list).
CREATE TABLE usage_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  subscription_id uuid NOT NULL REFERENCES subscription(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  recorded_at timestamptz NOT NULL,
  description text
);

CREATE INDEX usage_record_tenant_sub_idx ON usage_record (tenant_id, subscription_id);

ALTER TABLE usage_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_record FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON usage_record
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON usage_record TO app_runtime;
