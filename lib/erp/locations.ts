import { withTenant } from '../db/with-tenant';

export interface Location {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
}

export interface NewLocation {
  name: string;
}

function rowToLocation(row: any): Location {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

export async function createLocation(tenantId: string, input: NewLocation): Promise<Location> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO location (tenant_id, name)
      VALUES (${tenantId}, ${input.name})
      RETURNING *
    `;
    return rowToLocation(row);
  });
}

export async function getLocation(tenantId: string, id: string): Promise<Location | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM location WHERE id = ${id}`;
    return rows.length > 0 ? rowToLocation(rows[0]) : null;
  });
}

export async function listLocations(tenantId: string): Promise<Location[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM location ORDER BY created_at ASC`;
    return rows.map(rowToLocation);
  });
}
