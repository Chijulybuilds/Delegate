import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// One .env at the repo root serves both apps. Also honour apps/api/.env if present.
for (const candidate of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate, quiet: true } as dotenv.DotenvConfigOptions);
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().optional(),

  // Supabase (production data + Google OAuth). When absent the API runs in demo mode.
  SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('proofs'),

  // Signs demo-mode session tokens.
  APP_JWT_SECRET: z.string().optional(),

  // Platform admin console (/admin). Separate credentials, separate signing secret.
  ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_JWT_SECRET: z.string().optional(),

  CORS_ORIGINS: z.string().optional(),
  PUBLIC_APP_URL: z.string().optional(),

  // Optional integrations
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Delegate <standup@delegate.app>'),
  CRON_SECRET: z.string().optional(),

  // Test-only switch that exposes POST /api/demo/reset.
  ALLOW_DEMO_RESET: bool,
});

export type Env = z.infer<typeof schema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  port: number | null;
  authMode: 'supabase' | 'demo';
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
    jwtSecret: string | null;
    bucket: string;
  } | null;
  appJwtSecret: Uint8Array;
  admin: {
    email: string;
    passwordHash: string | null;
    password: string | null;
    jwtSecret: Uint8Array;
  } | null;
  corsOrigins: string[];
  publicAppUrl: string | null;
  ai: { apiKey: string; model: string } | null;
  mail: { apiKey: string; from: string } | null;
  cronSecret: string | null;
  allowDemoReset: boolean;
  version: string;
}

const DEV_APP_SECRET = 'delegate-dev-app-secret-change-me-0123456789';
const DEV_ADMIN_SECRET = 'delegate-dev-admin-secret-change-me-9876543210';
export const DEV_ADMIN_EMAIL = 'admin@delegate.local';
export const DEV_ADMIN_PASSWORD = 'delegate-admin';

export function loadConfig(overrides: Partial<Record<keyof Env, string>> = {}): AppConfig {
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';

  const supabase =
    e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY && e.SUPABASE_ANON_KEY
      ? {
          url: e.SUPABASE_URL.replace(/\/$/, ''),
          anonKey: e.SUPABASE_ANON_KEY,
          serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
          jwtSecret: e.SUPABASE_JWT_SECRET || null,
          bucket: e.SUPABASE_STORAGE_BUCKET,
        }
      : null;

  if (isProduction && !e.APP_JWT_SECRET && !supabase) {
    throw new Error('APP_JWT_SECRET is required in production when Supabase is not configured.');
  }

  // Admin: explicit env wins. Outside production we fall back to well-known dev credentials.
  let admin: AppConfig['admin'] = null;
  if (e.ADMIN_EMAIL && (e.ADMIN_PASSWORD_HASH || e.ADMIN_PASSWORD)) {
    if (isProduction && !e.ADMIN_PASSWORD_HASH) {
      throw new Error('In production set ADMIN_PASSWORD_HASH (npm run admin:hash -- "<password>"), not ADMIN_PASSWORD.');
    }
    if (isProduction && !e.ADMIN_JWT_SECRET) {
      throw new Error('ADMIN_JWT_SECRET is required in production.');
    }
    admin = {
      email: e.ADMIN_EMAIL.toLowerCase(),
      passwordHash: e.ADMIN_PASSWORD_HASH || null,
      password: e.ADMIN_PASSWORD_HASH ? null : e.ADMIN_PASSWORD || null,
      jwtSecret: new TextEncoder().encode(e.ADMIN_JWT_SECRET || DEV_ADMIN_SECRET),
    };
  } else if (!isProduction) {
    admin = {
      email: DEV_ADMIN_EMAIL,
      passwordHash: null,
      password: DEV_ADMIN_PASSWORD,
      jwtSecret: new TextEncoder().encode(e.ADMIN_JWT_SECRET || DEV_ADMIN_SECRET),
    };
  }

  return {
    env: e.NODE_ENV,
    isProduction,
    port: e.PORT ?? null,
    authMode: supabase ? 'supabase' : 'demo',
    supabase,
    appJwtSecret: new TextEncoder().encode(e.APP_JWT_SECRET || DEV_APP_SECRET),
    admin,
    corsOrigins: (e.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    publicAppUrl: e.PUBLIC_APP_URL || null,
    ai: e.ANTHROPIC_API_KEY ? { apiKey: e.ANTHROPIC_API_KEY, model: e.AI_MODEL } : null,
    mail: e.RESEND_API_KEY ? { apiKey: e.RESEND_API_KEY, from: e.MAIL_FROM } : null,
    cronSecret: e.CRON_SECRET || null,
    allowDemoReset: e.ALLOW_DEMO_RESET,
    version: '0.1.0',
  };
}
