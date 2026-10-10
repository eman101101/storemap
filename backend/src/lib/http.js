/** Small HTTP helpers shared by all routes. */

export function sendJson(res, status, body) {
  res.status(status).type('application/json').send(JSON.stringify(body));
}

export function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

export function notFound(res, message = 'Not found') {
  sendJson(res, 404, { error: message });
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, httpOnly = true, path = '/' } = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=Lax`;
  if (httpOnly) cookie += '; HttpOnly';
  if (maxAge !== undefined) cookie += `; Max-Age=${maxAge}`;
  res.setHeader('Set-Cookie', [...(res.getHeader('Set-Cookie') || []), cookie]);
}

export function clearCookie(res, name) {
  res.setHeader('Set-Cookie', [
    ...(res.getHeader('Set-Cookie') || []),
    `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
  ]);
}

/** Wrap an async express handler so rejections hit the error middleware. */
export function handler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** In-memory fixed-window rate limiter (per IP). Sufficient for a single node. */
export function rateLimit({ windowMs = 60_000, max = 100 }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, win] of hits) if (win.reset < cutoff) hits.delete(ip);
  }, windowMs).unref();
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let win = hits.get(ip);
    if (!win || win.reset < now) {
      win = { count: 0, reset: now + windowMs };
      hits.set(ip, win);
    }
    win.count += 1;
    if (win.count > max) {
      res.set('Retry-After', Math.ceil((win.reset - now) / 1000));
      return sendJson(res, 429, { error: 'Too many requests' });
    }
    next();
  };
}

export function slugify(text) {
  const base = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'store';
}
