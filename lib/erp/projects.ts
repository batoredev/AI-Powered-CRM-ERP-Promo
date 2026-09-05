import { withTenant } from '../db/with-tenant';
import { getContact } from '../crm/contacts';

export interface Project {
  id: string;
  tenantId: string;
  contactId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProject {
  contactId: string;
  name: string;
}

function rowToProject(row: any): Project {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createProject(tenantId: string, input: NewProject): Promise<Project> {
  // Validate contactId belongs to this tenant BEFORE any write — see
  // Global Constraints' FK-validation requirement, and
  // lib/erp/manufacturing-orders.ts's createManufacturingOrder for the
  // reference shape.
  const contact = await getContact(tenantId, input.contactId);
  if (!contact) {
    throw new Error(`Invalid contact reference: ${input.contactId} does not belong to this tenant`);
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO project (tenant_id, contact_id, name)
      VALUES (${tenantId}, ${input.contactId}, ${input.name})
      RETURNING *
    `;
    return rowToProject(row);
  });
}

export async function getProject(tenantId: string, id: string): Promise<Project | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM project WHERE id = ${id}`;
    return rows.length > 0 ? rowToProject(rows[0]) : null;
  });
}

export async function listProjects(tenantId: string): Promise<Project[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM project ORDER BY created_at DESC`;
    return rows.map(rowToProject);
  });
}
