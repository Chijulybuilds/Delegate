/**
 * Vercel serverless entry. Bundled by tsup into dist/vercel.js and re-exported by /api/index.mjs.
 * The Express app is created once per warm instance and reused across invocations.
 *
 * If it can't start (e.g. a required environment variable is missing), every /api request answers
 * with the exact reason instead of a bare 500, so the sign-in page can show what to fix.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describeStartupError, logStartupError, startupErrorBody } from './lib/startup.js';

if (process.env.NODEJS_HELPERS !== '0') {
  console.error('[delegate] NODEJS_HELPERS is not "0": Vercel will pre-parse request bodies and webhook signatures (Stripe, Paystack, Slack, WhatsApp, GitHub) cannot be verified. Add NODEJS_HELPERS=0 to the project environment variables.');
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function boot(): Promise<Handler> {
  try {
    const [{ createApp }, { loadConfig }, { createVerifier }, { createStore }] = await Promise.all([
      import('./app.js'),
      import('./config.js'),
      import('./services/ai.js'),
      import('./server.js'),
    ]);
    const config = loadConfig();
    if (!config.supabase) {
      console.warn('[delegate] Supabase is not configured: running the in-memory demo. Data will NOT persist between serverless instances.');
    }
    const store = await createStore(config);
    return createApp({ config, store, ai: createVerifier(config) }) as unknown as Handler;
  } catch (error) {
    const message = describeStartupError(error, 'vercel');
    logStartupError(message, error);
    return (_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(startupErrorBody(message));
    };
  }
}

const handler = await boot();
export default handler;
