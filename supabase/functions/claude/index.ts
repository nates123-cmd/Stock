/**
 * Stock — Claude proxy (spec §11 / §14.2).
 *
 * Why this exists: the web build must not embed EXPO_PUBLIC_ANTHROPIC_API_KEY
 * (it would be lifted from the public Pages bundle), and api.anthropic.com
 * does not allow direct browser calls (CORS). This Edge Function holds the
 * key in function secrets and forwards a constrained request shape.
 *
 * Contract — POST JSON:
 *   { task: string, system: string, input: string,
 *     model?: "claude-haiku-4-5" | "claude-sonnet-4-6", maxTokens?: number }
 * Returns: { text: string }  |  { error: string }
 *
 * Secrets (supabase secrets set ...):
 *   ANTHROPIC_API_KEY   required — your Anthropic key
 *   STOCK_PROXY_SECRET  optional — if set, callers must send it in
 *                       `x-stock-proxy-secret`. NOTE: on a public Pages
 *                       deploy this lands in the client bundle too, so treat
 *                       it as throttling/obscurity, not real auth. The real
 *                       win is that the Anthropic key never leaves the server
 *                       — set an Anthropic spend limit as the backstop.
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
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

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
