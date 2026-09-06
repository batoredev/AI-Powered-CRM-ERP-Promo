import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createPlan, getPlan, listPlans } from '../plans';
import { createRecurringTemplate } from '../recurring-templates';

const ownerSql = postgres(process.env.DATABASE_URL!);

async function setupTemplate(tenantId: string) {
  return createRecurringTemplate(tenantId, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });
}

describe('plan data access', () => {
  it('creates a plan and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Plan Test Tenant 1') RETURNING id`;
    const template = await setupTemplate(tenant.id);

    const plan = await createPlan(tenant.id, {
      name: 'Pro Monthly',
      priceMinorUnits: 2900,
      currencyCode: 'USD',
      recurringTemplateId: template.id,
    });

    expect(plan.name).toBe('Pro Monthly');
    expect(plan.recurringTemplateId).toBe(template.id);

    const fetched = await getPlan(tenant.id, plan.id);
    expect(fetched).not.toBeNull();
  });

  it('rejects a recurringTemplateId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Plan Test Tenant 2A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Plan Test Tenant 2B') RETURNING id`;
    const templateB = await setupTemplate(tenantB.id);

    await expect(
      createPlan(tenantA.id, { name: 'Should Fail', priceMinorUnits: 100, currencyCode: 'USD', recurringTemplateId: templateB.id }),
    ).rejects.toThrow();

    const plansA = await listPlans(tenantA.id);
    expect(plansA).toHaveLength(0);
  });
});
