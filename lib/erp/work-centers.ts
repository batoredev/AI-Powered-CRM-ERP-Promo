import { withTenant } from '../db/with-tenant';

export interface WorkCenter {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
}

export interface NewWorkCenter {
  name: string;
}

function rowToWorkCenter(row: any): WorkCenter {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

export async function createWorkCenter(tenantId: string, input: NewWorkCenter): Promise<WorkCenter> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO work_center (tenant_id, name)
      VALUES (${tenantId}, ${input.name})
      RETURNING *
    `;
    return rowToWorkCenter(row);
  });
}

export async function getWorkCenter(tenantId: string, id: string): Promise<WorkCenter | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM work_center WHERE id = ${id}`;
    return rows.length > 0 ? rowToWorkCenter(rows[0]) : null;
  });
}

export async function listWorkCenters(tenantId: string): Promise<WorkCenter[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM work_center ORDER BY created_at ASC`;
    return rows.map(rowToWorkCenter);
  });
}
