import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

/** Build the cookie-authenticated server SPA as a self-contained static fallback. */
export default defineConfig({
  root: path.resolve(__dirname),
  base: '/app/',
  resolve: {
    alias: [
      { find: '@shared', replacement: path.resolve(__dirname, 'shared') },
      { find: '../i18n', replacement: path.resolve(__dirname, 'src/serverWeb/i18nShim.ts') },
    ],
  },
  // Vite preserves the source file's directory for an HTML input outside the project root.
  // The server's static fallback contract is intentionally flatter: /web, /app and every
  // nested client route all resolve to this one index.html.
  plugins: [react(), {
    name: 'server-web-flat-html',
    writeBundle() {
      const nested = path.resolve(__dirname, 'server/dist/web/server/web.html');
      const index = path.resolve(__dirname, 'server/dist/web/index.html');
      if (fs.existsSync(nested)) {
        fs.renameSync(nested, index);
        const nestedDir = path.dirname(nested);
        if (fs.existsSync(nestedDir) && fs.readdirSync(nestedDir).length === 0) fs.rmdirSync(nestedDir);
      }
      // The login uses the exact living WebGL organism from the public Nodus site.
      // Copy it into the self-contained Server artifact so Docker never needs the
      // site source tree at runtime.
      fs.copyFileSync(
        path.resolve(__dirname, 'site/assets/js/organism.js'),
        path.resolve(__dirname, 'server/dist/web/organism.js'),
      );
    },
  }],
  build: {
    outDir: path.resolve(__dirname, 'server/dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: { index: path.resolve(__dirname, 'server/web.html') },
      output: { entryFileNames: 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
    },
  },
});
