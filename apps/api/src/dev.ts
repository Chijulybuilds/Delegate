/** Development entry: API only on :4000. Vite serves the web app on :3000 and proxies /api here. */
import { startServer } from './server.js';

await startServer({ defaultPort: 4000, webDist: null });
