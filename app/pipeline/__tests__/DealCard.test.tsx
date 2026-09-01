// app/pipeline/__tests__/DealCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const moveDealActionMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../actions', () => ({
  moveDealAction: (...args: unknown[]) => moveDealActionMock(...args),
}));

import { DealCard } from '../DealCard';

const deal = {
  id: 'd1',
  tenantId: 't1',
  contactId: 'c1',
  pipelineStageId: 's1',
  title: 'Acme Renewal',
  valueMinorUnits: 500000,
  currencyCode: 'USD',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const stages = [
  { id: 's1', tenantId: 't1', name: 'Lead', sortOrder: 0 },
  { id: 's2', tenantId: 't1', name: 'Qualified', sortOrder: 1 },
];

describe('DealCard', () => {
  it('renders the deal title and a stage select defaulting to its current stage', () => {
    render(<DealCard deal={deal} stages={stages} />);

    expect(screen.getByText('Acme Renewal')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: /move .*acme renewal.* to stage/i });
    expect(select).toHaveValue('s1');
  });

  it('calls moveDealAction with the deal id and the newly selected stage id on change', () => {
    render(<DealCard deal={deal} stages={stages} />);

    const select = screen.getByRole('combobox', { name: /move .*acme renewal.* to stage/i });
    fireEvent.change(select, { target: { value: 's2' } });

    expect(moveDealActionMock).toHaveBeenCalledWith('d1', 's2');
  });
});
