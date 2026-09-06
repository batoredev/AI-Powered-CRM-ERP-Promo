import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createRecurringTemplate, getRecurringTemplate, listRecurringTemplates, deactivateRecurringTemplate } from '../recurring-templates';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('recurring template data access', () => {
  it('creates a recurring template and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('RecTemplate Test Tenant 1') RETURNING id`;

    const template = await createRecurringTemplate(tenant.id, {
      documentType: 'invoice',
      intervalUnit: 'months',
      intervalCount: 3,
      nextRunDate: '2026-12-01',
      type: 'scheduled',
    });

    expect(template.documentType).toBe('invoice');
    expect(template.intervalUnit).toBe('months');
    expect(template.intervalCount).toBe(3);
    expect(template.isActive).toBe(true);
    expect(template.approvalState).toBe('draft');

    const fetched = await getRecurringTemplate(tenant.id, template.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.type).toBe('scheduled');
  });

  it('listRecurringTemplates returns only this tenant\'s templates', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('RecTemplate Test Tenant 2A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('RecTemplate Test Tenant 2B') RETURNING id`;

    await createRecurringTemplate(tenantA.id, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });
    await createRecurringTemplate(tenantB.id, { documentType: 'invoice', intervalUnit: 'months', intervalCount: 1, nextRunDate: '2026-10-01', type: 'scheduled' });

    const templatesA = await listRecurringTemplates(tenantA.id);
    expect(templatesA).toHaveLength(1);
  });

  it('deactivateRecurringTemplate moves is_active from true to false, and returns null on a second attempt', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('RecTemplate Test Tenant 3') RETURNING id`;
    const template = await createRecurringTemplate(tenant.id, { documentType: 'sales_order', intervalUnit: 'weeks', intervalCount: 2, nextRunDate: '2026-09-20', type: 'unscheduled' });

    const deactivated = await deactivateRecurringTemplate(tenant.id, template.id);
    expect(deactivated).not.toBeNull();
    expect(deactivated!.isActive).toBe(false);

    const secondAttempt = await deactivateRecurringTemplate(tenant.id, template.id);
    expect(secondAttempt).toBeNull();
  });
});
