import { withTenant } from '../db/with-tenant';

export interface Vendor {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  phone: string | null;
  paymentTermsDays: number | null;
  taxId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewVendor {
  name: string;
  email?: string;
  phone?: string;
  paymentTermsDays?: number;
  taxId?: string;
}

function rowToVendor(row: any): Vendor {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    paymentTermsDays: row.payment_terms_days,
    taxId: row.tax_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createVendor(tenantId: string, input: NewVendor): Promise<Vendor> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO vendor (tenant_id, name, email, phone, payment_terms_days, tax_id)
      VALUES (${tenantId}, ${input.name}, ${input.email ?? null}, ${input.phone ?? null}, ${input.paymentTermsDays ?? null}, ${input.taxId ?? null})
      RETURNING *
    `;
    return rowToVendor(row);
  });
}

export async function getVendor(tenantId: string, id: string): Promise<Vendor | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM vendor WHERE id = ${id}`;
    return rows.length > 0 ? rowToVendor(rows[0]) : null;
  });
}

export async function listVendors(tenantId: string): Promise<Vendor[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM vendor ORDER BY created_at DESC`;
    return rows.map(rowToVendor);
  });
}
