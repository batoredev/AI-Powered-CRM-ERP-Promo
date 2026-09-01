CREATE TYPE goods_handling_mode AS ENUM ('off', 'basic_stock', 'production');
CREATE TYPE billing_mode AS ENUM ('transactional', 'effort_based', 'recurring');

-- Per design spec (docs/superpowers/specs/2026-09-01-phase3-erp-design.md
-- §1): one row per tenant holds the two independently-toggleable axes.
-- goods_handling is a single value (a tenant is at one point on the
-- off -> basic_stock -> production spectrum at a time); billing_modes is
-- an array because a tenant can combine billing modes (e.g. a retailer
-- selling both one-off orders and subscriptions).
CREATE TABLE tenant_erp_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenant(id),
  goods_handling goods_handling_mode NOT NULL DEFAULT 'off',
  billing_modes billing_mode[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_erp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_erp_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_erp_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_erp_settings TO app_runtime;
