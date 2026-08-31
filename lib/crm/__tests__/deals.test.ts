import { describe, it, expect, afterAll } from 'vitest';
import postgres from 'postgres';
import { createDeal, listDealsByStage, moveDealToStage, listPipelineStages } from '../deals';
import { createContact } from '../contacts';

const setupSql = postgres(process.env.DATABASE_URL!);
let tenantId: string;
let contactId: string;
let stageLeadId: string;
let stageWonId: string;
const createdDealIds: string[] = [];

describe('deals data access layer', () => {
  afterAll(async () => {
    if (createdDealIds.length > 0) {
      await setupSql`DELETE FROM deal WHERE id = ANY(${createdDealIds})`;
    }
    await setupSql`DELETE FROM pipeline_stage WHERE tenant_id = ${tenantId}`;
    await setupSql`DELETE FROM contact WHERE tenant_id = ${tenantId}`;
    await setupSql`DELETE FROM tenant WHERE id = ${tenantId}`;
    await setupSql.end();
  });

  it('sets up tenant, contact, and stages', async () => {
    const [tenant] = await setupSql`INSERT INTO tenant (name) VALUES ('Deals Lib Test') RETURNING id`;
    tenantId = tenant.id;
    const contact = await createContact(tenantId, { fullName: 'Deal Test Contact' });
    contactId = contact.id;
    const [lead] = await setupSql`INSERT INTO pipeline_stage (tenant_id, name, sort_order) VALUES (${tenantId}, 'Lead', 0) RETURNING id`;
    const [won] = await setupSql`INSERT INTO pipeline_stage (tenant_id, name, sort_order) VALUES (${tenantId}, 'Won', 1) RETURNING id`;
    stageLeadId = lead.id;
    stageWonId = won.id;
    expect(stageLeadId).toBeDefined();
  });

  it('creates a deal in the Lead stage', async () => {
    const deal = await createDeal(tenantId, {
      contactId,
      pipelineStageId: stageLeadId,
      title: 'Test Deal',
      valueMinorUnits: 100000,
      currencyCode: 'USD',
    });
    createdDealIds.push(deal.id);
    expect(deal.title).toBe('Test Deal');
    expect(deal.pipelineStageId).toBe(stageLeadId);
  });

  it('listDealsByStage groups deals under their stage id', async () => {
    const grouped = await listDealsByStage(tenantId);
    expect(grouped[stageLeadId]).toHaveLength(1);
    expect(grouped[stageWonId] ?? []).toHaveLength(0);
  });

  it('moveDealToStage updates the deal\'s stage', async () => {
    const dealId = createdDealIds[0];
    const moved = await moveDealToStage(tenantId, dealId, stageWonId);
    expect(moved.pipelineStageId).toBe(stageWonId);

    const grouped = await listDealsByStage(tenantId);
    expect(grouped[stageWonId]).toHaveLength(1);
    expect(grouped[stageLeadId] ?? []).toHaveLength(0);
  });

  it('listPipelineStages returns stages in sort order', async () => {
    const stages = await listPipelineStages(tenantId);
    expect(stages.map((s) => s.name)).toEqual(['Lead', 'Won']);
  });
});
