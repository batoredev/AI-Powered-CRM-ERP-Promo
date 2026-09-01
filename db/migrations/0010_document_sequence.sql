-- db/migrations/0010_document_sequence.sql
-- Per design spec §2: sequential numbering must be atomic and decided
-- now, since retrofitting gapless/sequential numbering after real
-- documents exist is not safely possible (many jurisdictions require
-- invoice numbers with no gaps). One row per (tenant, document_type)
-- pair holds the next number to hand out.
CREATE TABLE document_sequence (
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  document_type text NOT NULL,
  next_number bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, document_type)
);

ALTER TABLE document_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_sequence FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON document_sequence
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON document_sequence TO app_runtime;

-- Atomically allocates and returns the next number for (tenant,
-- document_type), creating the row on first use. SECURITY INVOKER
-- (the default) means this function runs as whichever role calls it —
-- app_runtime, subject to the same RLS policy above — never bypassing
-- tenant isolation. The UPSERT + RETURNING happens in one statement,
-- so concurrent callers for the same (tenant, document_type) are
-- serialized by Postgres's row-level locking on the UPDATE, not by
-- application-level locking.
CREATE FUNCTION next_document_number(p_tenant_id uuid, p_document_type text)
RETURNS bigint AS $$
DECLARE
  v_number bigint;
BEGIN
  INSERT INTO document_sequence (tenant_id, document_type, next_number)
  VALUES (p_tenant_id, p_document_type, 2)
  ON CONFLICT (tenant_id, document_type)
  DO UPDATE SET next_number = document_sequence.next_number + 1
  RETURNING (CASE WHEN document_sequence.next_number = 2 AND xmax = 0 THEN 1 ELSE document_sequence.next_number - 1 END)
  INTO v_number;
  RETURN v_number;
END;
$$ LANGUAGE plpgsql;
