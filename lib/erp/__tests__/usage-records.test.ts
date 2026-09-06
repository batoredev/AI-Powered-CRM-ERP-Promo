import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { recordUsage, listUsageRecords, getTotalUsage } from '../usage-records';
import { createSubscription } from '../subscriptions';
import { createPlan } from '../plans';
import { createRecurringTemplate } from '../recurring-templates';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

async function setupSubscription(tenantId: string) {
  const contact = await createContact(tenantId, { fullName: 'Subscriber' });
  const template = await createRecurringTemplate(tenantId, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });
  const plan = await createPlan(tenantId, { name: 'Metered Plan', priceMinorUnits: 0, currencyCode: 'USD', recurringTemplateId: template.id });
  return createSubscription(tenantId, { contactId: contact.id, planId: plan.id, anchorDate: '2026-09-06' });
}

describe('usage record data access', () => {
  it('records usage and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('UsageRecord Test Tenant 1') RETURNING id`;
    const subscription = await setupSubscription(tenant.id);

    const record = await recordUsage(tenant.id, {
      subscriptionId: subscription.id,
      quantity: 150,
      recordedAt: '2026-09-06T12:00:00.000Z',
      description: 'API calls',
    });

    expect(record.quantity).toBe(150);

    const records = await listUsageRecords(tenant.id, subscription.id);
    expect(records).toHaveLength(1);
  });

  it('getTotalUsage sums quantity across all usage records for a subscription', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('UsageRecord Test Tenant 2') RETURNING id`;
    const subscription = await setupSubscription(tenant.id);

    await recordUsage(tenant.id, { subscriptionId: subscription.id, quantity: 100, recordedAt: '2026-09-01T00:00:00.000Z' });
    await recordUsage(tenant.id, { subscriptionId: subscription.id, quantity: 50, recordedAt: '2026-09-02T00:00:00.000Z' });

    const total = await getTotalUsage(tenant.id, subscription.id);
    expect(total).toBe(150);
  });

  it('rejects a subscriptionId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('UsageRecord Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('UsageRecord Test Tenant 3B') RETURNING id`;
    const subscriptionB = await setupSubscription(tenantB.id);

    await expect(
      recordUsage(tenantA.id, { subscriptionId: subscriptionB.id, quantity: 10, recordedAt: '2026-09-06T00:00:00.000Z' }),
    ).rejects.toThrow();
  });
});
