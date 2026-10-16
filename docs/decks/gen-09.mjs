/** Deck 09 — Media Storage, Deployment & Infrastructure. */
import K from './kit.mjs';
const { C, F, W, M } = K;
const SYSTEM = 'Media & Deployment';

const p = K.mk(SYSTEM);
K.cover(p, {
  kicker: 'StoreMap systems  ·  09',
  title: 'Media Storage,\nDeployment & Infra',
  subtitle:
    'Uploads flow to local disk or Cloudflare R2 behind one interface; Docker + Fly/Railway ship the whole app in one container; Litestream and edge caching round out a $6–20/month production stack.',
  stats: [
    { n: '2', label: 'storage modes: disk ↔ R2' },
    { n: '1', label: 'container: app + backups' },
    { n: '10s', label: 'Litestream WAL replication' },
    { n: '$6–20', label: '/month production cost' },
  ],
  system: SYSTEM,
});

// 2 · media flow
let s = p.addSlide();
K.header(s, { kicker: 'Media', title: 'One interface, two backends, zero migration', system: SYSTEM, page: 2 });
K.flow(p, s, {
  x: M, y: 1.7, w: W - 2 * M, bh: 1.05,
  steps: [
    { t: 'Upload', d: 'raw bytes ≤ 10 MB, magic-byte checked' },
    { t: 'saveImage', d: 'uuid name + ext allowlist' },
    { t: 'Disk or R2', d: 'uploadsDir file · R2 key uploads/<name>' },
    { t: 'Serve', d: 'disk first (legacy), then R2' },
    { t: 'Immutable cache', d: 'names are UUIDs — bytes never change' },
  ],
});
K.bullets(s, [
  'Switching to R2 is env-driven (four R2_* vars) — no re-upload, no URL changes: /uploads/<name> works in both modes.',
  'PNG / JPEG / WebP only; magic bytes are checked server-side, not just extensions.',
  'Serving sets Content-Type from the extension and streams disk files (buffered only for R2).',
], { x: M, y: 3.2, w: 7.4, h: 2.0, size: 12.5 });
K.chip(p, s, {
  x: M, y: 5.3, w: 7.4, label: 'Known findings',
  text: 'The name regex allows ".." (a directory read can crash the stream — fix: stat.isFile), and cache headers are set before the 404/R2 path. Both are tracked fixes.',
});
K.codeCard(p, s, {
  x: 8.1, y: 1.7, w: 4.7, h: 5.0, file: 'lib/storage.js — sendImage (shape)', size: 10,
  code: `if (!/^[A-Za-z0-9._-]+$/.test(name))
  return false;                // no slashes
res.set('Cache-Control',
  'public, max-age=31536000, immutable');

const local = path.join(uploadsDir, name);
if (fs.existsSync(local)) {
  const stat = await fsp.stat(local);
  res.writeHead(200, { 'Content-Length': … });
  fs.createReadStream(local).pipe(res);
  return true;
}
if (r2Enabled()) {
  const obj = await r2Get('uploads/' + name);
  res.end(Buffer.from(await obj.arrayBuffer()));
}`,
});

// 3 · R2 signing
s = p.addSlide();
K.header(s, { kicker: 'Cloudflare R2', title: 'SigV4 by hand — no SDK', system: SYSTEM, page: 3 });
K.bullets(s, [
  'r2Put / r2Get sign AWS SigV4 requests with node crypto: canonical request → string-to-sign → HMAC chain (date → region → service → key).',
  'Endpoint: https://<account>.r2.cloudflarestorage.com/<bucket>/uploads/<name> — zero SDK dependencies, matching the project\'s zero-native-deps rule.',
  'Litestream uses the same credentials via its own S3-compatible config (backend/litestream.yml).',
  'r2.test.mjs pins the signing (canonical request, signed headers, signature) — the requests themselves are untested against live R2.',
], { x: M, y: 1.75, w: 7.3, h: 3.4, size: 12.5 });
K.codeCard(p, s, {
  x: 8.0, y: 1.75, w: 4.8, h: 4.9, file: 'lib/r2.js (signing chain)', size: 10,
  code: `const amzDate = '…yyyymmddThhmmssZ';
const dateStamp = amzDate.slice(0, 8);

const kDate = hmac('AWS4' + secret, dateStamp);
const kRegion = hmac(kDate, 'auto');
const kService = hmac(kRegion, 's3');
const kSigning = hmac(kService, 'aws4_request');

Authorization:
  AWS4-HMAC-SHA256 Credential=
    \${key}/\${dateStamp}/auto/s3/aws4_request,
  SignedHeaders=host;x-amz-content-sha256;
    x-amz-date,
  Signature=\${hex(hmac(kSigning, stringToSign))}`,
});

