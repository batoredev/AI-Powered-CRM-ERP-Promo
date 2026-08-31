import { withTenant } from '../db/with-tenant';

export interface Deal {
  id: string;
  tenantId: string;
  contactId: string;
  pipelineStageId: string;
  title: string;
  valueMinorUnits: number | null;
  currencyCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewDeal {
  contactId: string;
  pipelineStageId: string;
  title: string;
  valueMinorUnits?: number;
  currencyCode?: string;
}

export interface PipelineStage {
  id: string;
  tenantId: string;
  name: string;
  sortOrder: number;
}

function rowToDeal(row: any): Deal {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    pipelineStageId: row.pipeline_stage_id,
    title: row.title,
    valueMinorUnits: row.value_minor_units !== null ? Number(row.value_minor_units) : null,
    currencyCode: row.currency_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToStage(row: any): PipelineStage {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

export async function createDeal(tenantId: string, input: NewDeal): Promise<Deal> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO deal (tenant_id, contact_id, pipeline_stage_id, title, value_minor_units, currency_code)
      VALUES (${tenantId}, ${input.contactId}, ${input.pipelineStageId}, ${input.title}, ${input.valueMinorUnits ?? null}, ${input.currencyCode ?? null})
      RETURNING *
    `;
    return rowToDeal(row);
  });
}

export async function listDealsByStage(tenantId: string): Promise<Record<string, Deal[]>> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM deal ORDER BY created_at DESC`;
    const grouped: Record<string, Deal[]> = {};
    for (const row of rows) {
      const deal = rowToDeal(row);
      if (!grouped[deal.pipelineStageId]) grouped[deal.pipelineStageId] = [];
      grouped[deal.pipelineStageId].push(deal);
    }
    return grouped;
  });
}

/**
 * Moves a deal to a different pipeline stage.
 *
 * Returns `null` when the UPDATE matches zero rows — either the deal id
 * doesn't exist, or it belongs to a different tenant and RLS makes it
 * invisible to this transaction. Callers must handle the null case rather
 * than assume the deal was found.
 */
export async function moveDealToStage(tenantId: string, dealId: string, stageId: string): Promise<Deal | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE deal SET pipeline_stage_id = ${stageId}, updated_at = now()
      WHERE id = ${dealId}
      RETURNING *
    `;
    return rows.length > 0 ? rowToDeal(rows[0]) : null;
  });
}

export async function listPipelineStages(tenantId: string): Promise<PipelineStage[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM pipeline_stage ORDER BY sort_order`;
    return rows.map(rowToStage);
  });
}
