/**
 * Cloudflare Pages Function: POST /api/metadata { url }
 *
 * Returns public title/author/thumbnail for a pasted Instagram, TikTok or YouTube link using each
 * platform's official oEmbed endpoint. Admins only (Supabase session checked against the admins
 * table via the am_i_admin() database function).
 *
 * SSRF stance: this never fetches the pasted URL itself. It only calls three fixed provider
 * hosts, with the link as a query parameter; redirects are refused, requests time out, bodies
 * are size-capped, and only plain-text fields come back (provider HTML is discarded).
 */
interface Env { SUPABASE_URL: string; SUPABASE_PUBLISHABLE_KEY: string }

const ALLOWED_HOSTS = new Set(['www.youtube.com', 'www.tiktok.com', 'graph.facebook.com']);
const MAX_BYTES = 256 * 1024;

function endpointFor(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|vm\.)/, '');
  const link = `https://${u.hostname.toLowerCase()}${u.pathname}`;
  if (host === 'youtube.com' || host === 'youtu.be') return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(raw)}`;
  if (host === 'tiktok.com') return `https://www.tiktok.com/oembed?url=${encodeURIComponent(link)}`;
  if (host === 'instagram.com') return `https://graph.facebook.com/v25.0/instagram_oembed?omitscript=true&url=${encodeURIComponent(link)}`;
  return null;
}

const text = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : undefined);
const httpsUrl = (v: unknown) => { try { const u = new URL(String(v)); return u.protocol === 'https:' ? u.toString().slice(0, 2000) : undefined; } catch { return undefined; } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function isAdmin(env: Env, auth: string | null): Promise<boolean> {
  if (!auth?.startsWith('Bearer ') || auth.length < 20) return false;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/am_i_admin`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: auth, 'content-type': 'application/json' },
    body: '{}',
  });
  return res.ok && (await res.json()) === true;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  if (!(await isAdmin(env, request.headers.get('authorization')))) return json({ error: 'Admins only' }, 401);
  let url = '';
  try { url = String(((await request.json()) as { url?: unknown }).url ?? '').slice(0, 2000); } catch { return json({ error: 'Bad request' }, 400); }
  const endpoint = endpointFor(url);
  if (!endpoint) return json({ status: 'blocked', error: 'no supported details source for this link' });
  if (!ALLOWED_HOSTS.has(new URL(endpoint).hostname)) return json({ status: 'blocked', error: 'provider not allowed' });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(endpoint, { signal: ctrl.signal, redirect: 'manual', headers: { accept: 'application/json' } });
    if (res.status >= 300) return json({ status: 'blocked', error: `the platform answered ${res.status}; it may be private, removed or region-locked` });
    const body = await res.text();
    if (body.length > MAX_BYTES) return json({ status: 'blocked', error: 'response too large' });
    const j = JSON.parse(body) as Record<string, unknown>;
    const title = text(j.title);
    const author = text(j.author_unique_id) ?? text(j.author_name, 120);
    const thumbnail_url = httpsUrl(j.thumbnail_url);
    return json({ status: title && thumbnail_url ? 'fetched' : title || author || thumbnail_url ? 'partial' : 'blocked', title, author, thumbnail_url, error: title || author || thumbnail_url ? undefined : 'no details returned' });
  } catch (e) {
    return json({ status: 'blocked', error: e instanceof Error && e.name === 'AbortError' ? 'the platform took too long' : 'couldn’t reach the platform' });
  } finally {
    clearTimeout(timer);
  }
};
