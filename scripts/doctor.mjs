#!/usr/bin/env node
/**
 * Pre-flight check that runs before `npm run dev`, `npm run build` and `npm start`.
 * Turns cryptic errors like "sh: tsx: not found" into the exact fix.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

// Every package the workspaces declare must be installed. Catches the classic "pulled new code but
// didn't run npm install": the API then crashes on start-up and sign-in silently stops working.
if (!missing.length) {
  const dirs = ['.', ...['apps', 'packages'].flatMap((d) => (existsSync(join(root, d)) ? readdirSync(join(root, d)).map((n) => join(d, n)) : []))];
  const notInstalled = new Set();
  for (const dir of dirs) {
    const file = join(root, dir, 'package.json');
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    const deps = { ...pkg.dependencies, ...(task === 'start' ? {} : pkg.devDependencies) };
    for (const name of Object.keys(deps)) {
      if (name.startsWith('@delegate/')) continue;
      const installed = existsSync(join(root, 'node_modules', name, 'package.json')) || existsSync(join(root, dir, 'node_modules', name, 'package.json'));
      if (!installed) notInstalled.add(name);
    }
  }
  if (notInstalled.size) {
    const list = [...notInstalled].slice(0, 6).join(', ') + (notInstalled.size > 6 ? `, +${notInstalled.size - 6} more` : '');
    problems.push(`New packages were added since your last install (not installed: ${list}).\n     Fix:  cd ${root} && npm install`);
  }
}

// A production .env on a dev machine makes the API demand production secrets: say so up front.
if (task === 'dev' && existsSync(join(root, '.env')) && /^\s*NODE_ENV\s*=\s*production\s*$/m.test(readFileSync(join(root, '.env'), 'utf8'))) {
  console.warn('\n  ⚠  Your .env sets NODE_ENV=production. For local development use NODE_ENV=development\n     (production mode requires APP_ENCRYPTION_KEY, admin secrets, etc.).\n');
}

if (task === 'start' && !existsSync(join(root, 'apps', 'api', 'dist', 'index.js'))) {
  problems.push(`There is no production build yet.\n     Fix:  npm run build   (then npm start)`);
}

if (problems.length) {
  console.error(`\n  ✋ Delegate can't ${task === 'dev' ? 'start the dev server' : task === 'build' ? 'build' : 'start'} yet:\n`);
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}\n`));
  process.exit(1);
}
