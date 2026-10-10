import { defineConfig } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8901;

/** Boot the real server (built SPA + real SQLite in a temp dir) for the suite. */
async function startServer() {
  const proc = spawn('node', ['src/index.js'], {
    cwd: path.join(ROOT, 'backend'),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: path.join(ROOT, 'e2e', '.data'),
      SESSION_SECRET: 'e2e-secret',
      ENABLE_DEV_LOGIN: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });
  const base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${base}/api/health`);
      return { proc, base };
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error('server did not start');
}

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'html' : 'list',
  use: { baseURL: 'http://127.0.0.1:8901' },
  workers: 1,
});

export { startServer };