// 4 · docker
s = p.addSlide();
K.header(s, { kicker: 'Container', title: 'One image: build the SPA, ship the API', system: SYSTEM, page: 4 });
K.flow(p, s, {
  x: M, y: 1.75, w: W - 2 * M, bh: 1.1,
  steps: [
    { t: 'Stage 1', d: 'node:22-alpine builds frontend/ (npm ci → vite build)' },
    { t: 'Stage 2', d: 'backend + --omit=dev deps' },
    { t: 'Copy dist', d: 'SPA served by the API process' },
    { t: 'Litestream', d: 'binary copied from official image' },
    { t: 'entrypoint.sh', d: 'replicate + node src/index.js' },
  ],
});
K.bullets(s, [
  'HEALTHCHECK hits /api/health every 30 s (wget) — orchestrators and compose both get real liveness.',
  'DATA_DIR=/data declared as a VOLUME — everything stateful (DB + uploads) lives on one mount.',
  'The frontend dist is copied from the build stage, so the runtime image never holds dev tooling.',
], { x: M, y: 3.3, w: 7.4, h: 2.2, size: 12.5 });
K.chip(p, s, {
  x: M, y: 5.6, w: 7.4, label: 'Known finding',
  text: 'No .dockerignore yet — host node_modules can ride the build context. Also: the entrypoint points Litestream at /app/litestream.yml but the file lands at /app/backend/ (one-line fix, tracked).',
});
K.codeCard(p, s, {
  x: 8.1, y: 1.75, w: 4.7, h: 5.0, file: 'entrypoint.sh', size: 10.5,
  code: `#!/bin/sh
set -e

if [ -n "$R2_ACCOUNT_ID" ] && … ; then
  echo "[entrypoint] starting litestream"
  litestream replicate \\
    -config /app/litestream.yml &
else
  echo "[entrypoint] backups disabled"
fi

exec node src/index.js`,
});

// 5 · fly
s = p.addSlide();
K.header(s, { kicker: 'Fly.io — Stage 0', title: 'The fully-wired deployment', system: SYSTEM, page: 5 });
K.table(p, s, {
  x: M, y: 1.75, w: W - 2 * M, colW: [3.3, 10.1], size: 11.5,
  rows: [
    ['Piece', 'Configuration'],
    ['App', 'fly.toml: shared-cpu-2x, force_https, /api/health check every 30 s, auto_start on / auto_stop OFF (backups keep replicating)'],
    ['Volume', 'storemap_data mounted at /data — SQLite + uploads; weekly machine snapshots'],
    ['Secrets', 'SESSION_SECRET, PUBLIC_BASE_URL, R2_* (media + backups), CF_ZONE_ID / CF_API_TOKEN (purge)'],
    ['Cloudflare', 'orange-cloud CNAME; cache rule on /api/public/* (s-maxage 300, SWR); per-store tag purge after edits'],
    ['Cost', '≈ $5.90 machine + volume ≈ $0.50 + free tier CDN/R2 → about $6–8/month at launch scale'],
  ],
});
s.addText('Full runbook: docs/DEPLOY.md — accounts, R2 buckets, cache rules, secret list, and the restore drill (litestream restore → sqlite3 count check).', { x: M, y: 6.3, w: W - 2 * M, h: 0.4, fontSize: 11.5, fontFace: F.body, color: C.MUTED, margin: 0 });

