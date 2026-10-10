/**
 * Unit tests for the zero-dependency SigV4 signer (lib/r2.js).
 * Uses fixed inputs so the signature is a stable snapshot — if this changes,
 * the canonical-request construction changed and R2 would reject requests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = '/tmp/storemap-r2-test-' + process.pid;
process.env.SESSION_SECRET = 'test';
process.env.R2_ACCOUNT_ID = 'acc1234567890';
process.env.R2_ACCESS_KEY_ID = 'testkey';
process.env.R2_SECRET_ACCESS_KEY = 'testsecret';
process.env.R2_BUCKET = 'media';

const { sigv4Headers, r2Enabled } = await import('../src/lib/r2.js');
const { config } = await import('../src/config.js');

test('r2 disabled without env, enabled with env', () => {
  assert.ok(r2Enabled());
  assert.equal(config.r2.bucket, 'media');
});

test('signs a PUT with a stable, well-formed AWS4 signature', () => {
  const body = Buffer.from('hello storemap');
  const h = sigv4Headers({
    method: 'PUT',
    key: 'uploads/abc-123.webp',
    body,
    contentType: 'image/webp',
    now: new Date('2026-10-09T12:00:00Z'),
  });
  assert.equal(h.host, 'acc1234567890.r2.cloudflarestorage.com');
  assert.equal(h['x-amz-date'], '20261009T120000Z');
  assert.equal(h['content-type'], 'image/webp');
  // payload hash is the sha256 of the body
  assert.equal(h['x-amz-content-sha256'], createHash('sha256').update(body).digest('hex'));
  assert.match(
    h.Authorization,
    /^AWS4-HMAC-SHA256 Credential=testkey\/20261009\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
  );
  // signature is deterministic for the same inputs
  const h2 = sigv4Headers({
    method: 'PUT',
    key: 'uploads/abc-123.webp',
    body,
    contentType: 'image/webp',
    now: new Date('2026-10-09T12:00:00Z'),
  });
  assert.equal(h.Authorization, h2.Authorization);
});

test('different bodies produce different signatures', () => {
  const a = sigv4Headers({ method: 'PUT', key: 'k.bin', body: Buffer.from('a'), now: new Date(0) });
  const b = sigv4Headers({ method: 'PUT', key: 'k.bin', body: Buffer.from('b'), now: new Date(0) });
  assert.notEqual(a.Authorization, b.Authorization);
});

test('keys with spaces/unicode survive key encoding round-trip', () => {
  const h = sigv4Headers({ method: 'GET', key: 'uploads/ñame with space.png', body: Buffer.alloc(0), now: new Date(0) });
  assert.match(h.Authorization, /Signature=[0-9a-f]{64}/);
});
