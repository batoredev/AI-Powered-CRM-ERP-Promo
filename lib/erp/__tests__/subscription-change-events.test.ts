import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { recordSubscriptionChangeEvent, listSubscriptionChangeEvents } from '../subscription-change-events';
import { createSubscription } from '../subscriptions';
import { createPlan } from '../plans';
import { createRecurringTemplate } from '../recurring-templates';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

async function setupSubscription(tenantId: string) {
  const contact = await createContact(tenantId, { fullName: 'Subscriber' });
  const template = await createRecurringTemplate(tenantId, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });
  const plan = await createPlan(tenantId, { name: 'Pro Monthly', priceMinorUnits: 2900, currencyCode: 'USD', recurringTemplateId: template.id });
  const subscription = await createSubscription(tenantId, { contactId: contact.id, planId: plan.id, anchorDate: '2026-09-06' });
  return { subscription, plan };
}

describe('subscription change event data access', () => {
  it('records an upgrade event with both plan references and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('ChangeEvent Test Tenant 1') RETURNING id`;
    const { subscription, plan: oldPlan } = await setupSubscription(tenant.id);
    const template2 = await createRecurringTemplate(tenant.id, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });
    const newPlan = await createPlan(tenant.id, { name: 'Enterprise Monthly', priceMinorUnits: 9900, currencyCode: 'USD', recurringTemplateId: template2.id });

    const event = await recordSubscriptionChangeEvent(tenant.id, {
      subscriptionId: subscription.id,
      eventType: 'upgrade',
      effectiveDate: '2026-09-10',
      previousPlanId: oldPlan.id,
      newPlanId: newPlan.id,
    });

    expect(event.eventType).toBe('upgrade');
    expect(event.previousPlanId).toBe(oldPlan.id);
    expect(event.newPlanId).toBe(newPlan.id);

    const events = await listSubscriptionChangeEvents(tenant.id, subscription.id);
    expect(events).toHaveLength(1);
  });

  it('records a cancellation event with neither plan reference', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('ChangeEvent Test Tenant 2') RETURNING id`;
    const { subscription } = await setupSubscription(tenant.id);

    const event = await recordSubscriptionChangeEvent(tenant.id, {
      subscriptionId: subscription.id,
      eventType: 'cancellation',
      effectiveDate: '2026-09-15',
    });

    expect(event.previousPlanId).toBeNull();
    expect(event.newPlanId).toBeNull();
  });

  it('rejects a subscriptionId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('ChangeEvent Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('ChangeEvent Test Tenant 3B') RETURNING id`;
    const { subscription: subscriptionB } = await setupSubscription(tenantB.id);

    await expect(
      recordSubscriptionChangeEvent(tenantA.id, { subscriptionId: subscriptionB.id, eventType: 'cancellation', effectiveDate: '2026-09-15' }),
    ).rejects.toThrow();
  });

  it('rejects a newPlanId belonging to another tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('ChangeEvent Test Tenant 4A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('ChangeEvent Test Tenant 4B') RETURNING id`;
    const { subscription: subscriptionA } = await setupSubscription(tenantA.id);
    const { plan: planB } = await setupSubscription(tenantB.id);

    await expect(
      recordSubscriptionChangeEvent(tenantA.id, { subscriptionId: subscriptionA.id, eventType: 'upgrade', effectiveDate: '2026-09-15', newPlanId: planB.id }),
    ).rejects.toThrow();
  });
});
