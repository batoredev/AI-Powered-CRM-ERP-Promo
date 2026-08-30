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

export async function verifySessionToken(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, getSecret());
  return {
    userId: payload.userId as string,
    tenantId: payload.tenantId as string,
    role: payload.role as SessionClaims['role'],
  };
}
