import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { AppConfig } from '../config.js';
import { unauthorized } from '../lib/errors.js';

const ISSUER = 'delegate';
const APP_AUDIENCE = 'delegate-app';
const ADMIN_AUDIENCE = 'delegate-admin';

export interface VerifiedUser {
  userId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
}

/* ---------------------------- Demo-mode user tokens ---------------------------- */

export async function signDemoToken(config: AppConfig, user: { id: string; email: string; fullName: string }) {
  return new SignJWT({ email: user.email, name: user.fullName })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(APP_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(config.appJwtSecret);
}

/* ------------------------------ Admin tokens --------------------------------- */

export async function signAdminToken(config: AppConfig, email: string) {
  if (!config.admin) throw unauthorized('Admin console is not configured');
  return new SignJWT({ email, scope: 'platform-admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('platform-admin')
    .setIssuer(ISSUER)
    .setAudience(ADMIN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(config.admin.jwtSecret);
}

export async function verifyAdminToken(config: AppConfig, token: string): Promise<{ email: string }> {
  if (!config.admin) throw unauthorized('Admin console is not configured');
  try {
    const { payload } = await jwtVerify(token, config.admin.jwtSecret, { issuer: ISSUER, audience: ADMIN_AUDIENCE });
    if (payload.scope !== 'platform-admin' || typeof payload.email !== 'string') throw new Error('bad scope');
    return { email: payload.email };
  } catch {
    throw unauthorized('Admin session expired. Sign in again.');
  }
}

/* --------------------------- User token verification ------------------------- */

function fromClaims(payload: JWTPayload & Record<string, unknown>): VerifiedUser {
  const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
  const email = String(payload.email ?? meta.email ?? '');
  const fullName = String(meta.full_name ?? meta.name ?? payload.name ?? email.split('@')[0] ?? 'Teammate');
  const avatar = (meta.avatar_url ?? meta.picture ?? null) as string | null;
  if (!payload.sub) throw unauthorized('Invalid session');
  return { userId: payload.sub, email, fullName, avatarUrl: avatar };
}

export class UserTokenVerifier {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private anon: SupabaseClient | null = null;
  private cache = new Map<string, { user: VerifiedUser; expires: number }>();

  constructor(private config: AppConfig) {
    if (config.supabase) {
      this.jwks = createRemoteJWKSet(new URL(`${config.supabase.url}/auth/v1/.well-known/jwks.json`));
      this.anon = createClient(config.supabase.url, config.supabase.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  }

  async verify(token: string): Promise<VerifiedUser> {
    if (this.config.authMode === 'demo') {
      try {
        const { payload } = await jwtVerify(token, this.config.appJwtSecret, { issuer: ISSUER, audience: APP_AUDIENCE });
        return fromClaims(payload);
      } catch {
        throw unauthorized('Your session has expired. Sign in again.');
      }
    }
    return this.verifySupabase(token);
  }

  private async verifySupabase(token: string): Promise<VerifiedUser> {
    const sb = this.config.supabase!;
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(token).alg;
    } catch {
      throw unauthorized('Malformed session token');
    }

    try {
      // Legacy projects sign with a shared HS256 secret; newer ones publish asymmetric keys (JWKS).
      if (alg === 'HS256' && sb.jwtSecret) {
        const { payload } = await jwtVerify(token, new TextEncoder().encode(sb.jwtSecret), { audience: 'authenticated' });
        return fromClaims(payload);
      }
      if (alg && alg !== 'HS256' && this.jwks) {
        const { payload } = await jwtVerify(token, this.jwks, { audience: 'authenticated' });
        return fromClaims(payload);
      }
    } catch {
      throw unauthorized('Your session has expired. Sign in again.');
    }

    // Fallback: ask Supabase Auth directly (cached briefly to avoid a round-trip per request).
    const key = createHash('sha256').update(token).digest('hex');
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.user;
    const { data, error } = await this.anon!.auth.getUser(token);
    if (error || !data.user) throw unauthorized('Your session has expired. Sign in again.');
    const user = fromClaims({ ...data.user, sub: data.user.id, email: data.user.email } as never);
    this.cache.set(key, { user, expires: Date.now() + 60_000 });
    if (this.cache.size > 5_000) this.cache.clear();
    return user;
  }
}
