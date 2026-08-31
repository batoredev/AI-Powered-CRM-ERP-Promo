import { getContact } from '../../../lib/crm/contacts';
import { getDevTenantId } from '../../../lib/auth/dev-tenant';
import styles from './page.module.css';

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantId = await getDevTenantId();
  const contact = await getContact(tenantId, id);

  if (!contact) {
    return <p className={styles.notFound}>Contact not found.</p>;
  }

  return (
    <div>
      <h1 className={styles.name}>{contact.fullName}</h1>
      <dl className={styles.details}>
        <dt>Email</dt>
        <dd>{contact.email ?? '—'}</dd>
        <dt>Phone</dt>
        <dd>{contact.phone ?? '—'}</dd>
        <dt>Company</dt>
        <dd>{contact.company ?? '—'}</dd>
      </dl>
    </div>
  );
}
