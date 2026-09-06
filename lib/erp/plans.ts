import { withTenant } from '../db/with-tenant';
import { getRecurringTemplate } from './recurring-templates';

export interface Plan {
  id: string;
  tenantId: string;
  name: string;
  priceMinorUnits: number;
  currencyCode: string;
  recurringTemplateId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewPlan {
  name: string;
  priceMinorUnits: number;
  currencyCode: string;
  recurringTemplateId: string;
}

function rowToPlan(row: any): Plan {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    priceMinorUnits: Number(row.price_minor_units),
    currencyCode: row.currency_code,
    recurringTemplateId: row.recurring_template_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createPlan(tenantId: string, input: NewPlan): Promise<Plan> {
  const template = await getRecurringTemplate(tenantId, input.recurringTemplateId);
  if (!template) {
    throw new Error(`Invalid recurring template reference: ${input.recurringTemplateId} does not belong to this tenant`);
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO plan (tenant_id, name, price_minor_units, currency_code, recurring_template_id)
      VALUES (${tenantId}, ${input.name}, ${input.priceMinorUnits}, ${input.currencyCode}, ${input.recurringTemplateId})
      RETURNING *
    `;
    return rowToPlan(row);
  });
}

export async function getPlan(tenantId: string, id: string): Promise<Plan | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM plan WHERE id = ${id}`;
    return rows.length > 0 ? rowToPlan(rows[0]) : null;
  });
}

export async function listPlans(tenantId: string): Promise<Plan[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM plan ORDER BY created_at DESC`;
    return rows.map(rowToPlan);
  });
}
