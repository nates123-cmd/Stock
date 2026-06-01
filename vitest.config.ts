import { defineConfig } from 'vitest/config';
import path from 'node:path';

// QA test harness (additive — no app source touched). Resolves the project's
// `@/*` path alias (tsconfig.json) so tests import the REAL shipped modules
// from src/. Runs in node; Stock's pure helpers don't need a DOM.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
