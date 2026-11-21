#!/usr/bin/env node
// One-command deploy to Cloudflare (free plan). Idempotent: safe to run on every push.
//  1. finds or creates the D1 database "aether-db" and writes its id into wrangler.toml
//  2. applies pending migrations
//  3. builds the web app and deploys the Worker (API + realtime + static app)
//  4. creates APP_SECRET (encryption key for stored secrets) the first time only
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment (or `wrangler login` locally).
import { execSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });
const log = (m) => console.log(`\x1b[32m▸\x1b[0m ${m}`);
const wrangler = 'npx wrangler';

log('Looking for D1 database aether-db');
let dbs = [];
try {
  dbs = JSON.parse(sh(`${wrangler} d1 list --json`));
} catch (e) {
  console.error('Could not list D1 databases. Check CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID.');
  throw e;
}
let db = dbs.find((d) => d.name === 'aether-db');
if (!db) {
  log('Creating D1 database aether-db');
  sh(`${wrangler} d1 create aether-db`);
  db = JSON.parse(sh(`${wrangler} d1 list --json`)).find((d) => d.name === 'aether-db');
}
const id = db.uuid ?? db.database_id ?? db.id;
const toml = fs.readFileSync('wrangler.toml', 'utf8').replace(/database_id = "[^"]*"/, `database_id = "${id}"`);
fs.writeFileSync('wrangler.toml', toml);
log(`Using database ${id}`);

log('Applying migrations');
execSync(`${wrangler} d1 migrations apply aether-db --remote`, { stdio: 'inherit', env: { ...process.env, CI: 'true' } });

log('Building the web app');
execSync('npm run build', { stdio: 'inherit' });

log('Deploying the Worker');
execSync(`${wrangler} deploy`, { stdio: 'inherit' });

let secrets = [];
try {
  secrets = JSON.parse(sh(`${wrangler} secret list`));
} catch {
  /* first deploy may not list yet */
}
if (!secrets.some((s) => s.name === 'APP_SECRET')) {
  log('Creating APP_SECRET (first deploy only)');
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', 'APP_SECRET'], { input: randomBytes(32).toString('base64url'), stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error('Failed to set APP_SECRET');
}
log('Done. Your workspace is live at the workers.dev URL printed above.');
