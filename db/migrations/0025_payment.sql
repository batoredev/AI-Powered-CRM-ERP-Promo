-- db/migrations/0025_payment.sql
-- payment: tenant_id, contact_id (who paid), amount + currency (money
-- convention matching every other table), received_at, method (free-form
-- text for now -- not a real payment-gateway integration, per this
-- plan's Global Constraints out-of-scope note).
CREATE TABLE payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  contact_id uuid NOT NULL REFERENCES contact(id),
  document_number bigint NOT NULL,
  amount_minor_units bigint NOT NULL CHECK (amount_minor_units > 0),
  currency_code text NOT NULL,
  received_at timestamptz NOT NULL,
  method text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_number)
);

-- payment_allocation: a join table since one payment can cover multiple
-- invoices partially (design spec §2's own framing). The invariant that
-- sum(allocated_amount_minor_units) per payment_id never exceeds that
-- payment's amount_minor_units is enforced at the APPLICATION layer
-- (lib/erp/payments.ts's recordPaymentAllocation), not a DB trigger or
-- CHECK constraint -- matching this codebase's established convention
-- of application-layer invariants over trigger-based ones (see e.g.
-- time_entry's three-independent-booleans design, which has no CHECK
-- linking billable/billed/approval_state either).
CREATE TABLE payment_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  payment_id uuid NOT NULL REFERENCES payment(id),
  invoice_id uuid NOT NULL REFERENCES invoice(id),
  allocated_amount_minor_units bigint NOT NULL CHECK (allocated_amount_minor_units > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_tenant_id_idx ON payment (tenant_id, id);
CREATE INDEX payment_tenant_contact_idx ON payment (tenant_id, contact_id);
CREATE INDEX payment_allocation_tenant_payment_idx ON payment_allocation (tenant_id, payment_id);
CREATE INDEX payment_allocation_tenant_invoice_idx ON payment_allocation (tenant_id, invoice_id);

ALTER TABLE payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE payment_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_allocation
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON payment, payment_allocation TO app_runtime;
