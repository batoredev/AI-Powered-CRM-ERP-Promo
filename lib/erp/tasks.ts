import { withTenant } from '../db/with-tenant';
import { getProject } from './projects';

export interface Task {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  hourlyRateMinorUnits: number | null;
  currencyCode: string | null;
  createdAt: Date;
}

export interface NewTask {
  projectId: string;
  name: string;
  hourlyRateMinorUnits?: number;
  currencyCode?: string;
}

function rowToTask(row: any): Task {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    name: row.name,
    hourlyRateMinorUnits: row.hourly_rate_minor_units !== null ? Number(row.hourly_rate_minor_units) : null,
    currencyCode: row.currency_code,
    createdAt: row.created_at,
  };
}

export async function createTask(tenantId: string, input: NewTask): Promise<Task> {
  // Validate projectId belongs to this tenant BEFORE any write — see
  // Global Constraints' FK-validation requirement, and
  // lib/erp/manufacturing-orders.ts's createManufacturingOrder for the
  // reference shape.
  const project = await getProject(tenantId, input.projectId);
  if (!project) {
    throw new Error(`Invalid project reference: ${input.projectId} does not belong to this tenant`);
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO task (tenant_id, project_id, name, hourly_rate_minor_units, currency_code)
      VALUES (${tenantId}, ${input.projectId}, ${input.name}, ${input.hourlyRateMinorUnits ?? null}, ${input.currencyCode ?? null})
      RETURNING *
    `;
    return rowToTask(row);
  });
}

export async function getTask(tenantId: string, id: string): Promise<Task | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM task WHERE id = ${id}`;
    return rows.length > 0 ? rowToTask(rows[0]) : null;
  });
}

export async function listTasksByProject(tenantId: string, projectId: string): Promise<Task[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM task WHERE project_id = ${projectId} ORDER BY created_at ASC`;
    return rows.map(rowToTask);
  });
}
