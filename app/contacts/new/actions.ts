'use server';

import { redirect } from 'next/navigation';
import { createContact } from '../../../lib/crm/contacts';
import { getDevTenantId } from '../../../lib/auth/dev-tenant';

export async function createContactAction(formData: FormData) {
  const fullName = formData.get('fullName');
  if (typeof fullName !== 'string' || fullName.trim().length === 0) {
    throw new Error('Full name is required');
  }

  const tenantId = await getDevTenantId();
  const email = formData.get('email');
  const phone = formData.get('phone');
  const company = formData.get('company');

  const contact = await createContact(tenantId, {
    fullName: fullName.trim(),
    email: typeof email === 'string' && email.trim() ? email.trim() : undefined,
    phone: typeof phone === 'string' && phone.trim() ? phone.trim() : undefined,
    company: typeof company === 'string' && company.trim() ? company.trim() : undefined,
  });

  redirect(`/contacts/${contact.id}`);
}
