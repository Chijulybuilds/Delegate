import type { Server } from 'node:http';
import { createApp } from './app.js';
import { DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD, loadConfig, type AppConfig } from './config.js';
import { createVerifier } from './services/ai.js';
import { MemoryStore } from './store/memory.js';
import { seedDemo } from './store/seed.js';
import { SupabaseStore } from './store/supabase.js';
import type { Store } from './store/types.js';

export async function createStore(config: AppConfig): Promise<Store> {
  if (config.supabase) return new SupabaseStore(config.supabase.url, config.supabase.serviceRoleKey, config.supabase.bucket);
  const memory = new MemoryStore();
  await seedDemo(memory);
  return memory;
}

export async function startServer(opts: { defaultPort: number; webDist: string | null }): Promise<Server> {
  const config = loadConfig();
  const store = await createStore(config);
  const app = createApp({ config, store, ai: createVerifier(config), webDist: opts.webDist });
  const port = config.port ?? opts.defaultPort;

  // Long-running servers (local dev, Hostinger/PM2) run the automation tick themselves.
  // Serverless (Vercel) relies on Vercel Cron / Supabase pg_cron calling /api/cron/tick instead.
  let timer: NodeJS.Timeout | null = null;
  if (config.internalScheduler) {
    timer = setInterval(() => {
      app.services.automation.tick().catch((e) => console.error('[scheduler] tick failed', e));
    }, 60_000);
    timer.unref();
  }

  const on = (flag: unknown) => (flag ? 'on' : 'off');
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log('');
      console.log(`  Delegate ${opts.webDist ? 'app + API' : 'API'} → ${url}`);
      console.log(`  Data: ${store.kind === 'memory' ? 'in-memory demo workspace (resets on restart)' : 'Supabase'}`);
      console.log(`  Auth: ${config.authMode === 'demo' ? 'demo personas (set SUPABASE_* env for Google sign-in)' : 'Supabase + Google OAuth'}`);
      if (config.admin?.password === DEV_ADMIN_PASSWORD && config.admin.email === DEV_ADMIN_EMAIL) {
        console.log(`  Admin: ${opts.webDist ? url : 'http://localhost:3000'}/admin  (${DEV_ADMIN_EMAIL} / ${DEV_ADMIN_PASSWORD} — dev only)`);
      }
      console.log(`  Billing: Stripe ${on(config.stripe)} · Paystack ${on(config.paystack)}${config.simulateProviders ? ' · demo checkout on' : ''}`);
      console.log(`  Channels: Slack ${on(config.slack)} · WhatsApp ${on(config.whatsapp)} · Drive ${on(config.google)}${config.simulateProviders ? ' · simulated deliveries' : ''}`);
      console.log(`  Automations: ${config.internalScheduler ? 'every minute (in-process)' : 'via /api/cron/tick'}`);
      console.log(`  AI proof checks: ${config.ai ? `on (${config.ai.model})` : 'off (set ANTHROPIC_API_KEY)'}`);
      console.log('');
      resolve(server);
    });
    server.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code !== 'EADDRINUSE') throw e;
      console.error(`\n  ✋ Port ${port} is already in use — Delegate is probably already running in another terminal.`);
      console.error(`     Stop that one (Ctrl+C), or run this one on another port: PORT=${port + 1} npm start\n`);
      process.exit(1);
    });
    const shutdown = () => {
      if (timer) clearInterval(timer);
      server.close(() => process.exit(0));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  });
}
