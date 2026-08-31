import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { signSessionToken, verifySessionToken } from '../jwt';

function getTestSecret(): Uint8Array {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) {
    throw new Error('SESSION_JWT_SECRET is not set');
  }
  return new TextEncoder().encode(secret);
}

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

  it('rejects a validly-signed token with a malformed tenantId claim', async () => {
    // Built directly with jose, bypassing signSessionToken's type safety,
    // to simulate a payload this codebase's own signer could never produce.
    const token = await new SignJWT({
      userId: 'user-1',
      tenantId: 12345, // should be a string
      role: 'owner',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(getTestSecret());

    await expect(verifySessionToken(token)).rejects.toThrow('Invalid session token claims');
  });

  it('rejects a validly-signed token with a missing role claim', async () => {
    const token = await new SignJWT({
      userId: 'user-1',
      tenantId: '11111111-1111-1111-1111-111111111111',
      // role omitted entirely
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(getTestSecret());

    await expect(verifySessionToken(token)).rejects.toThrow('Invalid session token claims');
  });

  it('rejects a validly-signed token with an invalid role value', async () => {
    const token = await new SignJWT({
      userId: 'user-1',
      tenantId: '11111111-1111-1111-1111-111111111111',
      role: 'superadmin', // not one of owner | admin | agent
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(getTestSecret());

    await expect(verifySessionToken(token)).rejects.toThrow('Invalid session token claims');
  });
});
