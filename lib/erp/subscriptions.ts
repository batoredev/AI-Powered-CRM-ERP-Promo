import { withTenant } from '../db/with-tenant';
import { getContact } from '../crm/contacts';
import { getPlan } from './plans';

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';
export type ApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn';

export interface Subscription {
  id: string;
  tenantId: string;
  contactId: string;
  planId: string;
  status: SubscriptionStatus;
  anchorDate: string;
  approvalState: ApprovalState;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSubscription {
  contactId: string;
  planId: string;
  anchorDate: string;
}

function rowToSubscription(row: any): Subscription {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    planId: row.plan_id,
    status: row.status,
    anchorDate: row.anchor_date instanceof Date ? row.anchor_date.toISOString().slice(0, 10) : row.anchor_date,
    approvalState: row.approval_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createSubscription(tenantId: string, input: NewSubscription): Promise<Subscription> {
  const contact = await getContact(tenantId, input.contactId);
  if (!contact) {
    throw new Error(`Invalid contact reference: ${input.contactId} does not belong to this tenant`);
  }
  const plan = await getPlan(tenantId, input.planId);
  if (!plan) {
    throw new Error(`Invalid plan reference: ${input.planId} does not belong to this tenant`);
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO subscription (tenant_id, contact_id, plan_id, anchor_date)
      VALUES (${tenantId}, ${input.contactId}, ${input.planId}, ${input.anchorDate})
      RETURNING *
    `;
    return rowToSubscription(row);
  });
}

export async function getSubscription(tenantId: string, id: string): Promise<Subscription | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM subscription WHERE id = ${id}`;
    return rows.length > 0 ? rowToSubscription(rows[0]) : null;
  });
}

export async function pauseSubscription(tenantId: string, id: string): Promise<Subscription | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE subscription
      SET status = 'paused', updated_at = now()
      WHERE id = ${id} AND status = 'active'
      RETURNING *
    `;
    return rows.length > 0 ? rowToSubscription(rows[0]) : null;
  });
}

export async function cancelSubscription(tenantId: string, id: string): Promise<Subscription | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE subscription
      SET status = 'cancelled', updated_at = now()
      WHERE id = ${id} AND status IN ('active', 'paused')
      RETURNING *
    `;
    return rows.length > 0 ? rowToSubscription(rows[0]) : null;
  });
}

export async function reactivateSubscription(tenantId: string, id: string): Promise<Subscription | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE subscription
      SET status = 'active', updated_at = now()
      WHERE id = ${id} AND status = 'paused'
      RETURNING *
    `;
    return rows.length > 0 ? rowToSubscription(rows[0]) : null;
  });
}
