// Expands a short Google Maps link (maps.app.goo.gl/..., goo.gl/maps/...) into the long link.
// A web page cannot do this itself because Google sends no CORS headers on the redirect.
//
// Request:  POST { "url": "https://maps.app.goo.gl/abc" }
// Response: 200 { "url": "https://www.google.com/maps/place/..." }  or  4xx/5xx { "error": "..." }
//
// Only Google short links are accepted, and only redirects to Google hosts are followed,
// so this cannot be used to fetch other sites.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export function isShortLink(u: URL): boolean {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.hostname === 'maps.app.goo.gl') return u.pathname.length > 1;
  if (u.hostname === 'goo.gl') return u.pathname.startsWith('/maps/');
  return false;
}

export function isGoogleHost(host: string): boolean {
  return host === 'goo.gl' || host.endsWith('.goo.gl') ||
    /^(?:[a-z0-9-]+\.)*google\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(host);
}

// Follow redirects by hand so every hop can be checked. Stops at the first Google Maps page.
export async function expand(start: URL, fetcher: typeof fetch = fetch): Promise<string> {
  let cur = start;
  for (let hop = 0; hop < 6; hop++) {
    // EU visitors are sent to a consent page; the real address is in its "continue" parameter.
    if (cur.hostname === 'consent.google.com') {
      const next = cur.searchParams.get('continue');
      if (!next) throw new Error('Google asked for consent and gave no link.');
      cur = new URL(next);
      continue;
    }
    if (!isGoogleHost(cur.hostname)) throw new Error('The link went somewhere other than Google.');
    if (!isShortLink(cur)) return cur.toString();
    const res = await fetcher(cur.toString(), { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
    await res.body?.cancel();
    const loc = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !loc) throw new Error('Google did not expand that link (status ' + res.status + ').');
    cur = new URL(loc, cur);
  }
  throw new Error('Too many redirects.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  let url: URL;
  try {
    const body = await req.json();
    url = new URL(String(body?.url ?? '').trim());
  } catch {
    return reply(400, { error: 'Send JSON like {"url": "https://maps.app.goo.gl/..."}.' });
  }
  if (!isShortLink(url)) return reply(400, { error: 'Only short Google Maps links are accepted.' });
  try {
    return reply(200, { url: await expand(url) });
  } catch (e) {
    return reply(502, { error: (e as Error).message });
  }
});
