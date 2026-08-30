import { describe, it, expect } from 'vitest';
import { signSessionToken, verifySessionToken } from '../jwt';

describe('session JWT', () => {
  it('round-trips tenant id and role through sign/verify', async () => {
    const token = await signSessionToken({
      userId: 'user-1',
      tenantId: '11111111-1111-1111-1111-111111111111',
      role: 'owner',
    });
    const claims = await verifySessionToken(token);
    expect(claims.userId).toBe('user-1');
    expect(claims.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(claims.role).toBe('owner');
  });

  it('rejects a tampered token', async () => {
    const token = await signSessionToken({
      userId: 'user-1',
      tenantId: '11111111-1111-1111-1111-111111111111',
      role: 'owner',
    });
    const tampered = token.slice(0, -5) + 'XXXXX';
    await expect(verifySessionToken(tampered)).rejects.toThrow();
  });
});
