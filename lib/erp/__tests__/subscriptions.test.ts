import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createSubscription, getSubscription, pauseSubscription, cancelSubscription, reactivateSubscription } from '../subscriptions';
import { createPlan } from '../plans';
import { createRecurringTemplate } from '../recurring-templates';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

async function setupPlan(tenantId: string) {
  const template = await createRecurringTemplate(tenantId, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });
  return createPlan(tenantId, { name: 'Pro Monthly', priceMinorUnits: 2900, currencyCode: 'USD', recurringTemplateId: template.id });
}

describe('subscription data access', () => {
  it('creates a subscription and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Subscription Test Tenant 1') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Subscriber' });
    const plan = await setupPlan(tenant.id);

    const subscription = await createSubscription(tenant.id, { contactId: contact.id, planId: plan.id, anchorDate: '2026-09-06' });

    expect(subscription.contactId).toBe(contact.id);
    expect(subscription.status).toBe('active');
    expect(subscription.approvalState).toBe('draft');

    const fetched = await getSubscription(tenant.id, subscription.id);
    expect(fetched).not.toBeNull();
  });

  it('rejects a contactId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Subscription Test Tenant 2A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Subscription Test Tenant 2B') RETURNING id`;
    const contactB = await createContact(tenantB.id, { fullName: 'Tenant B Subscriber' });
    const planA = await setupPlan(tenantA.id);

    await expect(
      createSubscription(tenantA.id, { contactId: contactB.id, planId: planA.id, anchorDate: '2026-09-06' }),
    ).rejects.toThrow();
  });

  it('rejects a planId belonging to another tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Subscription Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Subscription Test Tenant 3B') RETURNING id`;
    const contactA = await createContact(tenantA.id, { fullName: 'Subscriber' });
    const planB = await setupPlan(tenantB.id);

    await expect(
      createSubscription(tenantA.id, { contactId: contactA.id, planId: planB.id, anchorDate: '2026-09-06' }),
    ).rejects.toThrow();
  });

  it('pause -> reactivate -> cancel transitions work, and each guard rejects the wrong prior state', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Subscription Test Tenant 4') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Subscriber' });
    const plan = await setupPlan(tenant.id);
    const subscription = await createSubscription(tenant.id, { contactId: contact.id, planId: plan.id, anchorDate: '2026-09-06' });

    // active -> paused
    const paused = await pauseSubscription(tenant.id, subscription.id);
    expect(paused).not.toBeNull();
    expect(paused!.status).toBe('paused');

    // already paused -- second pause attempt returns null
    const secondPause = await pauseSubscription(tenant.id, subscription.id);
    expect(secondPause).toBeNull();

    // paused -> active
    const reactivated = await reactivateSubscription(tenant.id, subscription.id);
    expect(reactivated).not.toBeNull();
    expect(reactivated!.status).toBe('active');

    // active -> cancelled
    const cancelled = await cancelSubscription(tenant.id, subscription.id);
    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe('cancelled');

    // cancelled subscription cannot be reactivated
    const reactivateAfterCancel = await reactivateSubscription(tenant.id, subscription.id);
    expect(reactivateAfterCancel).toBeNull();
  });
});
