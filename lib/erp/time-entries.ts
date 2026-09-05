import { withTenant } from '../db/with-tenant';
import { getProject } from './projects';
import { getTask } from './tasks';

export type ApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn';

export interface TimeEntry {
  id: string;
  tenantId: string;
  projectId: string;
  taskId: string | null;
  durationMinutes: number;
  occurredOn: string;
  description: string | null;
  billable: boolean;
  billed: boolean;
  approvalState: ApprovalState;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewTimeEntry {
  projectId: string;
  taskId?: string;
  durationMinutes: number;
  occurredOn: string;
  description?: string;
  billable?: boolean;
}

function rowToTimeEntry(row: any): TimeEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    taskId: row.task_id,
    durationMinutes: row.duration_minutes,
    occurredOn: row.occurred_on instanceof Date ? row.occurred_on.toISOString().slice(0, 10) : row.occurred_on,
    description: row.description,
    billable: row.billable,
    billed: row.billed,
    approvalState: row.approval_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createTimeEntry(tenantId: string, input: NewTimeEntry): Promise<TimeEntry> {
  // Validate projectId belongs to this tenant BEFORE any write — see
  // Global Constraints' FK-validation requirement, and
  // lib/erp/manufacturing-orders.ts's createManufacturingOrder for the
  // reference shape.
  const project = await getProject(tenantId, input.projectId);
  if (!project) {
    throw new Error(`Invalid project reference: ${input.projectId} does not belong to this tenant`);
  }

  if (input.taskId) {
    const task = await getTask(tenantId, input.taskId);
    if (!task) {
      throw new Error(`Invalid task reference: ${input.taskId} does not belong to this tenant`);
    }
    if (task.projectId !== input.projectId) {
      throw new Error(`Task ${input.taskId} belongs to a different project than ${input.projectId}`);
    }
  }

  const billable = input.billable ?? true;

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO time_entry (tenant_id, project_id, task_id, duration_minutes, occurred_on, description, billable)
      VALUES (${tenantId}, ${input.projectId}, ${input.taskId ?? null}, ${input.durationMinutes}, ${input.occurredOn}, ${input.description ?? null}, ${billable})
      RETURNING *
    `;
    return rowToTimeEntry(row);
  });
}

export async function getTimeEntry(tenantId: string, id: string): Promise<TimeEntry | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM time_entry WHERE id = ${id}`;
    return rows.length > 0 ? rowToTimeEntry(rows[0]) : null;
  });
}

export async function listTimeEntries(
  tenantId: string,
  projectId: string,
  filter?: { billable?: boolean; billed?: boolean },
): Promise<TimeEntry[]> {
  return withTenant(tenantId, async (tx) => {
    let rows;
    if (filter?.billable !== undefined && filter?.billed !== undefined) {
      rows = await tx`SELECT * FROM time_entry WHERE project_id = ${projectId} AND billable = ${filter.billable} AND billed = ${filter.billed} ORDER BY occurred_on ASC`;
    } else if (filter?.billable !== undefined) {
      rows = await tx`SELECT * FROM time_entry WHERE project_id = ${projectId} AND billable = ${filter.billable} ORDER BY occurred_on ASC`;
    } else if (filter?.billed !== undefined) {
      rows = await tx`SELECT * FROM time_entry WHERE project_id = ${projectId} AND billed = ${filter.billed} ORDER BY occurred_on ASC`;
    } else {
      rows = await tx`SELECT * FROM time_entry WHERE project_id = ${projectId} ORDER BY occurred_on ASC`;
    }
    return rows.map(rowToTimeEntry);
  });
}

export async function approveTimeEntry(tenantId: string, timeEntryId: string): Promise<TimeEntry | null> {
  // Atomic UPDATE ... WHERE approval_state = 'draft' RETURNING * guard —
  // same race-safe pattern as submitPurchaseOrder in
  // lib/erp/purchase-orders.ts. Returns null (rather than throwing) when
  // the entry is not currently 'draft', so a concurrent double-approve
  // is a no-op instead of a race.
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE time_entry
      SET approval_state = 'approved', updated_at = now()
      WHERE id = ${timeEntryId} AND approval_state = 'draft'
      RETURNING *
    `;
    return rows.length > 0 ? rowToTimeEntry(rows[0]) : null;
  });
}

export async function markTimeEntriesBilled(tenantId: string, timeEntryIds: string[]): Promise<TimeEntry[]> {
  // Atomic UPDATE ... WHERE billable = true AND billed = false AND
  // approval_state = 'approved' RETURNING * guard — same race-safe
  // pattern as submitPurchaseOrder in lib/erp/purchase-orders.ts. Only
  // rows that actually match all three independent conditions are
  // updated and returned; callers compare the returned array against
  // the input ids to detect entries that were skipped (already billed,
  // not billable, or not yet approved).
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE time_entry
      SET billed = true, updated_at = now()
      WHERE id = ANY(${timeEntryIds}) AND billable = true AND billed = false AND approval_state = 'approved'
      RETURNING *
    `;
    return rows.map(rowToTimeEntry);
  });
}
