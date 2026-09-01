// app/pipeline/__tests__/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('../../../lib/crm/deals', () => ({
  listPipelineStages: vi.fn(),
  listDealsByStage: vi.fn(),
}));
vi.mock('../../../lib/auth/dev-tenant', () => ({
  getDevTenantId: vi.fn().mockResolvedValue('11111111-1111-1111-1111-111111111111'),
}));

import { listPipelineStages, listDealsByStage } from '../../../lib/crm/deals';
import PipelinePage from '../page';

describe('PipelinePage', () => {
  it('renders one column per pipeline stage, in sortOrder', async () => {
    (listPipelineStages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 's1', tenantId: 't1', name: 'Lead', sortOrder: 0 },
      { id: 's2', tenantId: 't1', name: 'Qualified', sortOrder: 1 },
    ]);
    (listDealsByStage as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const ui = await PipelinePage();
    render(ui);

    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(['Lead', 'Qualified']);
  });

  it('renders deals inside their matching stage column', async () => {
    (listPipelineStages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 's1', tenantId: 't1', name: 'Lead', sortOrder: 0 },
      { id: 's2', tenantId: 't1', name: 'Qualified', sortOrder: 1 },
    ]);
    (listDealsByStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      s1: [
        {
          id: 'd1',
          tenantId: 't1',
          contactId: 'c1',
          pipelineStageId: 's1',
          title: 'Acme Renewal',
          valueMinorUnits: 500000,
          currencyCode: 'USD',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    const ui = await PipelinePage();
    render(ui);

    expect(screen.getByText('Acme Renewal')).toBeInTheDocument();
  });
});
