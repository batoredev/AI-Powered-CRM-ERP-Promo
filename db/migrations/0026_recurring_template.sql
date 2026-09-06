-- db/migrations/0026_recurring_template.sql
CREATE TYPE recurring_template_type AS ENUM ('scheduled', 'reminder', 'unscheduled');
CREATE TYPE interval_unit AS ENUM ('weeks', 'months', 'years');

-- Generalizes beyond subscriptions, per research §4.3: QuickBooks applies
-- recurring templates to transactions generally (recurring bills,
-- recurring journal entries, recurring POs), not only subscription
-- invoices -- this is why document_type is a free-text field naming
-- WHICH document this template would generate (e.g. 'invoice',
-- 'sales_order'), not a foreign key into any one document table. This
-- plan does not build the scheduler that reads next_run_date and
-- actually generates a document -- see this plan's Global Constraints.
--
-- type is the three-way "AI acts / AI proposes / human keeps it manual"
-- gradient from the research: 'scheduled' = fully automatic generation,
-- 'reminder' = human-prompted generation, 'unscheduled' = saved-but-
-- dormant draft. approval_state (shared enum) is independent of type --
-- a scheduled template can still require approval before its next
-- generated document goes out, matching this project's established
-- two-independent-axes pattern (e.g. purchase_order's approval_state
-- vs status).
--
-- interval_unit + interval_count together express "every N units" (e.g.
-- interval_unit='months', interval_count=3 means quarterly) -- per
-- research §4.1's explicit "billing period is a unit + numeric value
-- pair, not an enum of monthly/quarterly/annual" finding (Odoo's
-- pattern).
CREATE TABLE recurring_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  document_type text NOT NULL,
  interval_unit interval_unit NOT NULL,
  interval_count integer NOT NULL CHECK (interval_count > 0),
  next_run_date date NOT NULL,
  type recurring_template_type NOT NULL,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recurring_template_tenant_id_idx ON recurring_template (tenant_id, id);
CREATE INDEX recurring_template_tenant_active_idx ON recurring_template (tenant_id, is_active);

ALTER TABLE recurring_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_template FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_template
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON recurring_template TO app_runtime;
