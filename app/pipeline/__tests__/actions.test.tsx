// app/pipeline/__tests__/actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));
vi.mock('../../../lib/crm/deals', () => ({
  listPipelineStages: vi.fn(),
  moveDealToStage: vi.fn(),
}));
vi.mock('../../../lib/auth/dev-tenant', () => ({
  getDevTenantId: vi.fn().mockResolvedValue('11111111-1111-1111-1111-111111111111'),
}));

import { listPipelineStages, moveDealToStage } from '../../../lib/crm/deals';
import { moveDealAction } from '../actions';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const stages = [
  { id: 's1', tenantId: TENANT_ID, name: 'Lead', sortOrder: 0 },
  { id: 's2', tenantId: TENANT_ID, name: 'Qualified', sortOrder: 1 },
];

describe('moveDealAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listPipelineStages as ReturnType<typeof vi.fn>).mockResolvedValue(stages);
  });

  it('rejects a stageId that does not belong to the tenant, without calling moveDealToStage', async () => {
    const foreignStageId = 'stage-owned-by-another-tenant';

    await expect(moveDealAction('d1', foreignStageId)).rejects.toThrow('Invalid pipeline stage.');

    expect(moveDealToStage).not.toHaveBeenCalled();
  });

  it('moves the deal when stageId belongs to the tenant', async () => {
    (moveDealToStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'd1',
      tenantId: TENANT_ID,
      contactId: 'c1',
      pipelineStageId: 's2',
      title: 'Acme Renewal',
      valueMinorUnits: 500000,
      currencyCode: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await moveDealAction('d1', 's2');

    expect(moveDealToStage).toHaveBeenCalledWith(TENANT_ID, 'd1', 's2');
  });
});
