import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('../../../lib/crm/contacts', () => ({
  listContacts: vi.fn(),
}));
vi.mock('../../../lib/auth/dev-tenant', () => ({
  getDevTenantId: vi.fn().mockResolvedValue('11111111-1111-1111-1111-111111111111'),
}));

import { listContacts } from '../../../lib/crm/contacts';
import ContactsPage from '../page';

describe('ContactsPage', () => {
  it('renders a table of contacts when there are some', async () => {
    (listContacts as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'c1',
        tenantId: 't1',
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phone: null,
        company: 'Acme Inc',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const ui = await ContactsPage();
    render(ui);

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Acme Inc')).toBeInTheDocument();
  });

  it('renders a friendly empty state when there are no contacts', async () => {
    (listContacts as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const ui = await ContactsPage();
    render(ui);

    expect(screen.getByText(/no contacts yet/i)).toBeInTheDocument();
  });
});
