import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import {
  createTimeEntry,
  getTimeEntry,
  listTimeEntries,
  approveTimeEntry,
  markTimeEntriesBilled,
} from '../time-entries';
import { createProject } from '../projects';
import { createTask } from '../tasks';
import { createContact } from '../../crm/contacts';

const ownerSql = postgres(process.env.DATABASE_URL!);

async function setupProject(tenantId: string) {
  const contact = await createContact(tenantId, { fullName: 'Client' });
  return createProject(tenantId, { contactId: contact.id, name: 'Test Project' });
}

describe('time entry data access', () => {
  it('creates a time entry with defaults: billable=true, billed=false, approvalState=draft', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 1') RETURNING id`;
    const project = await setupProject(tenant.id);

    const entry = await createTimeEntry(tenant.id, {
      projectId: project.id,
      durationMinutes: 90,
      occurredOn: '2026-09-04',
      description: 'Homepage layout work',
    });

    expect(entry.billable).toBe(true);
    expect(entry.billed).toBe(false);
    expect(entry.approvalState).toBe('draft');
    expect(entry.taskId).toBeNull();

    const fetched = await getTimeEntry(tenant.id, entry.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.durationMinutes).toBe(90);
  });

  it('accepts an explicit billable:false and a valid taskId belonging to the same project', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 2') RETURNING id`;
    const project = await setupProject(tenant.id);
    const task = await createTask(tenant.id, { projectId: project.id, name: 'Internal review' });

    const entry = await createTimeEntry(tenant.id, {
      projectId: project.id,
      taskId: task.id,
      durationMinutes: 30,
      occurredOn: '2026-09-04',
      billable: false,
    });

    expect(entry.billable).toBe(false);
    expect(entry.taskId).toBe(task.id);
  });

  it('rejects a taskId that belongs to a different project than the one specified', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 3') RETURNING id`;
    const projectA = await setupProject(tenant.id);
    const projectB = await setupProject(tenant.id);
    const taskOnA = await createTask(tenant.id, { projectId: projectA.id, name: 'Task on A' });

    await expect(
      createTimeEntry(tenant.id, {
        projectId: projectB.id,
        taskId: taskOnA.id,
        durationMinutes: 60,
        occurredOn: '2026-09-04',
      }),
    ).rejects.toThrow();
  });

  it('rejects a projectId belonging to another tenant, with no row created', async () => {
    const [tenantA] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 4A') RETURNING id`;
    const [tenantB] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 4B') RETURNING id`;
    const otherTenantProject = await setupProject(tenantB.id);

    await expect(
      createTimeEntry(tenantA.id, {
        projectId: otherTenantProject.id,
        durationMinutes: 60,
        occurredOn: '2026-09-04',
      }),
    ).rejects.toThrow();
  });

  it('listTimeEntries filters independently by billable and billed', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 5') RETURNING id`;
    const project = await setupProject(tenant.id);

    await createTimeEntry(tenant.id, { projectId: project.id, durationMinutes: 60, occurredOn: '2026-09-01', billable: true });
    await createTimeEntry(tenant.id, { projectId: project.id, durationMinutes: 30, occurredOn: '2026-09-02', billable: false });

    const billableOnly = await listTimeEntries(tenant.id, project.id, { billable: true });
    expect(billableOnly).toHaveLength(1);
    expect(billableOnly[0].billable).toBe(true);

    const all = await listTimeEntries(tenant.id, project.id);
    expect(all).toHaveLength(2);
  });

  it('approveTimeEntry moves approvalState from draft to approved, and returns null if not currently draft', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 6') RETURNING id`;
    const project = await setupProject(tenant.id);
    const entry = await createTimeEntry(tenant.id, { projectId: project.id, durationMinutes: 45, occurredOn: '2026-09-04' });

    const approved = await approveTimeEntry(tenant.id, entry.id);
    expect(approved).not.toBeNull();
    expect(approved!.approvalState).toBe('approved');

    const secondAttempt = await approveTimeEntry(tenant.id, entry.id);
    expect(secondAttempt).toBeNull();
  });

  it('markTimeEntriesBilled only updates entries that are billable, unbilled, and approved', async () => {
    const [tenant] = await ownerSql`INSERT INTO tenant (name) VALUES ('TE Test Tenant 7') RETURNING id`;
    const project = await setupProject(tenant.id);

    const eligible = await createTimeEntry(tenant.id, { projectId: project.id, durationMinutes: 60, occurredOn: '2026-09-01' });
    await approveTimeEntry(tenant.id, eligible.id);

    const notApproved = await createTimeEntry(tenant.id, { projectId: project.id, durationMinutes: 60, occurredOn: '2026-09-02' });

    const notBillable = await createTimeEntry(tenant.id, { projectId: project.id, durationMinutes: 60, occurredOn: '2026-09-03', billable: false });
    await approveTimeEntry(tenant.id, notBillable.id);

    const result = await markTimeEntriesBilled(tenant.id, [eligible.id, notApproved.id, notBillable.id]);

    expect(result.map((r) => r.id)).toEqual([eligible.id]);
    expect(result[0].billed).toBe(true);

    const stillUnbilled = await getTimeEntry(tenant.id, notApproved.id);
    expect(stillUnbilled!.billed).toBe(false);
  });
});
