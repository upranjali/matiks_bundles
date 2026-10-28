// Minimal stand-in for the Supabase gateway: /rest/v1 -> PostgREST, plus the two auth endpoints
// the app touches when a session already exists. Test use only.
const http = require('http');
const crypto = require('crypto');
const SECRET = 'e2e-test-secret-that-is-at-least-32-chars-long';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(claims) { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(claims); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; }
function verify(t) { try { const [h, p, s] = t.split('.'); if (crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null; return JSON.parse(Buffer.from(p, 'base64url')); } catch { return null; } }
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/rest/v1')) {
    const headers = { ...req.headers }; delete headers.host;
    const auth = headers.authorization || '';
    const claims = verify(auth.replace(/^Bearer /, ''));
    if (!claims || claims.role === 'anon') delete headers.authorization; // anon key -> anon role
    const p = http.request({ host: 'localhost', port: 3001, path: url.pathname.replace('/rest/v1', '') + url.search, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res); });
    req.pipe(p); return;
  }
  if (url.pathname === '/auth/v1/user') {
    const c = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
    res.writeHead(c ? 200 : 401, { 'content-type': 'application/json', ...cors });
    return res.end(JSON.stringify(c ? { id: c.sub, email: c.email, aud: 'authenticated', role: 'authenticated' } : { msg: 'invalid' }));
  }
  if (url.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
  if (url.pathname === '/auth/v1/otp') { res.writeHead(200, { 'content-type': 'application/json', ...cors }); return res.end('{}'); }
  if (url.pathname === '/mint') { // test helper
    const email = url.searchParams.get('email'); const now = Math.floor(Date.now() / 1000);
    const claims = { sub: crypto.createHash('md5').update(email).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'), email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 7200 };
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    return res.end(JSON.stringify({ access_token: sign(claims), token_type: 'bearer', expires_in: 7200, expires_at: now + 7200, refresh_token: 'x', user: { id: claims.sub, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }));
  }
  if (url.pathname === '/anonkey') { const now = Math.floor(Date.now() / 1000); res.writeHead(200, cors); return res.end(sign({ role: 'anon', iat: now, exp: now + 86400 })); }
  res.writeHead(404, cors); res.end('{}');
}).listen(54321, () => console.log('gateway on 54321'));
