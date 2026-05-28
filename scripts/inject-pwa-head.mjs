// Post-export fixup: Expo's web "single" output gives no hook to customize the
// <head> (+html.tsx is ignored in this mode), so we patch the built HTML here:
//   1. iOS apple-touch-icon (Add-to-Home-Screen icon, patch #a6a34882)
//   2. viewport zoom-lock (maximum-scale=1, user-scalable=no)
// Each step is idempotent — safe to run on every build.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function patch(file) {
  if (!existsSync(file)) return;
  let html = readFileSync(file, 'utf8');
  let changed = false;

  // 1. iOS apple-touch-icon. Reuse the base path Expo baked into the favicon
  // link so this keeps working if app.json's baseUrl ever changes.
  if (!html.includes('rel="apple-touch-icon"')) {
    const base = html.match(/href="([^"]*)\/favicon\.ico"/)?.[1] ?? '/Stock';
    const link = `<link rel="apple-touch-icon" sizes="180x180" href="${base}/apple-touch-icon.png" />`;
    html = html.replace('</head>', `  ${link}\n</head>`);
    changed = true;
  }

  // 2. Lock pinch-zoom — Expo's viewport meta omits maximum-scale/user-scalable.
  if (!/maximum-scale/.test(html)) {
    html = html.replace(
      /(<meta name="viewport" content=")([^"]*)(")/,
      (_m, open, content, close) =>
        `${open}${content}, maximum-scale=1, user-scalable=no${close}`,
    );
    changed = true;
  }

  if (changed) {
    writeFileSync(file, html);
    console.log(`[inject-pwa-head] patched ${file}`);
  }
}

patch(join('dist', 'index.html'));
patch(join('dist', '404.html'));
