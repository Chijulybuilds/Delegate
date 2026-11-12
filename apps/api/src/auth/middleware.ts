import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isManagerRole, type MemberRole, type Organization, type Profile } from '@delegate/shared';
import type { AppConfig } from '../config.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { Store } from '../store/types.js';
import { verifyAdminToken, type UserTokenVerifier } from './tokens.js';

export interface MemberContext {
  orgId: string;
  org: Organization;
  role: MemberRole;
  departmentId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: Profile;
      member?: MemberContext;
      admin?: { email: string };
    }
  }
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Authenticates a workspace user (Supabase session or demo token) and loads their profile. */
export function requireUser(store: Store, verifier: UserTokenVerifier): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const claims = await verifier.verify(token);
    let profile = await store.getProfile(claims.userId);
    if (!profile) {
      // First request after Google sign-in (the DB trigger normally creates this row already).
      profile = await store.upsertProfile({
        id: claims.userId,
        email: claims.email,
        fullName: claims.fullName,
        avatarUrl: claims.avatarUrl,
      });
    }
    if (profile.status === 'suspended') throw forbidden('This account has been suspended. Contact support.');
    req.user = profile;
    next();
  };
}

/** Requires the user to belong to an active workspace. Must run after requireUser. */
export function requireMember(store: Store): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    const m = await store.getMembershipForUser(req.user.id);
    if (!m) throw forbidden('Join or create a workspace first');
    const org = await store.getOrg(m.orgId);
    if (!org) throw forbidden('Workspace not found');
    if (org.status === 'suspended') throw forbidden('This workspace is suspended. Contact support.');
    req.member = { orgId: m.orgId, org, role: m.role, departmentId: m.departmentId };
    next();
  };
}

export const requireManager: RequestHandler = (req, _res, next) => {
  if (!isManagerRole(req.member?.role)) throw forbidden('Only managers can do that');
  next();
};

/** Platform admin console guard. Admin tokens are signed with a separate secret and audience. */
export function requireAdmin(config: AppConfig): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) throw unauthorized('Admin sign-in required');
    req.admin = await verifyAdminToken(config, token);
    next();
  };
}
