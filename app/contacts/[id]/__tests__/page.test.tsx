import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('../../../../lib/crm/contacts', () => ({
  getContact: vi.fn(),
}));
vi.mock('../../../../lib/auth/dev-tenant', () => ({
  getDevTenantId: vi.fn().mockResolvedValue('11111111-1111-1111-1111-111111111111'),
}));

import { getContact } from '../../../../lib/crm/contacts';
import ContactDetailPage from '../page';

describe('ContactDetailPage', () => {
  it('renders the contact\'s details when found', async () => {
    (getContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '555-1234',
      company: 'Acme Inc',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ui = await ContactDetailPage({ params: Promise.resolve({ id: 'c1' }) });
    render(ui);

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('555-1234')).toBeInTheDocument();
  });

  it('renders a not-found message when the contact does not exist', async () => {
    (getContact as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const ui = await ContactDetailPage({ params: Promise.resolve({ id: 'missing' }) });
    render(ui);

    expect(screen.getByText(/contact not found/i)).toBeInTheDocument();
  });
});
