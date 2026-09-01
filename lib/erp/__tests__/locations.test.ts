import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createLocation, getLocation, listLocations } from '../locations';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('location data access', () => {
  it('creates a location and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Location Test Tenant 1') RETURNING id`;

    const location = await createLocation(tenant.id, { name: 'Main Warehouse' });

    expect(location.name).toBe('Main Warehouse');

    const fetched = await getLocation(tenant.id, location.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Main Warehouse');
  });

  it('returns null from getLocation for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Location Test Tenant 2') RETURNING id`;
    const result = await getLocation(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('lists only locations belonging to the given tenant, supporting multiple locations per tenant', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Location Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Location Test Tenant 3B') RETURNING id`;

    await createLocation(tenantA.id, { name: 'Warehouse North' });
    await createLocation(tenantA.id, { name: 'Warehouse South' });
    await createLocation(tenantB.id, { name: 'Other Tenant Warehouse' });

    const locationsA = await listLocations(tenantA.id);
    expect(locationsA.map((l) => l.name).sort()).toEqual(['Warehouse North', 'Warehouse South']);
  });
});
