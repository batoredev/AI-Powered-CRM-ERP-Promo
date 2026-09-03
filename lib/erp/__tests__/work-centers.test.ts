import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createWorkCenter, getWorkCenter, listWorkCenters } from '../work-centers';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('work center data access', () => {
  it('creates a work center and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Work Center Test Tenant 1') RETURNING id`;

    const workCenter = await createWorkCenter(tenant.id, { name: 'Assembly Line 1' });

    expect(workCenter.name).toBe('Assembly Line 1');

    const fetched = await getWorkCenter(tenant.id, workCenter.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Assembly Line 1');
  });

  it('returns null from getWorkCenter for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Work Center Test Tenant 2') RETURNING id`;
    const result = await getWorkCenter(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('lists only work centers belonging to the given tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Work Center Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Work Center Test Tenant 3B') RETURNING id`;

    await createWorkCenter(tenantA.id, { name: 'Tenant A Line' });
    await createWorkCenter(tenantB.id, { name: 'Tenant B Line' });

    const centersA = await listWorkCenters(tenantA.id);
    expect(centersA.map((c) => c.name)).toEqual(['Tenant A Line']);
  });
});
