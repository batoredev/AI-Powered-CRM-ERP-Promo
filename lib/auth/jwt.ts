import { SignJWT, jwtVerify } from 'jose';

const SESSION_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) {
    throw new Error('SESSION_JWT_SECRET is not set');
  }
  return new TextEncoder().encode(secret);
}

export interface SessionClaims {
  userId: string;
  tenantId: string;
  role: 'owner' | 'admin' | 'agent';
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TOKEN_TTL_SECONDS}s`)
    .sign(getSecret());
}

const VALID_ROLES: ReadonlyArray<SessionClaims['role']> = ['owner', 'admin', 'agent'];

export async function verifySessionToken(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, getSecret());

  // jwtVerify only guarantees signature integrity, not payload shape —
  // validate the claims we actually rely on before trusting them.
  const { userId, tenantId, role } = payload;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('Invalid session token claims');
  }
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new Error('Invalid session token claims');
  }
  if (typeof role !== 'string' || !VALID_ROLES.includes(role as SessionClaims['role'])) {
    throw new Error('Invalid session token claims');
  }

  return { userId, tenantId, role: role as SessionClaims['role'] };
}
