import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

export const isProd = env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(env.PORT || 8787),
  // Public origin of the deployment; used to build OAuth redirect URIs.
  publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 8787}`).replace(/\/+$/, ''),
  dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
  dbPath: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data'), 'storemap.db'),
  uploadsDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads'),
  frontendDist: path.resolve(env.FRONTEND_DIST || path.join(__dirname, '..', '..', 'frontend', 'dist')),
  sessionSecret: env.SESSION_SECRET || '',
  sessionDays: Number(env.SESSION_DAYS || 30),

  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
  },
  apple: {
    clientId: env.APPLE_CLIENT_ID || '',   // Services ID, e.g. com.example.storemap.web
    teamId: env.APPLE_TEAM_ID || '',
    keyId: env.APPLE_KEY_ID || '',
    privateKey: (env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
  // Local/demo login without OAuth credentials. Never available in production
  // unless explicitly enabled.
  devLogin: env.ENABLE_DEV_LOGIN === 'true' || (!isProd && env.ENABLE_DEV_LOGIN !== 'false'),
  // One-click "open the demo maps" login target — the account that owns the
  // seeded demo stores (seed-demo.mjs). Overridable via DEMO_LOGIN_EMAIL.
  demoLoginEmail: (env.DEMO_LOGIN_EMAIL || 'annex@storemap.demo').toLowerCase(),
  // Self-hosted "local mode": the operator runs their own instance. Local
  // mode enables paid-tier features (product images) for every store and
  // seeds demo content on first boot. Set SELF_HOSTED=true on self-hosts.
  selfHosted: env.SELF_HOSTED === 'true',
  // First boot of a self-hosted instance auto-seeds the demo maps
  // (disable with SEED_DEMO=false).
  seedDemo: env.SEED_DEMO !== 'false',
  maxUploadBytes: 10 * 1024 * 1024,

  // ---- Stage 0 cloud storage / CDN (docs/INFRASTRUCTURE.md) ----
  // All optional: unset means local-disk media and no edge caching — exactly
  // how local development has always worked.
  r2:
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET
      ? {
          accountId: env.R2_ACCOUNT_ID,
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          bucket: env.R2_BUCKET,
        }
      : null,
  cdn: {
    // Presence of both enables Cache-Tag headers on public routes and
    // tag-purges after edits (Cloudflare API).
    zoneId: env.CF_ZONE_ID || '',
    apiToken: env.CF_API_TOKEN || '',
  },
};

export function providersConfigured() {
  return {
    google: Boolean(config.google.clientId && config.google.clientSecret),
    apple: Boolean(config.apple.clientId && config.apple.teamId && config.apple.keyId && config.apple.privateKey),
    dev: config.devLogin,
  };
}

for (const dir of [config.dataDir, config.uploadsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

if (isProd && !config.sessionSecret) {
  // Fail fast rather than run with an insecure default.
  throw new Error('SESSION_SECRET must be set when NODE_ENV=production');
}
