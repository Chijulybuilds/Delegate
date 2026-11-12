import type { Server } from 'node:http';
import { createApp } from './app.js';
import { DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD, loadConfig } from './config.js';
import { createVerifier } from './services/ai.js';
import { MemoryStore } from './store/memory.js';
import { seedDemo } from './store/seed.js';
import { SupabaseStore } from './store/supabase.js';
import type { Store } from './store/types.js';

export async function startServer(opts: { defaultPort: number; webDist: string | null }): Promise<Server> {
  const config = loadConfig();
  let store: Store;
  if (config.supabase) {
    store = new SupabaseStore(config.supabase.url, config.supabase.serviceRoleKey, config.supabase.bucket);
  } else {
    const memory = new MemoryStore();
    await seedDemo(memory);
    store = memory;
  }

  const app = createApp({ config, store, ai: createVerifier(config), webDist: opts.webDist });
  const port = config.port ?? opts.defaultPort;

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
      console.log(`  AI proof checks: ${config.ai ? `on (${config.ai.model})` : 'off (set ANTHROPIC_API_KEY)'}`);
      console.log('');
      resolve(server);
    });
    const shutdown = () => server.close(() => process.exit(0));
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  });
}
