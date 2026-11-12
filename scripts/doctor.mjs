#!/usr/bin/env node
/**
 * Pre-flight check that runs before `npm run dev`, `npm run build` and `npm start`.
 * Turns cryptic errors like "sh: tsx: not found" into the exact fix.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const task = process.argv[2] ?? 'dev';
const problems = [];

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 19)) {
  problems.push(
    `Node.js ${process.versions.node} is too old. Delegate needs Node 20.19 or newer (22 LTS recommended).\n` +
      `     Fix:  nvm install 22 && nvm use 22      (or install Node 22 from https://nodejs.org)\n` +
      `     Then: rm -rf node_modules && npm install`,
  );
}

const bin = (name) => existsSync(join(root, 'node_modules', '.bin', name)) || existsSync(join(root, 'node_modules', '.bin', `${name}.cmd`));
const needed = task === 'start' ? [] : ['concurrently', 'tsx', 'tsup', 'vite'];
const missing = needed.filter((name) => !bin(name));
if (missing.length) {
  const devOmitted = process.env.NODE_ENV === 'production' || /dev/.test(process.env.npm_config_omit ?? '');
  problems.push(
    `Dependencies are not installed (missing: ${missing.join(', ')}).\n` +
      `     Fix:  cd ${root} && npm install` +
      (devOmitted ? `\n     Note: NODE_ENV=production / omit=dev skips build tools. Use: npm install --include=dev` : '') +
      `\n     If "npm install" printed errors, fix those first (they are usually a too-old Node version or a network problem).`,
  );
}

if (task === 'start' && !existsSync(join(root, 'apps', 'api', 'dist', 'index.js'))) {
  problems.push(`There is no production build yet.\n     Fix:  npm run build   (then npm start)`);
}

if (problems.length) {
  console.error(`\n  ✋ Delegate can't ${task === 'dev' ? 'start the dev server' : task === 'build' ? 'build' : 'start'} yet:\n`);
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}\n`));
  process.exit(1);
}
