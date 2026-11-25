/** Demo product photos served from the D1 `media` table (src/media.ts). */
import { describe, it, expect, vi } from 'vitest';
import { serveMedia, isMediaFile, demoPhotoUrl, mimeOf } from '../src/media';
import type { Env } from '../src/config';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const bytes = new TextEncoder().encode(SVG);
const etag = 'ab'.repeat(32);

/** An Env whose D1 answers the media queries from a table, recording every query. */
function envWith(table: Record<string, { mime: string; etag: string; data: ArrayBuffer | number[] }>) {
  const queries: string[] = [];
  const DB = {
    prepare: (sql: string) => {
      queries.push(sql);
      return {
        bind: (id: string) => ({ first: async () => (id in table ? { ...table[id] } : null) }),
        // `SELECT 1 FROM media LIMIT 1` — the "is anything stored at all" probe
        first: async () => (Object.keys(table).length ? { 1: 1 } : null),
      };
    },
  };
  return { env: { DB } as unknown as Env, queries };
}

describe('stored demo photos', () => {
  it('serves a stored image from the database with its type, cache headers and bytes', async () => {
    const { env } = envWith({ 'gen/feta-cheese-200g.svg': { mime: 'image/svg+xml', etag, data: bytes.buffer } });
    const res = (await serveMedia(env, 'gen/feta-cheese-200g.svg'))!;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(res.headers.get('etag')).toBe(`"${etag}"`);
    expect(await res.text()).toBe(SVG);
  });

  it('reads a BLOB the HTTP API shape too (a list of bytes)', async () => {
    const { env } = envWith({ 'osb-sheet-11mm.jpg': { mime: 'image/jpeg', etag, data: [...bytes] } });
    expect(new Uint8Array(await (await serveMedia(env, 'osb-sheet-11mm.jpg'))!.arrayBuffer())).toEqual(bytes);
  });

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const { env } = envWith({ 'a.jpg': { mime: 'image/jpeg', etag, data: bytes.buffer } });
    const res = (await serveMedia(env, 'a.jpg', `"${etag}"`))!;
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(`"${etag}"`);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
    // a different (stale) validator gets the image again
    expect((await serveMedia(env, 'a.jpg', '"old"'))!.status).toBe(200);
  });

  it('is a plain miss for a photo the database does not hold', async () => {
    const { env } = envWith({ 'a.jpg': { mime: 'image/jpeg', etag, data: bytes.buffer } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await serveMedia(env, 'missing.jpg')).toBeNull();
    // one absent photo is not "the set was never loaded" — no alarm for it
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('says so once when nothing is stored at all — the set was never loaded', async () => {
    const { env } = envWith({});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await serveMedia(env, 'a.jpg')).toBeNull();
    expect(await serveMedia(env, 'b.jpg')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/not loaded.*npm run photos/);
    warn.mockRestore();
  });
});

describe('what counts as a stored photo', () => {
  it('accepts the names of the set and nothing else', () => {
    for (const ok of ['osb-sheet-11mm.jpg', 'gen/feta-cheese-200g.svg', 'a-b-c.webp', 'x.jpeg']) expect(isMediaFile(ok), ok).toBe(true);
    for (const bad of ['', 'missing', 'a.jpg/x', 'gen/x/y.svg', '../x.jpg', 'gen/../../x.svg', 'a.jpg?x=1', 'a.jpg%00', 'a sql.jpg', '/a.jpg', 'a.html', 'x.PNG', 'A.JPG']) {
      expect(isMediaFile(bad), bad).toBe(false);
    }
    expect(mimeOf('a.jpg')).toBe('image/jpeg');
    expect(mimeOf('gen/a.svg')).toBe('image/svg+xml');
  });

  it('never queries the database for a name that is not a stored photo', async () => {
    const { env, queries } = envWith({ 'a.jpg': { mime: 'image/jpeg', etag, data: bytes.buffer } });
    for (const bad of ['../a.jpg', 'gen/../../a.jpg', 'a.jpg/x', 'A.JPG', 'gen/a.jpg\x00']) {
      expect(await serveMedia(env, bad), bad).toBeNull();
    }
    expect(queries).toHaveLength(0);
  });

  it('tells the demo photo set apart from everything else', () => {
    expect(demoPhotoUrl('/media/a.jpg')).toBe('/media/a.jpg');
    expect(demoPhotoUrl('/media/gen/a.svg')).toBe('/media/gen/a.svg');
    expect(demoPhotoUrl('/demo-products/a.jpg')).toBe('/demo-products/a.jpg'); // the pre-database scheme
    for (const other of ['/uploads/owner.png', 'https://cdn.example/a.jpg', '', null, undefined, 42, '/media/../x.jpg']) {
      expect(demoPhotoUrl(other), String(other)).toBeNull();
    }
  });
});
