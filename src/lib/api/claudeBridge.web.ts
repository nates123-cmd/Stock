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

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

// Match MODELS.fast / .reasoning in ./claude (kept literal so the SDK module
// — and its deps — stay out of the web bundle).
const FAST_MODEL = 'claude-haiku-4-5';
const REASON_MODEL = 'claude-sonnet-4-6';

export const CLAUDE_AVAILABLE = !!PROXY_URL;

/** Attempts per call; the proxy is a cold-starting Edge Function and Anthropic
 *  itself returns the odd 529, so one failed round trip is not an answer. */
const ATTEMPTS = 3;
const BACKOFF_MS = 700;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Transient = worth another go: the network dropped, the proxy or the model
 *  was busy (429/5xx), or the body came back empty / not JSON (a gateway
 *  timeout page). A 4xx that is our own fault (bad body, too large, forbidden)
 *  is final. */
function transient(status: number | null): boolean {
  return status == null || status === 429 || status >= 500;
}

async function postProxy(body: Record<string, unknown>): Promise<string> {
  if (!PROXY_URL) {
    throw new Error('Claude proxy not configured (EXPO_PUBLIC_CLAUDE_PROXY_URL).');
  }
  let lastMessage = 'no response';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let status: number | null = null;
    try {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(PROXY_SECRET ? { 'x-stock-proxy-secret': PROXY_SECRET } : {}),
        },
        body: JSON.stringify(body),
      });
      status = res.status;
      const data = (await res.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };
      if (res.ok && typeof data.text === 'string') return data.text;
      // "unknown error" used to be the whole story when the body wasn't JSON
      // (a gateway timeout page, an empty 5xx). Say what actually happened.
      lastMessage = data.error ?? (res.ok ? 'empty reply' : `status ${res.status}, no detail`);
      if (!transient(status)) break;
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : String(e);
    }
    if (attempt < ATTEMPTS) await sleep(BACKOFF_MS * attempt);
  }
  throw new Error(`Claude didn't answer (${lastMessage}). Try again in a moment.`);
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

export async function claudeImage(
  task: string,
  system: string,
  imageBase64: string,
  imageMediaType: ImageMediaType,
  prompt: string,
): Promise<string> {
  return postProxy({
    task,
    system,
    input: prompt,
    imageBase64,
    imageMediaType,
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
