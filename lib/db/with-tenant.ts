import type postgres from 'postgres';
import { getSql } from './connection';

/**
 * Runs `fn` inside a single Postgres transaction with tenant context set
 * via SET LOCAL (transaction-scoped, never connection-scoped — spec §3's
 * round-4 fix). This is the ONLY sanctioned way to run a tenant-scoped
 * query anywhere in this codebase — no other code path may call
 * getSql() directly for tenant data.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const sql = getSql();
  // postgres.js types `begin`'s return as Promise<UnwrapPromiseArray<T>>,
  // which only differs from Promise<T> when T is itself an array type —
  // not the case for any caller of withTenant. The cast reconciles that
  // library-typing quirk with our (correct, narrower) public signature.
  return sql.begin<T>(async (tx) => {
    await tx`SELECT set_tenant_context(${tenantId}::uuid)`;
    return fn(tx);
  }) as Promise<T>;
}
