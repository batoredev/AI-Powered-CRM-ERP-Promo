import { withTenant } from '../db/with-tenant';

export type RecurringTemplateType = 'scheduled' | 'reminder' | 'unscheduled';
export type IntervalUnit = 'weeks' | 'months' | 'years';
export type ApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'withdrawn';

export interface RecurringTemplate {
  id: string;
  tenantId: string;
  documentType: string;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  nextRunDate: string;
  type: RecurringTemplateType;
  approvalState: ApprovalState;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewRecurringTemplate {
  documentType: string;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  nextRunDate: string;
  type: RecurringTemplateType;
}

function rowToRecurringTemplate(row: any): RecurringTemplate {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    documentType: row.document_type,
    intervalUnit: row.interval_unit,
    intervalCount: Number(row.interval_count),
    nextRunDate: row.next_run_date instanceof Date ? row.next_run_date.toISOString().slice(0, 10) : row.next_run_date,
    type: row.type,
    approvalState: row.approval_state,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createRecurringTemplate(tenantId: string, input: NewRecurringTemplate): Promise<RecurringTemplate> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO recurring_template (tenant_id, document_type, interval_unit, interval_count, next_run_date, type)
      VALUES (${tenantId}, ${input.documentType}, ${input.intervalUnit}, ${input.intervalCount}, ${input.nextRunDate}, ${input.type})
      RETURNING *
    `;
    return rowToRecurringTemplate(row);
  });
}

export async function getRecurringTemplate(tenantId: string, id: string): Promise<RecurringTemplate | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM recurring_template WHERE id = ${id}`;
    return rows.length > 0 ? rowToRecurringTemplate(rows[0]) : null;
  });
}

export async function listRecurringTemplates(tenantId: string): Promise<RecurringTemplate[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM recurring_template ORDER BY created_at DESC`;
    return rows.map(rowToRecurringTemplate);
  });
}

export async function deactivateRecurringTemplate(tenantId: string, id: string): Promise<RecurringTemplate | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE recurring_template
      SET is_active = false, updated_at = now()
      WHERE id = ${id} AND is_active = true
      RETURNING *
    `;
    return rows.length > 0 ? rowToRecurringTemplate(rows[0]) : null;
  });
}
