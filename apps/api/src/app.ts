import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { requireMember, requireUser } from './auth/middleware.js';
import { UserTokenVerifier } from './auth/tokens.js';
import type { AppConfig } from './config.js';
import { Secrets } from './lib/crypto.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { adminRoutes, cronRoutes } from './routes/admin.js';
import { hookRoutes } from './routes/hooks.js';
import { publicRoutes } from './routes/public.js';
import { oauthRoutes, saasRoutes } from './routes/saas.js';
import { workspaceRoutes } from './routes/workspace.js';
import { AdminService } from './services/admin.js';
import { disabledVerifier, type ProofVerifier } from './services/ai.js';
import { AutomationService } from './services/automation.js';
import { BillingService } from './services/billing.js';
import type { Http } from './services/channels.js';
import { CommandService } from './services/commands.js';
import { DriveService } from './services/drive.js';
import { IntegrationService } from './services/integrations.js';
import { createMailer, type Mailer } from './services/mail.js';
import { MetricsService } from './services/metrics.js';
import { Notifier } from './services/notify.js';
import { WorkspaceService } from './services/workspace.js';
import type { Store } from './store/types.js';

export interface AppDeps {
  config: AppConfig;
  store: Store;
  ai?: ProofVerifier;
  mailer?: Mailer;
  /** Outbound HTTP for providers (Stripe, Paystack, Slack, Meta, Google). Injected in tests. */
  http?: Http;
  /** Absolute path to the built web app. When set, the API also serves the SPA. */
  webDist?: string | null;
}

export interface Services {
  workspace: WorkspaceService;
  billing: BillingService;
  integrations: IntegrationService;
  automation: AutomationService;
  notifier: Notifier;
}

export function createServices({ config, store, ai = disabledVerifier, mailer = createMailer(config), http = fetch }: AppDeps) {
  const secrets = new Secrets(config.encryptionKey);
  const billing = new BillingService(store, config, http, async (orgId, summary) => {
    const owners = (await store.listMembers(orgId)).filter((m) => m.role === 'owner');
    await store.insertNotifications(owners.map((o) => ({ orgId, userId: o.userId, type: 'billing' as const, title: 'Billing updated', body: summary, taskId: null })));
  });
  const notifier = new Notifier(store, config, secrets, (orgId) => billing.entitlements(orgId), http);
  const drive = new DriveService(config, http);
  const workspace = new WorkspaceService({ store, verifier: ai, notifier, billing, drive });
  const commands = new CommandService(store, workspace);
  const integrations = new IntegrationService(store, config, secrets, notifier, workspace, commands, billing, http);
  const metrics = new MetricsService(store);
  const automation = new AutomationService(store, workspace, notifier, billing, metrics, mailer);
  const admin = new AdminService(store);
  return { secrets, billing, notifier, drive, workspace, commands, integrations, metrics, automation, admin, mailer, ai };
}

export function createApp(deps: AppDeps): Express & { services: Services } {
  const { config, store, webDist = null } = deps;
  const s = createServices(deps);
  const app = express() as Express & { services: Services };
  app.services = s;
  app.disable('x-powered-by');
  // Behind one reverse proxy (Vercel, Render, nginx on Hostinger) so rate limits see real client IPs.
  app.set('trust proxy', 1);

  const supabaseOrigin = config.supabase?.url ?? null;
  const google = config.google ? ['https://apis.google.com', 'https://accounts.google.com'] : [];
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", ...google],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: [
            "'self'",
            ...(supabaseOrigin ? [supabaseOrigin, supabaseOrigin.replace(/^https/, 'wss')] : []),
            ...(config.google ? ['https://www.googleapis.com', 'https://content.googleapis.com', 'https://accounts.google.com'] : []),
          ],
          frameSrc: config.google ? ['https://docs.google.com', 'https://accounts.google.com', 'https://content.googleapis.com'] : ["'none'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : [])],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: config.google ? { policy: 'same-origin-allow-popups' } : undefined,
    }),
  );

  // Same-origin in dev (Vite proxy) and in single-server production; CORS only matters for split deploys.
  app.use('/api', cors({ origin: config.corsOrigins.length ? config.corsOrigins : false, credentials: false, maxAge: 600 }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Webhooks first, with the raw body (signatures are over exact bytes) and no IP rate limit.
  app.use('/api/hooks', express.raw({ type: () => true, limit: '2mb' }), hookRoutes({ billing: s.billing, integrations: s.integrations }));

  app.use(express.json({ limit: '256kb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }));

  const verifier = new UserTokenVerifier(config);
  app.use('/api', publicRoutes({ config, store, verifier, ai: s.ai, workspace: s.workspace }));
  app.use('/api/admin', adminRoutes({ config, admin: s.admin }));
  app.use('/api/cron', cronRoutes({ config, automation: s.automation }));
  app.use('/api', oauthRoutes(s.integrations));

  // Everything below needs a signed-in member of an active workspace (checked once per request).
  const member = Router();
  member.use(requireUser(store, verifier), requireMember(store));
  member.use(saasRoutes({ store, billing: s.billing, integrations: s.integrations, automation: s.automation, workspace: s.workspace, drive: s.drive }));
  member.use(workspaceRoutes({ store, workspace: s.workspace, metrics: s.metrics, billing: s.billing }));
  app.use('/api', member);
  app.use('/api', notFoundHandler);

  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    const indexHtml = path.join(webDist, 'index.html');
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
