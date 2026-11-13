/** Development entry: API only on :4000. Vite serves the web app on :3000 and proxies /api here. */
const port = Number(process.env.PORT) || 4000;
try {
  // Imported dynamically so a missing package or a bad .env is explained instead of crashing.
  const { startServer } = await import('./server.js');
  await startServer({ defaultPort: 4000, webDist: null });
} catch (error) {
  const { serveStartupError } = await import('./lib/startup.js');
  serveStartupError(port, error, 'dev');
}

export {};
