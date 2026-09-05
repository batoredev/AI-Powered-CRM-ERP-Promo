-- db/migrations/0021_task.sql
-- A task can carry its own hourly rate — per research §2.3's rate-
-- resolution design fact, Zoho Books supports three rate sources (task
-- rate, user rate, project rate) with an explicit precedence order.
-- This phase only stores the task-level rate (the first tier); user-
-- level and project-level rate resolution, and the precedence chain
-- itself, are deferred to whenever invoice generation is built and
-- actually needs to resolve a rate — recorded here so the deferral is
-- visible, not silently dropped.
CREATE TABLE task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_id uuid NOT NULL REFERENCES project(id),
  name text NOT NULL,
  hourly_rate_minor_units bigint,
  currency_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_tenant_project_idx ON task (tenant_id, project_id);

ALTER TABLE task ENABLE ROW LEVEL SECURITY;
ALTER TABLE task FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON task
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON task TO app_runtime;
