/**
 * Native bridge to the Claude API (spec §11). Metro resolves this file for
 * ios/android; the `.web.ts` sibling is used for web so the Anthropic SDK
 * never enters the web bundle (Metro can't bundle it cleanly for web, and v1
 * web is preview-only — spec §12).
 */
import { callClaude, callClaudePdf, callClaudeImage, MODELS, type ImageMediaType } from './claude';
import { makeAiCache } from './cache';

export type { ImageMediaType };

// Native talks to Anthropic directly via the SDK, which needs the client
// key; availability tracks its presence (web's sibling tracks the proxy URL).
export const CLAUDE_AVAILABLE = !!process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;

export async function claudeText(
  task: string,
  system: string,
  input: string,
): Promise<string> {
  return callClaude({
    task,
    system,
    input,
    model: MODELS.fast,
    maxTokens: 3000,
    cache: makeAiCache(task),
  });
}

/** Parse a PDF natively (spec §11.1) — reasoning model handles layout. */
export async function claudePdf(
  task: string,
  system: string,
  pdfBase64: string,
  prompt: string,
): Promise<string> {
  return callClaudePdf({
    task,
    system,
    pdfBase64,
    prompt,
    model: MODELS.reasoning,
    maxTokens: 3000,
    cache: makeAiCache(task),
  });
}

/** Parse a photo/screenshot via Claude vision (spec §11.1). */
export async function claudeImage(
  task: string,
  system: string,
  imageBase64: string,
  imageMediaType: ImageMediaType,
  prompt: string,
): Promise<string> {
  return callClaudeImage({
    task,
    system,
    imageBase64,
    imageMediaType,
    prompt,
    model: MODELS.reasoning,
    maxTokens: 3000,
    cache: makeAiCache(task),
  });
}

/** Direct page fetch — native has no browser CORS to dodge. */
export async function proxyFetch(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`URL fetch failed (HTTP ${res.status})`);
  return await res.text();
}
