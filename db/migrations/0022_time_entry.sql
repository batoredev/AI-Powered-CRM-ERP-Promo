-- db/migrations/0022_time_entry.sql
-- Three genuinely independent facts, per research §2.3 — never collapse
-- any two of these:
--   - billable: should this time even be charged to the client? (a
--     non-billable entry, e.g. internal admin work, is still logged for
--     reporting but never appears on an invoice)
--   - billed: has an invoice already been generated for this entry? A
--     time entry can be billable-but-unbilled (the normal, common case
--     before invoicing runs) — collapsing billable/billed into one flag
--     breaks the eventual "sweep unbilled billable time into an
--     invoice" automation this table exists to support.
--   - approval_state (shared enum from 0007/0011): has this entry been
--     approved for billing at all? Per research, NetSuite bills only
--     approved entries — approval is load-bearing, not decorative.
--     Defaults 'draft' so a future Phase 5 agent-logged entry never
--     auto-approves itself.
--
-- task_id is nullable: an entry can be logged against a project
-- generally, not always tied to one specific task.
-- user_id is intentionally omitted from this phase — this project has
-- no real session-based user auth yet (only lib/auth/dev-tenant.ts's
-- dev-only tenant resolution), so there is no real user identity to
-- attach an entry to. Recorded here so the gap is visible rather than
-- silently dropped; add a user_id FK to app_user once real auth exists.
CREATE TABLE time_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_id uuid NOT NULL REFERENCES project(id),
  task_id uuid REFERENCES task(id),
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  occurred_on date NOT NULL,
  description text,
  billable boolean NOT NULL DEFAULT true,
  billed boolean NOT NULL DEFAULT false,
  approval_state approval_state NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX time_entry_tenant_project_idx ON time_entry (tenant_id, project_id);
CREATE INDEX time_entry_tenant_billing_idx ON time_entry (tenant_id, billable, billed, approval_state);

ALTER TABLE time_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entry FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON time_entry
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON time_entry TO app_runtime;