// 6 · railway
s = p.addSlide();
K.header(s, { kicker: 'Alternative — Railway', title: 'The Vercel-like experience (with real volumes)', system: SYSTEM, page: 6 });
K.bullets(s, [
  'Connect the GitHub repo → Railway builds the existing Dockerfile unchanged; PORT is injected and already honored.',
  'Mount a volume at /data (the baked-in DATA_DIR) — SQLite + uploads survive every deploy.',
  'Env: NODE_ENV=production, PUBLIC_BASE_URL=<railway domain>, SESSION_SECRET, TRUST_PROXY=true.',
  'Never scale past one replica — SQLite is single-writer and the volume is region-pinned.',
  { t: 'Pro ($20/mo, $20 usage credit) is effectively required for production: Hobby caps volumes at 5 GB and has no volume backups. Pro bills on actual usage (~$6–12 for this app) + $1.50/10 GB volume + Pro-only daily/weekly backups with one-click restore.', bold: true },
], { x: M, y: 1.75, w: 7.4, h: 4.4, size: 12.5 });
K.table(p, s, {
  x: 8.1, y: 1.75, w: 4.7, colW: [2.3, 2.4], size: 10.5,
  rows: [
    ['Platform', 'Verdict'],
    ['Vercel / Netlify', 'No — serverless, no persistent disk'],
    ['Fly.io', 'Fully pre-wired (fly.toml); CLI-driven'],
    ['Railway', 'Most Vercel-like; Pro fits this app'],
    ['Render', 'Same idea; Starter + disk ≈ $7'],
  ],
});

// 7 · CI
s = p.addSlide();
K.header(s, { kicker: 'CI', title: 'Three suites on every push', system: SYSTEM, page: 7 });
K.flow(p, s, {
  x: M, y: 1.75, w: W - 2 * M, bh: 1.05,
  steps: [
    { t: 'frontend', d: 'npm ci · vitest (91) · vite build' },
    { t: 'backend', d: 'npm ci · node --test (40) · audit' },
    { t: 'e2e', d: 'build SPA → Playwright (4 journeys) vs real server' },
  ],
});
K.bullets(s, [
  'The e2e job boots the real Express server on :8901 with a throwaway SQLite and walks shopper + editor journeys.',
  'Playwright reports upload as artifacts on failure (7-day retention).',
  { t: 'Known gap: the e2e job never runs `npm ci` in backend/, so the spawned server cannot find express — the job cannot pass until that one line is added.', bold: true },
], { x: M, y: 3.2, w: W - 2 * M, h: 2.0, size: 12.5 });
K.codeCard(p, s, {
  x: M, y: 5.3, w: W - 2 * M, h: 1.5, file: '.github/workflows/ci.yml (e2e job, with the fix)', size: 10,
  code: `- name: Install backend deps        # ← the missing line
  working-directory: backend
  run: npm ci
- name: Run E2E
  working-directory: e2e
  run: npm test`,
});

K.closing(p, {
  title: 'Infrastructure rules this system keeps',
  system: SYSTEM,
  points: [
    { t: 'One interface, two storage modes', d: 'disk and R2 behind saveImage/sendImage; switching is env-only, URLs never change.' },
    { t: 'Everything stateful on one volume', d: 'SQLite + uploads under /data; back it up and the deployment is fully recoverable.' },
    { t: 'Backups are part of the container', d: 'Litestream replicates the WAL every 10 s; restore is a documented drill.' },
    { t: 'Honest deployment math', d: '$6–8 on Fly, a flat $20 on Railway Pro — measured, not vibes.' },
  ],
});

p.writeFile({ fileName: '09-media-deployment-infra.pptx' }).then(() => console.log('ok 09'));
