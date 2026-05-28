// Post-export fixup: Expo's web "single" output gives no hook to customize the
// <head> (+html.tsx is ignored in this mode), so inject the iOS apple-touch-icon
// link here. Without it, iOS "Add to Home Screen" falls back to a letter tile
// instead of the pot icon (patch #a6a34882). The icon asset ships via public/.
// Idempotent — safe to run on every build.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function patch(file) {
  if (!existsSync(file)) return;
  let html = readFileSync(file, 'utf8');
  if (html.includes('rel="apple-touch-icon"')) return;
  // Reuse the base path Expo already baked into the favicon link so this keeps
  // working if app.json's baseUrl ever changes.
  const base = html.match(/href="([^"]*)\/favicon\.ico"/)?.[1] ?? '/Stock';
  const link = `<link rel="apple-touch-icon" sizes="180x180" href="${base}/apple-touch-icon.png" />`;
  html = html.replace('</head>', `  ${link}\n</head>`);
  writeFileSync(file, html);
  console.log(`[inject-pwa-head] added apple-touch-icon to ${file}`);
}

patch(join('dist', 'index.html'));
patch(join('dist', '404.html'));
