import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// CLAUDE_AVAILABLE is the single gate for whether AI features show. It is
// evaluated at module-load time from process.env, so each case uses a fresh
// module registry (vi.resetModules) with env set/unset before import.
const ORIG = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  delete process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  delete process.env.EXPO_PUBLIC_CLAUDE_PROXY_URL;
});

afterEach(() => {
  process.env = { ...ORIG };
});

// HARNESS LIMITATION (not an app bug): the NATIVE bridge (claudeBridge.ts)
// transitively imports `react-native` (via api/cache.ts → Platform), whose
// package entry is Flow-typed JS that Vite/rollup cannot parse
// ("Expected 'from', got 'typeOf'"). The real app bundles this with Metro,
// which handles Flow. The native gate is simply
//   CLAUDE_AVAILABLE = !!process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY
// — trivial and not worth pulling react-native through Vite for. The WEB gate
// below (claudeBridge.web.ts) is the codepath that actually ships in the PWA,
// and it is fully covered.
describe.skip('CLAUDE_AVAILABLE — native bridge (claudeBridge.ts) [Vite cannot parse react-native]', () => {
  it('keys off EXPO_PUBLIC_ANTHROPIC_API_KEY (verified by reading src, not runnable here)', () => {});
});

describe('CLAUDE_AVAILABLE — web bridge (claudeBridge.web.ts)', () => {
  it('is false without a proxy URL', async () => {
    const mod = await import('@/lib/api/claudeBridge.web');
    expect(mod.CLAUDE_AVAILABLE).toBe(false);
  });

  it('is true when EXPO_PUBLIC_CLAUDE_PROXY_URL is set', async () => {
    process.env.EXPO_PUBLIC_CLAUDE_PROXY_URL = 'https://proxy.example/claude';
    const mod = await import('@/lib/api/claudeBridge.web');
    expect(mod.CLAUDE_AVAILABLE).toBe(true);
  });

  it('does NOT key off the Anthropic key on web (key must not ship)', async () => {
    process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY = 'sk-test';
    const mod = await import('@/lib/api/claudeBridge.web');
    expect(mod.CLAUDE_AVAILABLE).toBe(false);
  });
});
