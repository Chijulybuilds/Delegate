/**
 * Production entry: one Node process serves the API under /api and the built React app
 * everywhere else. `npm run build && npm start` → http://localhost:3000
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : path.resolve(here, '../../web/dist');

if (!fs.existsSync(path.join(webDist, 'index.html'))) {
  console.warn(`[delegate] No web build at ${webDist} — serving the API only. Run "npm run build" first.`);
}

try {
  // Imported dynamically so a missing package or a bad .env is explained instead of crashing.
  const { startServer } = await import('./server.js');
  await startServer({ defaultPort: 3000, webDist: fs.existsSync(webDist) ? webDist : null });
} catch (error) {
  const { serveStartupError } = await import('./lib/startup.js');
  serveStartupError(Number(process.env.PORT) || 3000, error, 'start');
}
