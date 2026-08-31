import { withTenant } from '../db/with-tenant';

export interface Contact {
  id: string;
  tenantId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewContact {
  fullName: string;
  email?: string;
  phone?: string;
  company?: string;
}

function rowToContact(row: any): Contact {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createContact(tenantId: string, input: NewContact): Promise<Contact> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO contact (tenant_id, full_name, email, phone, company)
      VALUES (${tenantId}, ${input.fullName}, ${input.email ?? null}, ${input.phone ?? null}, ${input.company ?? null})
      RETURNING *
    `;
    return rowToContact(row);
  });
}

export async function getContact(tenantId: string, id: string): Promise<Contact | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM contact WHERE id = ${id}`;
    return rows.length > 0 ? rowToContact(rows[0]) : null;
  });
}

export async function listContacts(tenantId: string): Promise<Contact[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM contact ORDER BY created_at DESC`;
    return rows.map(rowToContact);
  });
}
