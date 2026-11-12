/**
 * Vercel serverless entry. Bundled by tsup into dist/vercel.js and re-exported by /api/index.mjs.
 * The Express app is created once per warm instance and reused across invocations.
 */
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createVerifier } from './services/ai.js';
import { createStore } from './server.js';

const config = loadConfig();
if (!config.supabase) {
  console.warn('[delegate] Supabase is not configured: running the in-memory demo. Data will NOT persist between serverless instances.');
}
const store = await createStore(config);
const app = createApp({ config, store, ai: createVerifier(config) });

export default app;
