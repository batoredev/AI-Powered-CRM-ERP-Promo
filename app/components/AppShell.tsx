import Link from 'next/link';
import styles from '../shell.module.css';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar}>
        <div className={styles.logo}>AI CRM+ERP</div>
        <Link href="/contacts" className={styles.navLink}>
          Contacts
        </Link>
        <Link href="/pipeline" className={styles.navLink}>
          Pipeline
        </Link>
      </nav>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
