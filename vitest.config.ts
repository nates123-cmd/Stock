import { defineConfig } from 'vitest/config';
import path from 'node:path';

// QA test harness (additive — no app source touched). Resolves the project's
// `@/*` path alias (tsconfig.json) so tests import the REAL shipped modules
// from src/. Runs in node; Stock's pure helpers don't need a DOM.
export default defineConfig({
  resolve: {
    // Order matters: the specific bridge alias must precede the generic '@'.
    // Tests run in node, so resolve the WEB Claude bridge (fetch-based, no
    // Anthropic SDK / native SQLite) exactly as the shipped web build does —
    // the native bridge's `typeof import()` / require() graph isn't meant for
    // the unit harness and trips vite's SSR parser.
    alias: [
      {
        find: /^@\/lib\/api\/claudeBridge$/,
        replacement: path.resolve(__dirname, 'src/lib/api/claudeBridge.web.ts'),
      },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
