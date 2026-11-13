import http from 'node:http';

/**
 * When the API can't start (a package isn't installed, an env var is wrong), crashing leaves the
 * browser with nothing but "can't reach the API". Instead we keep the port open and answer every
 * request with the exact reason and fix, so the sign-in page can show it — no terminal digging.
 */

export type StartupContext = 'dev' | 'start' | 'vercel';

export function describeStartupError(error: unknown, context: StartupContext): string {
  const e = error as NodeJS.ErrnoException | undefined;
  const raw = String(e?.message ?? error);
  const pkg = raw.match(/Cannot find (?:package|module) '([^']+)'/);

  if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND' || pkg) {
    const name = pkg?.[1] ?? 'a dependency';
    if (name.startsWith('.') || name.startsWith('/')) {
      return `The Delegate API can't start: one of its files is missing (${name}). Run "npm run build" again.`;
    }
    return context === 'vercel'
      ? `The Delegate API can't start: the package "${name}" is missing from the deployment. Redeploy so Vercel runs "npm ci" again.`
      : `The Delegate API can't start because the package "${name}" isn't installed. New packages were added in the latest update: run "npm install" in the project folder, then start "npm run dev" again.`;
  }

  let message = `The Delegate API can't start: ${raw}`;
  if (context === 'dev' && process.env.NODE_ENV === 'production' && /production/i.test(raw)) {
    message += ' (Your .env sets NODE_ENV=production. For local development use NODE_ENV=development.)';
  }
  if (context === 'vercel' && /required in production/i.test(raw)) {
    message += ' Add it in Vercel → Project → Settings → Environment Variables, then redeploy.';
  }
  return message;
}

export function logStartupError(message: string, error: unknown) {
  const line = '─'.repeat(Math.min(100, message.length + 4));
  console.error(`\n  ${line}\n  ✋ ${message}\n  ${line}\n`);
  if (process.env.DEBUG) console.error(error);
}

/** JSON body every /api request gets while the API is down. */
export function startupErrorBody(message: string) {
  return JSON.stringify({ error: { code: 'api_not_started', message } });
}

export function serveStartupError(port: number, error: unknown, context: StartupContext): http.Server {
  const message = describeStartupError(error, context);
  logStartupError(message, error);
  const server = http.createServer((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(startupErrorBody(message));
  });
  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') console.error(`  Port ${port} is already in use — another copy of the API is probably running. Stop it and try again.`);
  });
  server.listen(port, () => console.error(`  Explaining the problem to the browser on http://localhost:${port}/api — fix it, then restart.\n`));
  return server;
}
