// Reads a building photo with Claude Haiku 5.5 and, when the photo has no location,
// searches the web for where that building is.
//
// Request:  POST { "image": "<base64 JPEG>", "gps": {lat,lng} | null, "near": {lat,lng} | null }
//           with the signed-in editor's Authorization header (supabase-js adds it).
// Response: 200 { name, text, address, lat, lng, source, confidence, note }
//           4xx/5xx { error }
//
// Only map editors may call it, because each call costs money.
// Needs the secret ANTHROPIC_API_KEY (Edge Functions → Secrets). Keep "Verify JWT" on.
// Logs each call's tokens to public.photo_reader_log (see supabase/visited_buildings.sql).

import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MODEL = 'claude-haiku-5-5';
const MAX_IMAGE_CHARS = 3_000_000;   // about 2.2 MB of JPEG; the page sends about 1280 px

type LatLng = { lat: number; lng: number };
const isLatLng = (p: unknown): p is LatLng =>
  !!p && typeof p === 'object' && Number.isFinite((p as LatLng).lat) && Number.isFinite((p as LatLng).lng) &&
  Math.abs((p as LatLng).lat) <= 90 && Math.abs((p as LatLng).lng) <= 180;

// Records one call's token use in public.photo_reader_log, as the signed-in editor.
// The page shows the totals (⋯ menu → Photo reader cost). A failed log never fails the reply.
type Usage = { input: number; output: number; searches: number };
async function logUsage(auth: string, u: Usage) {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !key) return;
  try {
    const r = await fetch(url + '/rest/v1/photo_reader_log', {
      method: 'POST',
      headers: { apikey: key, Authorization: auth, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ model: MODEL, input_tokens: u.input, output_tokens: u.output, web_searches: u.searches }),
    });
    await r.body?.cancel();
  } catch { /* ignore */ }
}

// True when the caller is signed in and on the map editor list.
async function isEditor(auth: string | null): Promise<boolean> {
  if (!auth) return false;
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !key) return false;
  const r = await fetch(url + '/rest/v1/rpc/is_map_editor', {
    method: 'POST', headers: { apikey: key, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}',
  });
  return r.ok && (await r.json()) === true;
}

function prompt(gps: LatLng | null, near: LatLng | null): string {
  const where = gps
    ? `The photo was taken at ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}. Do not search the web; just read the photo.`
    : `The photo has no location. The map was showing ${near ? near.lat.toFixed(5) + ', ' + near.lng.toFixed(5) : 'Kobe, Japan'}. ` +
      'If the photo shows a building name, use web search (Japanese real-estate listings such as SUUMO, HOME\'S, Homemate, ' +
      'eheya.net, or the building\'s own site) to find its address. Search in Japanese and English.';
  return [
    'This is a photo of a building in Japan, usually Kobe, or of its name sign.',
    'Read the building name exactly as written on the sign. Keep Japanese characters and Latin letters as they appear.',
    where,
    'Never invent a name, address or coordinates. If you are unsure, leave the field empty.',
    'Give the address with the block and house number (for example 御幸通3丁目2-19) when a source shows it.',
    'Only give lat/lng if a source states them for this building; otherwise leave them null.',
    'Finish with one JSON object in a ```json block, with these keys:',
    '{"name": string (building name as on the sign, or ""), "text": string[] (other text exactly as written, no comments), ' +
      '"address": string (Japanese address as precise as found, or ""), "lat": number|null, "lng": number|null, ' +
      '"source": string (URL where the address was found, or ""), "confidence": "high"|"medium"|"low", ' +
      '"note": string (one short sentence on anything uncertain)}',
  ].join('\n');
}

// Pulls the last JSON object out of the reply text.
export function parseResult(text: string) {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]);
  const tries = blocks.length ? blocks.reverse() : [text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const t of tries) {
    try {
      const o = JSON.parse(t);
      const s = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 300) : '');
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const out = {
        name: s(o.name), text: Array.isArray(o.text) ? o.text.map(s).filter(Boolean).slice(0, 8) : [],
        address: s(o.address), lat: n(o.lat), lng: n(o.lng), source: s(o.source),
        confidence: ['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'low', note: s(o.note),
      };
      if (out.lat === null || out.lng === null || !isLatLng({ lat: out.lat, lng: out.lng })) { out.lat = null; out.lng = null; }
      return out;
    } catch { /* try the next block */ }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  if (!(await isEditor(req.headers.get('Authorization')))) return reply(403, { error: 'Only map editors can use the photo reader.' });
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return reply(500, { error: 'The photo reader is not set up (no ANTHROPIC_API_KEY secret).' });

  let image: string, gps: LatLng | null, near: LatLng | null;
  try {
    const body = await req.json();
    image = String(body?.image ?? '').replace(/^data:image\/\w+;base64,/, '');
    gps = isLatLng(body?.gps) ? body.gps : null;
    near = isLatLng(body?.near) ? body.near : null;
  } catch {
    return reply(400, { error: 'Send JSON with an "image" field.' });
  }
  if (!image || image.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(image)) return reply(400, { error: 'The photo is missing or too big.' });

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
      { type: 'text', text: prompt(gps, near) },
    ],
  }];
  const tools = gps ? [] : [{ type: 'web_search_20250305' as const, name: 'web_search' as const, max_uses: 3 }];

  try {
    let res: Anthropic.Message | null = null;
    const usage: Usage = { input: 0, output: 0, searches: 0 };
    // A web search turn can pause; send it back so the server continues (at most twice).
    // Every request is billed, so usage is added up over all of them.
    for (let i = 0; i < 3; i++) {
      res = await client.messages.create({ model: MODEL, max_tokens: 4000, messages, ...(tools.length ? { tools } : {}) });
      const u = res.usage;
      usage.input += (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);
      usage.output += u?.output_tokens ?? 0;
      usage.searches += u?.server_tool_use?.web_search_requests ?? 0;
      if (res.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: res.content });
    }
    await logUsage(req.headers.get('Authorization') ?? '', usage);
    if (!res) throw new Error('No reply.');
    if (res.stop_reason === 'refusal') return reply(422, { error: 'The photo reader declined this photo.' });
    const text = res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('\n');
    const out = parseResult(text);
    if (!out) return reply(502, { error: 'The photo reader gave no usable answer.' });
    return reply(200, { ...out, usage });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? 'Claude API error ' + e.status + ': ' + e.message : (e as Error).message;
    return reply(502, { error: msg });
  }
});
