'use client';

import styles from './error.module.css';

// Next.js App Router error boundary convention: a client component default-
// exporting a component that receives { error, reset }. This is a general
// safety net for any uncaught error thrown during rendering or in a Server
// Action's response path (e.g. createContactAction's validation Error in
// app/contacts/new/actions.ts) — not specific to any one route.
// https://nextjs.org/docs/app/building-your-application/routing/error-handling
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.message}>
          {error.message || 'An unexpected error occurred. Please try again.'}
        </p>
        <button type="button" className={styles.button} onClick={() => reset()}>
          Try again
        </button>
      </div>
    </div>
  );
}
