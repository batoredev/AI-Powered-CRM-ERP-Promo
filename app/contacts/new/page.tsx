import { createContactAction } from './actions';
import styles from './page.module.css';

export default function NewContactPage() {
  return (
    <div>
      <h1 className={styles.heading}>New Contact</h1>
      <form action={createContactAction} className={styles.form}>
        <label className={styles.field}>
          <span>Full name</span>
          <input type="text" name="fullName" required autoFocus />
        </label>
        <label className={styles.field}>
          <span>Email</span>
          <input type="email" name="email" />
        </label>
        <label className={styles.field}>
          <span>Phone</span>
          <input type="tel" name="phone" />
        </label>
        <label className={styles.field}>
          <span>Company</span>
          <input type="text" name="company" />
        </label>
        <button type="submit" className={styles.submit}>
          Create Contact
        </button>
      </form>
    </div>
  );
}
