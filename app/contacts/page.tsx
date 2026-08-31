import Link from 'next/link';
import { listContacts } from '../../lib/crm/contacts';
import { getDevTenantId } from '../../lib/auth/dev-tenant';
import styles from './page.module.css';

export default async function ContactsPage() {
  const tenantId = await getDevTenantId();
  const contacts = await listContacts(tenantId);

  return (
    <div>
      <h1 className={styles.heading}>Contacts</h1>
      {contacts.length === 0 ? (
        <p className={styles.emptyState}>No contacts yet. Add your first contact to get started.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <td>
                  <Link href={`/contacts/${contact.id}`} className={styles.contactLink}>
                    {contact.fullName}
                  </Link>
                </td>
                <td>{contact.email ?? '—'}</td>
                <td>{contact.company ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
