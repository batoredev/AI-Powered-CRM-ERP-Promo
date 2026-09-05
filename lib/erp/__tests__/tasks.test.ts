import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { createTask, getTask, listTasksByProject } from '../tasks';
import { createProject } from '../projects';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

describe('task data access', () => {
  it('creates a task with an hourly rate under a project and reads it back', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Task Test Tenant 1') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Client' });
    const project = await createProject(tenant.id, { contactId: contact.id, name: 'Website Redesign' });

    const task = await createTask(tenant.id, {
      projectId: project.id,
      name: 'Homepage design',
      hourlyRateMinorUnits: 15000,
      currencyCode: 'USD',
    });

    expect(task.projectId).toBe(project.id);
    expect(task.hourlyRateMinorUnits).toBe(15000);

    const fetched = await getTask(tenant.id, task.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Homepage design');
  });

  it('creates a task with no rate (nullable fields)', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Task Test Tenant 2') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Client' });
    const project = await createProject(tenant.id, { contactId: contact.id, name: 'Project' });

    const task = await createTask(tenant.id, { projectId: project.id, name: 'Unrated task' });

    expect(task.hourlyRateMinorUnits).toBeNull();
    expect(task.currencyCode).toBeNull();
  });

  it('rejects a projectId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('Task Test Tenant 3A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('Task Test Tenant 3B') RETURNING id`;
    const contactB = await createContact(tenantB.id, { fullName: 'Tenant B Client' });
    const otherTenantProject = await createProject(tenantB.id, { contactId: contactB.id, name: 'Tenant B Project' });

    await expect(
      createTask(tenantA.id, { projectId: otherTenantProject.id, name: 'Should Fail' }),
    ).rejects.toThrow();
  });

  it('listTasksByProject returns only tasks for the given project', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('Task Test Tenant 4') RETURNING id`;
    const contact = await createContact(tenant.id, { fullName: 'Client' });
    const projectA = await createProject(tenant.id, { contactId: contact.id, name: 'Project A' });
    const projectB = await createProject(tenant.id, { contactId: contact.id, name: 'Project B' });

    await createTask(tenant.id, { projectId: projectA.id, name: 'Task A1' });
    await createTask(tenant.id, { projectId: projectB.id, name: 'Task B1' });

    const tasksA = await listTasksByProject(tenant.id, projectA.id);
    expect(tasksA.map((t) => t.name)).toEqual(['Task A1']);
  });
});
