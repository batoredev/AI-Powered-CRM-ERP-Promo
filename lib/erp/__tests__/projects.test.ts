import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createProject, getProject, listProjects } from '../projects';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('project data access', () => {
  it('creates a project linked to a contact and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Project Test Tenant 1') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Acme Corp Contact' });

    const project = await createProject(tenant.id, { contactId: contact.id, name: 'Website Redesign' });

    expect(project.contactId).toBe(contact.id);
    expect(project.name).toBe('Website Redesign');

    const fetched = await getProject(tenant.id, project.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Website Redesign');
  });

  it('rejects a contactId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Project Test Tenant 2A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Project Test Tenant 2B') RETURNING id`;
    const otherTenantContact = await createContact(tenantB.id, { fullName: 'Tenant B Contact' });

    await expect(
      createProject(tenantA.id, { contactId: otherTenantContact.id, name: 'Should Fail' }),
    ).rejects.toThrow();

    const projectsA = await listProjects(tenantA.id);
    expect(projectsA).toHaveLength(0);
  });

  it('returns null from getProject for a nonexistent id', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Project Test Tenant 3') RETURNING id`;
    const result = await getProject(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
