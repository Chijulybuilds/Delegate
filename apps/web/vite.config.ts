import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Google Search Console ownership check ("HTML tag" method): set GOOGLE_SITE_VERIFICATION to the
 * content="…" value Google gives you (Vercel env var, then redeploy) and the tag lands in <head>.
 */
function googleSiteVerification(token: string | undefined): Plugin {
  return {
    name: 'google-site-verification',
    transformIndexHtml: (html) => (token ? html.replace('</head>', `  <meta name="google-site-verification" content="${token.replace(/[^\w-]/g, '')}" />\n  </head>`) : html),
  };
}

/**
 * Every build gets an id, baked into the JS and written to /version.json. A tab left open across a
 * deploy compares the two and offers to refresh (components/UpdateNotice.tsx), so nobody keeps
 * using an old screen without knowing it.
 */
const BUILD_ID = `${(process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7)}-${Date.now().toString(36)}`;
function buildVersion(): Plugin {
  return {
    name: 'build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), googleSiteVerification(loadEnv(mode, '../../', '').GOOGLE_SITE_VERIFICATION), buildVersion()],
  define: { __APP_BUILD__: JSON.stringify(BUILD_ID) },
  // One .env at the repo root serves both apps (only VITE_* keys reach the browser).
  envDir: '../../',
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
    },
  },
  preview: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          motion: ['motion'],
        },
      },
    },
  },
}));
