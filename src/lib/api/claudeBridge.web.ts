/**
 * Web stub — keeps @anthropic-ai/sdk out of the web bundle (spec §12: web is
 * preview-only in v1). Capture falls back to the local heuristic parser.
 */
export const CLAUDE_AVAILABLE = false;

export async function claudeText(): Promise<string> {
  throw new Error('Claude API is disabled on the web build (spec §12).');
}
