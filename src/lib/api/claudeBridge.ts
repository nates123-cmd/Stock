/**
 * Native bridge to the Claude API (spec §11). Metro resolves this file for
 * ios/android; the `.web.ts` sibling is used for web so the Anthropic SDK
 * never enters the web bundle (Metro can't bundle it cleanly for web, and v1
 * web is preview-only — spec §12).
 */
import { callClaude, MODELS } from './claude';
import { makeAiCache } from './cache';

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
