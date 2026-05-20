/**
 * Web bridge to Claude via the Supabase Edge proxy (spec §11 / §14.2).
 *
 * The Anthropic SDK never enters the web bundle (Metro can't bundle it
 * cleanly, and the API key must not ship to the browser). Instead the web
 * build calls the `claude` Edge Function, which holds the key server-side.
 *
 * Enabled only when EXPO_PUBLIC_CLAUDE_PROXY_URL is set; otherwise Claude is
 * unavailable and callers fall back to the local heuristic parsers — same
 * graceful-degrade contract as before.
 */
const PROXY_URL = process.env.EXPO_PUBLIC_CLAUDE_PROXY_URL;
const PROXY_SECRET = process.env.EXPO_PUBLIC_CLAUDE_PROXY_SECRET;

// Match MODELS.fast / .reasoning in ./claude (kept literal so the SDK module
// — and its deps — stay out of the web bundle).
const FAST_MODEL = 'claude-haiku-4-5';
const REASON_MODEL = 'claude-sonnet-4-6';

export const CLAUDE_AVAILABLE = !!PROXY_URL;

async function postProxy(body: Record<string, unknown>): Promise<string> {
  if (!PROXY_URL) {
    throw new Error('Claude proxy not configured (EXPO_PUBLIC_CLAUDE_PROXY_URL).');
  }
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(PROXY_SECRET ? { 'x-stock-proxy-secret': PROXY_SECRET } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    text?: string;
    error?: string;
  };
  if (!res.ok || typeof data.text !== 'string') {
    throw new Error(`Claude proxy ${res.status}: ${data.error ?? 'unknown error'}`);
  }
  return data.text;
}

export async function claudeText(
  task: string,
  system: string,
  input: string,
): Promise<string> {
  return postProxy({ task, system, input, model: FAST_MODEL, maxTokens: 3000 });
}

export async function claudePdf(
  task: string,
  system: string,
  pdfBase64: string,
  prompt: string,
): Promise<string> {
  return postProxy({
    task,
    system,
    input: prompt,
    pdfBase64,
    model: REASON_MODEL,
    maxTokens: 3000,
  });
}

/**
 * Server-side URL fetch — same Edge Function, sidesteps the browser CORS
 * wall recipe sites set so JSON-LD parsing works on web.
 */
export async function proxyFetch(url: string): Promise<string> {
  if (!PROXY_URL) {
    throw new Error('URL fetch needs the Claude proxy (EXPO_PUBLIC_CLAUDE_PROXY_URL).');
  }
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(PROXY_SECRET ? { 'x-stock-proxy-secret': PROXY_SECRET } : {}),
    },
    body: JSON.stringify({ fetchUrl: url }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    html?: string;
    error?: string;
  };
  if (!res.ok || typeof data.html !== 'string') {
    throw new Error(
      `URL fetch proxy ${res.status}: ${data.error ?? 'unknown error'}`,
    );
  }
  return data.html;
}
