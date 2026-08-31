import { describe, it, expect, afterAll } from 'vitest';
import postgres from 'postgres';
import { createContact, getContact, listContacts } from '../contacts';

const setupSql = postgres(process.env.DATABASE_URL!);
let tenantId: string;
const createdContactIds: string[] = [];

describe('contacts data access layer', () => {
  afterAll(async () => {
    if (createdContactIds.length > 0) {
      await setupSql`DELETE FROM contact WHERE id = ANY(${createdContactIds})`;
    }
    if (tenantId) {
      await setupSql`DELETE FROM tenant WHERE id = ${tenantId}`;
    }
    await setupSql.end();
  });

  it('creates and retrieves a contact scoped to a tenant', async () => {
    const [tenant] = await setupSql`INSERT INTO tenant (name) VALUES ('Contacts Lib Test') RETURNING id`;
    tenantId = tenant.id;

    const created = await createContact(tenantId, { fullName: 'Jane Doe', email: 'jane@example.test' });
    createdContactIds.push(created.id);
    expect(created.fullName).toBe('Jane Doe');
    expect(created.email).toBe('jane@example.test');

    const fetched = await getContact(tenantId, created.id);
    expect(fetched?.id).toBe(created.id);
  });

  it('listContacts only returns the calling tenant\'s contacts', async () => {
    const [otherTenant] = await setupSql`INSERT INTO tenant (name) VALUES ('Contacts Lib Test Other') RETURNING id`;
    try {
      const otherContact = await createContact(otherTenant.id, { fullName: 'Other Tenant Contact' });
      const list = await listContacts(tenantId);
      expect(list.find((c) => c.id === otherContact.id)).toBeUndefined();
      await setupSql`DELETE FROM contact WHERE id = ${otherContact.id}`;
    } finally {
      await setupSql`DELETE FROM tenant WHERE id = ${otherTenant.id}`;
    }
  });

  it('getContact returns null for a non-existent id', async () => {
    const result = await getContact(tenantId, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
