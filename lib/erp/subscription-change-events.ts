import { withTenant } from '../db/with-tenant';
import { getSubscription } from './subscriptions';
import { getPlan } from './plans';

export type SubscriptionChangeEventType = 'upgrade' | 'downgrade' | 'cancellation' | 'reactivation';

export interface SubscriptionChangeEvent {
  id: string;
  tenantId: string;
  subscriptionId: string;
  eventType: SubscriptionChangeEventType;
  effectiveDate: string;
  previousPlanId: string | null;
  newPlanId: string | null;
  createdAt: Date;
}

export interface NewSubscriptionChangeEvent {
  subscriptionId: string;
  eventType: SubscriptionChangeEventType;
  effectiveDate: string;
  previousPlanId?: string;
  newPlanId?: string;
}

function rowToSubscriptionChangeEvent(row: any): SubscriptionChangeEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subscriptionId: row.subscription_id,
    eventType: row.event_type,
    effectiveDate: row.effective_date instanceof Date ? row.effective_date.toISOString().slice(0, 10) : row.effective_date,
    previousPlanId: row.previous_plan_id,
    newPlanId: row.new_plan_id,
    createdAt: row.created_at,
  };
}

export async function recordSubscriptionChangeEvent(
  tenantId: string,
  input: NewSubscriptionChangeEvent,
): Promise<SubscriptionChangeEvent> {
  const subscription = await getSubscription(tenantId, input.subscriptionId);
  if (!subscription) {
    throw new Error(`Invalid subscription reference: ${input.subscriptionId} does not belong to this tenant`);
  }
  if (input.previousPlanId) {
    const previousPlan = await getPlan(tenantId, input.previousPlanId);
    if (!previousPlan) {
      throw new Error(`Invalid previous plan reference: ${input.previousPlanId} does not belong to this tenant`);
    }
  }
  if (input.newPlanId) {
    const newPlan = await getPlan(tenantId, input.newPlanId);
    if (!newPlan) {
      throw new Error(`Invalid new plan reference: ${input.newPlanId} does not belong to this tenant`);
    }
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO subscription_change_event (tenant_id, subscription_id, event_type, effective_date, previous_plan_id, new_plan_id)
      VALUES (${tenantId}, ${input.subscriptionId}, ${input.eventType}, ${input.effectiveDate}, ${input.previousPlanId ?? null}, ${input.newPlanId ?? null})
      RETURNING *
    `;
    return rowToSubscriptionChangeEvent(row);
  });
}

export async function listSubscriptionChangeEvents(tenantId: string, subscriptionId: string): Promise<SubscriptionChangeEvent[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM subscription_change_event WHERE subscription_id = ${subscriptionId} ORDER BY created_at ASC`;
    return rows.map(rowToSubscriptionChangeEvent);
  });
}
