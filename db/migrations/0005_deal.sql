-- DEFERRED SCOPE (Phase 2A final review, 2026-08-31): this table currently
-- holds current-row state only — `moveDealToStage` (lib/crm/deals.ts)
-- overwrites `pipeline_stage_id` in place, with no record of prior stages
-- or transition times. Design spec §8 ("Audit/history model for business
-- tables") requires `deal` (along with `order` and `invoice`) to have
-- append-only history/versioning, not just current-row state, given both
-- the GDPR-class deletion promise (§7) and ERP's own retention
-- requirements. Full column-level design for that history model is
-- deferred to a later phase (Phase 3 ERP or a dedicated hardening pass) —
-- recorded here so it is visible rather than silently dropped as scope.
-- See docs/superpowers/specs/2026-08-29-ai-crm-erp-platform-design.md §8
-- and §10.
CREATE TABLE deal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contact_id uuid NOT NULL REFERENCES contact(id),
  pipeline_stage_id uuid NOT NULL REFERENCES pipeline_stage(id),
  title text NOT NULL,
  -- Integer minor-units + currency code, per design spec §8's round-4
  -- currency-handling fix — applied here even though pipeline deals are
  -- often estimate-stage, since a deal can carry a real value.
  value_minor_units bigint,
  currency_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX deal_tenant_id_idx ON deal (tenant_id, id);
CREATE INDEX deal_tenant_stage_idx ON deal (tenant_id, pipeline_stage_id);
CREATE INDEX deal_tenant_contact_idx ON deal (tenant_id, contact_id);

ALTER TABLE deal ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON deal
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON deal TO app_runtime;
