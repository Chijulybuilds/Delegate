import { createHash } from 'node:crypto';
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

  // Encrypts integration secrets at rest and signs short-lived attestations. 32 bytes, hex.
  APP_ENCRYPTION_KEY: z.string().optional(),

  // Billing — Stripe (cards, global)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_TEAM: z.string().optional(), // recurring per-seat monthly price id (price_...)
  // Billing — Paystack (cards, bank transfer, USSD in Africa)
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PLAN_TEAM: z.string().optional(), // PLN_... monthly plan, amount = price per seat
  TEAM_PRICE_USD: z.coerce.number().default(8),
  TEAM_PRICE_NGN: z.coerce.number().optional(),

  // Sign-up code length: keep equal to Supabase → Authentication → Sign In / Providers → Email → Email OTP Length.
  EMAIL_OTP_LENGTH: z.coerce.number().int().min(6).max(10).default(6),

  // Slack app (OAuth + slash command + message shortcut)
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // WhatsApp Cloud API (Meta)
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_BUSINESS_NUMBER: z.string().optional(), // e.g. 2348012345678, used for wa.me links
  WHATSAPP_TEMPLATE_LANG: z.string().default('en'),
  WHATSAPP_GRAPH_VERSION: z.string().default('v21.0'),

  // Google Drive proof (Picker + drive.file scope)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  GOOGLE_PROJECT_NUMBER: z.string().optional(),

  // Runs the automation tick in-process every minute (local dev / single-server deploys).
  INTERNAL_SCHEDULER: z.string().optional(),
  // Simulate provider calls (demo checkout, logged-not-sent messages). Defaults to on without Supabase.
  SIMULATE_PROVIDERS: z.string().optional(),

  // Test-only switch that exposes POST /api/demo/reset.
  ALLOW_DEMO_RESET: bool,
});

export type Env = z.infer<typeof schema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  /** Digits in the sign-up code Supabase emails (Email OTP Length). */
  emailOtpLength: number;
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
  encryptionKey: Buffer;
  stripe: { secretKey: string; webhookSecret: string | null; priceTeam: string } | null;
  paystack: { secretKey: string; planTeam: string } | null;
  prices: { teamUsd: number; teamNgn: number | null };
  slack: { clientId: string; clientSecret: string; signingSecret: string } | null;
  whatsapp: {
    token: string;
    phoneNumberId: string;
    appSecret: string;
    verifyToken: string;
    businessNumber: string | null;
    templateLang: string;
    graphVersion: string;
  } | null;
  google: { clientId: string; apiKey: string; appId: string } | null;
  /** Demo workspace: simulate checkouts and chat deliveries instead of calling providers. */
  simulateProviders: boolean;
  internalScheduler: boolean;
}

const DEV_APP_SECRET = 'delegate-dev-app-secret-change-me-0123456789';
const DEV_ADMIN_SECRET = 'delegate-dev-admin-secret-change-me-9876543210';
const DEV_ENCRYPTION_KEY = 'delegate-dev-encryption-key-not-for-production';
export const DEV_ADMIN_EMAIL = 'admin@delegate.local';

/** 64 hex chars are used as-is; anything else is stretched with SHA-256 (dev convenience). */
function deriveKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return createHash('sha256').update(raw).digest();
}
export const DEV_ADMIN_PASSWORD = 'delegate-admin';

