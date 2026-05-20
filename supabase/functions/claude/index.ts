/**
 * Stock — multipurpose server-side proxy (spec §11 / §14.2).
 *
 * Why this exists: the browser can't reach api.anthropic.com OR cross-origin
 * recipe sites (both block CORS), and the Anthropic key must not embed in
 * the public Pages bundle. Two server-side relays in one function:
 *   1) Claude:  POST { task, system, input, model?, maxTokens?, pdfBase64? }
 *                  → { text }
 *   2) URL fetch: POST { fetchUrl }
 *                  → { html, status }
 *
 * Secrets:
 *   ANTHROPIC_API_KEY   required for Claude branch
 *   STOCK_PROXY_SECRET  optional shared secret; gates both branches
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Allowlist the two models the app uses; anything else collapses to the
// cheap one so a leaked endpoint can't be steered onto an expensive model.
const MODELS = new Set(['claude-haiku-4-5', 'claude-sonnet-4-6']);
const DEFAULT_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS_CAP = 4096;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-stock-proxy-secret',
  'Access-Control-Max-Age': '86400',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'proxy misconfigured: no ANTHROPIC_API_KEY' }, 500);

  const gate = Deno.env.get('STOCK_PROXY_SECRET');
  if (gate && req.headers.get('x-stock-proxy-secret') !== gate) {
    return json({ error: 'forbidden' }, 403);
  }

  let body: {
    task?: string;
    system?: string;
    input?: string;
    model?: string;
    maxTokens?: number;
    /** base64 application/pdf — when present, sent as a document block */
    pdfBase64?: string;
    /** URL fetch branch — when present, do a server-side GET and return html */
    fetchUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  // -------- URL fetch branch (sidesteps browser CORS for recipe sites). --
  if (typeof body.fetchUrl === 'string' && body.fetchUrl) {
    return await handleFetch(body.fetchUrl);
  }
  // -----------------------------------------------------------------------

  const system = (body.system ?? '').trim();
  const input = (body.input ?? '').trim();
  if (!system || !input) return json({ error: 'system and input are required' }, 400);

  const model = body.model && MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
  const maxTokens = Math.min(
    Math.max(1, Math.floor(body.maxTokens ?? 3000)),
    MAX_TOKENS_CAP,
  );

  // ~22 MB of PDF once base64-decoded; Anthropic's request cap is 32 MB.
  const pdf = typeof body.pdfBase64 === 'string' ? body.pdfBase64 : '';
  if (pdf && pdf.length > 30 * 1024 * 1024) {
    return json({ error: 'pdf too large' }, 413);
  }
  const content = pdf
    ? [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdf },
        },
        { type: 'text', text: input },
      ]
    : input;

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        // Mirror src/lib/api/claude.ts: cache the system prefix so repeated
        // structured-extraction calls reuse it.
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (e) {
    return json({ error: `upstream fetch failed: ${e instanceof Error ? e.message : e}` }, 502);
  }

  if (!res.ok) {
    // Surface status but never echo the key or full upstream payload.
    const detail = await res.text().catch(() => '');
    return json(
      { error: `anthropic ${res.status}`, detail: detail.slice(0, 500) },
      res.status === 429 ? 429 : 502,
    );
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = (data.content ?? [])
    .map((b) => (b.type === 'text' ? b.text ?? '' : ''))
    .join('')
    .trim();

  return json({ text });
});

/**
 * Server-side URL fetch — bypasses the browser CORS wall recipe sites set.
 * Constrained against open-relay abuse: https only, 10s timeout, 2 MB body
 * cap, browser-shaped User-Agent so recipe sites serve the public page.
 */
async function handleFetch(rawUrl: string): Promise<Response> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return json({ error: 'invalid URL' }, 400);
  }
  if (url.protocol !== 'https:') {
    return json({ error: 'https only' }, 400);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      headers: {
        // Many recipe sites serve a different (or 403) payload to obvious
        // bots — a normal-looking desktop UA gets the JSON-LD-rich page.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return json(
      { error: `fetch failed: ${e instanceof Error ? e.message : e}` },
      502,
    );
  }
  clearTimeout(timer);

  const reader = upstream.body?.getReader();
  if (!reader) return json({ error: 'empty response body' }, 502);

  const CAP = 2 * 1024 * 1024;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > CAP) {
        await reader.cancel();
        return json({ error: 'response too large' }, 413);
      }
      chunks.push(value);
    }
  } catch (e) {
    return json(
      { error: `body read failed: ${e instanceof Error ? e.message : e}` },
      502,
    );
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  // Best-effort UTF-8 decode; covers the vast majority of recipe sites.
  const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  return json({ html, status: upstream.status });
}
