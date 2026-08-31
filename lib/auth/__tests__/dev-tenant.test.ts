import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from 'vitest';
import postgres from 'postgres';
import { getDevTenantId } from '../dev-tenant';

const setupSql = postgres(process.env.DATABASE_URL!);

describe('getDevTenantId', () => {
  afterAll(async () => {
    await setupSql.end();
  });

  it('returns a valid tenant id that exists in the database', async () => {
    const tenantId = await getDevTenantId();
    expect(tenantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const rows = await setupSql`SELECT id FROM tenant WHERE id = ${tenantId}`;
    expect(rows).toHaveLength(1);
  });

  it('returns the same tenant id on repeated calls (idempotent)', async () => {
    const first = await getDevTenantId();
    const second = await getDevTenantId();
    expect(first).toBe(second);
  });
});

describe('getDevTenantId fail-closed NODE_ENV guard', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws immediately when NODE_ENV is production, before touching the database', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    // Fresh module instance (via resetModules) so the module-level
    // devSqlInstance/cachedDevTenantId singletons from the describe block
    // above cannot mask the guard — this call must fail on its own.
    const { getDevTenantId: freshGetDevTenantId } = await import('../dev-tenant');
    await expect(freshGetDevTenantId()).rejects.toThrow(/must only run in development or test/);
  });

  it('throws for an unexpected NODE_ENV value like "staging" (fail-closed, not just production)', async () => {
    vi.stubEnv('NODE_ENV', 'staging');
    const { getDevTenantId: freshGetDevTenantId } = await import('../dev-tenant');
    await expect(freshGetDevTenantId()).rejects.toThrow(/must only run in development or test/);
  });

  it('throws when NODE_ENV is unset (fail-closed default, not fail-open)', async () => {
    vi.stubEnv('NODE_ENV', undefined);
    const { getDevTenantId: freshGetDevTenantId } = await import('../dev-tenant');
    await expect(freshGetDevTenantId()).rejects.toThrow(/must only run in development or test/);
  });
});