export function loadConfig(overrides: Partial<Record<keyof Env, string>> = {}): AppConfig {
  // Values pasted into a dashboard often carry a stray newline or space (e.g. "\n1039…apps.googleusercontent.com"),
  // which silently breaks OAuth client IDs and keys. Trim every value before validating.
  const raw = Object.fromEntries(Object.entries({ ...process.env, ...overrides }).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';

  // Only the project's base address works: "https://abcd.supabase.co". A pasted endpoint such as
  // ".../rest/v1/" would send "Continue with Google" to ".../rest/v1/auth/v1/authorize", which
  // Supabase rejects with "No API key found in request". Keep just the origin.
  const supabaseUrl = e.SUPABASE_URL ? new URL(e.SUPABASE_URL).origin : '';
  if (e.SUPABASE_URL && supabaseUrl !== e.SUPABASE_URL.replace(/\/+$/, '')) {
    console.warn(`[delegate] SUPABASE_URL should be just ${supabaseUrl} — ignoring the extra "${new URL(e.SUPABASE_URL).pathname}".`);
  }
  const supabase =
    supabaseUrl && e.SUPABASE_SERVICE_ROLE_KEY && e.SUPABASE_ANON_KEY
      ? {
          url: supabaseUrl,
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

  if (isProduction && !e.APP_ENCRYPTION_KEY) {
    throw new Error('APP_ENCRYPTION_KEY is required in production (generate with: openssl rand -hex 32).');
  }
  const encryptionKey = deriveKey(e.APP_ENCRYPTION_KEY || DEV_ENCRYPTION_KEY);

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
    // On Vercel, fall back to the production domain Vercel exposes, so links in Slack/WhatsApp/email work out of the box.
    publicAppUrl: (e.PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') || null)?.replace(/\/$/, '') ?? null,
    ai: e.ANTHROPIC_API_KEY ? { apiKey: e.ANTHROPIC_API_KEY, model: e.AI_MODEL } : null,
    mail: e.RESEND_API_KEY ? { apiKey: e.RESEND_API_KEY, from: e.MAIL_FROM } : null,
    cronSecret: e.CRON_SECRET || null,
    allowDemoReset: e.ALLOW_DEMO_RESET,
    version: '0.2.0',
    encryptionKey,
    stripe: e.STRIPE_SECRET_KEY && e.STRIPE_PRICE_TEAM
      ? { secretKey: e.STRIPE_SECRET_KEY, webhookSecret: e.STRIPE_WEBHOOK_SECRET || null, priceTeam: e.STRIPE_PRICE_TEAM }
      : null,
    paystack: e.PAYSTACK_SECRET_KEY && e.PAYSTACK_PLAN_TEAM ? { secretKey: e.PAYSTACK_SECRET_KEY, planTeam: e.PAYSTACK_PLAN_TEAM } : null,
    prices: { teamUsd: e.TEAM_PRICE_USD, teamNgn: e.TEAM_PRICE_NGN ?? null },
    emailOtpLength: e.EMAIL_OTP_LENGTH,
    slack:
      e.SLACK_CLIENT_ID && e.SLACK_CLIENT_SECRET && e.SLACK_SIGNING_SECRET
        ? { clientId: e.SLACK_CLIENT_ID, clientSecret: e.SLACK_CLIENT_SECRET, signingSecret: e.SLACK_SIGNING_SECRET }
        : null,
    whatsapp:
      e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_APP_SECRET && e.WHATSAPP_VERIFY_TOKEN
        ? {
            token: e.WHATSAPP_TOKEN,
            phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
            appSecret: e.WHATSAPP_APP_SECRET,
            verifyToken: e.WHATSAPP_VERIFY_TOKEN,
            businessNumber: e.WHATSAPP_BUSINESS_NUMBER?.replace(/\D/g, '') || null,
            templateLang: e.WHATSAPP_TEMPLATE_LANG,
            graphVersion: e.WHATSAPP_GRAPH_VERSION,
          }
        : null,
    google:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_API_KEY && e.GOOGLE_PROJECT_NUMBER
        ? { clientId: e.GOOGLE_CLIENT_ID, apiKey: e.GOOGLE_API_KEY, appId: e.GOOGLE_PROJECT_NUMBER }
        : null,
    simulateProviders: e.SIMULATE_PROVIDERS ? e.SIMULATE_PROVIDERS === 'true' : !supabase,
    internalScheduler: e.INTERNAL_SCHEDULER ? e.INTERNAL_SCHEDULER === 'true' : !isProduction,
  };
}
