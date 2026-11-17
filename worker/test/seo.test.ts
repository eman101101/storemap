import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { serveSpa } from '../src/seo';

/** Minimal D1 stand-in answering the three queries serveSpa issues. */
function fakeDb(store: Record<string, unknown> | null) {
  const make = (sql: string) => {
    const answer = {
      first: async () => {
        if (sql.includes('FROM stores')) return store;
        if (sql.includes('COUNT(*)')) return { n: 5 };
        return null;
      },
      all: async () => (sql.includes('FROM categories') ? [{ name: 'Dairy' }] : []),
      run: async () => ({}),
    };
    return { ...answer, bind: () => answer };
  };
  return { prepare: make };
}

const INDEX_HTML =
  '<!doctype html><html><head><title>StoreMap — Find products in-store</title></head><body><div id="root"></div></body></html>';

function makeApp(store: Record<string, unknown> | null) {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('config', { publicBaseUrl: 'https://map.example' });
    await next();
  });
  app.get('/s/:slug', (c) => serveSpa(c));
  return app.request(
    'http://map.example/s/evil-store',
    {},
    {
      ASSETS: { fetch: async () => new Response(INDEX_HTML, { status: 200 }) },
      DB: fakeDb(store),
    }
  );
}

/** Extract the ld+json block injected into the served HTML, if any. */
function ldJsonBlock(html: string): string | null {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return m ? m[1] : null;
}

describe('share-page JSON-LD injection', () => {
  it('escapes HTML delimiters in the ld+json block (stored XSS via store name)', async () => {
    const res = await makeApp({
      id: 's1',
      name: '</script><meta http-equiv=refresh>',
      description: '',
      logo_url: '',
      address: '',
      phone: '',
      hours: '',
      lat: null,
      lng: null,
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    const block = ldJsonBlock(html);
    expect(block).not.toBeNull();
    // </script> inside the store name must come out JSON-escaped, never literal
    expect(block).toContain('\\u003c/script\\u003e');
    expect(block).not.toContain('</script><meta');
    // no raw "<" inside the ld+json content at all — it cannot close the tag
    expect(block).not.toMatch(/</);
    // and it still parses as JSON, round-tripping the malicious name as data
    expect(JSON.parse(block!).name).toBe('</script><meta http-equiv=refresh>');
  });

  it('emits ordinary store names untouched', async () => {
    const res = await makeApp({
      id: 's1',
      name: 'Freshmart Downtown',
      description: '',
      logo_url: '',
      address: '',
      phone: '',
      hours: '',
      lat: null,
      lng: null,
    });
    const html = await res.text();
    expect(JSON.parse(ldJsonBlock(html)!).name).toBe('Freshmart Downtown');
    expect(html).toContain('<title>Freshmart Downtown · StoreMap</title>');
  });
});
