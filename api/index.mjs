// Vercel Serverless Function — every /api/* request is rewritten here (see vercel.json).
// `npm run build` bundles the Express API into apps/api/dist/vercel.js; this file only re-exports it.
// The React app is served as static files from apps/web/dist by Vercel's CDN.
export { default } from '../apps/api/dist/vercel.js';
