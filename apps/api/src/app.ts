import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { UserTokenVerifier } from './auth/tokens.js';
import type { AppConfig } from './config.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { adminRoutes, cronRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';
import { workspaceRoutes } from './routes/workspace.js';
import { AdminService } from './services/admin.js';
import { disabledVerifier, type ProofVerifier } from './services/ai.js';
import { createMailer, type Mailer } from './services/mail.js';
import { MetricsService } from './services/metrics.js';
import { WorkspaceService } from './services/workspace.js';
import type { Store } from './store/types.js';

export interface AppDeps {
  config: AppConfig;
  store: Store;
  ai?: ProofVerifier;
  mailer?: Mailer;
  /** Absolute path to the built web app. When set, the API also serves the SPA. */
  webDist?: string | null;
}

export function createApp({ config, store, ai = disabledVerifier, mailer = createMailer(config), webDist = null }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind one reverse proxy (Vercel, Render, nginx on Hostinger) so rate limits see real client IPs.
  app.set('trust proxy', 1);

  const supabaseOrigin = config.supabase?.url ?? null;
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", ...(supabaseOrigin ? [supabaseOrigin, supabaseOrigin.replace(/^https/, 'wss')] : [])],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : [])],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Same-origin in dev (Vite proxy) and in single-server production; CORS only matters for split deploys.
  app.use(
    '/api',
    cors({
      origin: config.corsOrigins.length ? config.corsOrigins : false,
      credentials: false,
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const verifier = new UserTokenVerifier(config);
  const workspace = new WorkspaceService(store, ai);
  const metrics = new MetricsService(store);
  const admin = new AdminService(store);

  app.use('/api', publicRoutes({ config, store, verifier, ai, workspace }));
  app.use('/api/admin', adminRoutes({ config, admin }));
  app.use('/api/cron', cronRoutes({ config, store, metrics, mailer }));
  app.use('/api', workspaceRoutes({ store, verifier, workspace, metrics }));
  app.use('/api', notFoundHandler);

  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    const indexHtml = path.join(webDist, 'index.html');
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders(res, filePath) {
          // Vite fingerprints everything under /assets — cache it forever.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    // SPA fallback: every non-API GET renders the app shell (/, /login, /app/*, /admin, ...).
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
