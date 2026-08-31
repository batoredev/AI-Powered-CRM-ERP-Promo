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
    // This assertion checks listDealsByStage's actual grouping/ordering
    // behavior, which inherently requires looking at the tenant's full
    // result set (not individually-scoped ids) — so instead we assert the
    // precondition this test relies on: this tenant has exactly the deal(s)
    // this suite itself created, and nothing else (e.g. from future
    // default-seeding of pipeline stages/deals for new tenants). If that
    // precondition ever breaks, this fails here with a clear message
    // instead of silently invalidating the exact-count assertions below.
    const allDealsForTenant = await listDealsByStage(tenantId);
    const totalDealCount = Object.values(allDealsForTenant).reduce((sum, deals) => sum + deals.length, 0);
    expect(totalDealCount, 'expected this test to be the sole creator of deal rows for this tenant').toBe(
      createdDealIds.length
    );

    const grouped = await listDealsByStage(tenantId);
    expect(grouped[stageLeadId]).toHaveLength(1);
    expect(grouped[stageWonId] ?? []).toHaveLength(0);
  });

  it('moveDealToStage updates the deal\'s stage', async () => {
    const dealId = createdDealIds[0];
    const moved = await moveDealToStage(tenantId, dealId, stageWonId);
    expect(moved).not.toBeNull();
    expect(moved!.pipelineStageId).toBe(stageWonId);

    const grouped = await listDealsByStage(tenantId);
    expect(grouped[stageWonId]).toHaveLength(1);
    expect(grouped[stageLeadId] ?? []).toHaveLength(0);
  });

  it('moveDealToStage returns null for a nonexistent or inaccessible deal id', async () => {
    const nonexistentDealId = '00000000-0000-4000-8000-000000000000';
    const result = await moveDealToStage(tenantId, nonexistentDealId, stageWonId);
    expect(result).toBeNull();
  });

  it('listPipelineStages returns stages in sort order', async () => {
    // Sanity check this test's precondition: this suite created exactly
    // two pipeline stages for this tenant. If a future change (e.g.
    // default-seeded pipeline stages for new tenants) adds more, this
    // fails here with a clear message instead of the exact-match assertion
    // below silently breaking for an unrelated reason.
    const allStages = await listPipelineStages(tenantId);
    expect(allStages, 'expected this test to be the sole creator of pipeline_stage rows for this tenant').toHaveLength(2);

    const stages = await listPipelineStages(tenantId);
    expect(stages.map((s) => s.name)).toEqual(['Lead', 'Won']);
  });
});
