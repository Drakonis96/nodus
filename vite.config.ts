import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';
import { createRequire } from 'node:module';

// graphology and sigma ship CJS builds that `require('events')` (a Node
// builtin). Vite's dev optimizer externalizes builtins for the browser, which
// surfaces as a runtime "Dynamic require of 'events' is not supported" crash.
// Resolve `events` to the installed browser polyfill so it gets bundled instead.
const require = createRequire(import.meta.url);
const eventsPolyfill = require.resolve('events/');

// Native node modules and Electron-only deps must stay external in the main process bundle.
const mainExternals = [
  'better-sqlite3',
  'electron',
  'pdfjs-dist',
  'mammoth',
  'adm-zip',
  'tesseract.js',
  '@napi-rs/canvas',
  '@anthropic-ai/sdk',
  '@modelcontextprotocol/sdk',
  '@modelcontextprotocol/sdk/server/mcp.js',
  '@modelcontextprotocol/sdk/server/streamableHttp.js',
  '@modelcontextprotocol/sdk/types.js',
  'openai',
  'electron-updater',
];

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      events: eventsPolyfill,
    },
  },
  optimizeDeps: {
    // Pre-bundle the WebGL graph stack (incl. the FA2 worker subpath, which the
    // dep scanner misses) so CJS→ESM interop is handled at optimize time.
    include: [
      'sigma',
      'graphology',
      'graphology-layout-forceatlas2',
      'graphology-layout-forceatlas2/worker',
      'graphology-communities-louvain',
      'events',
    ],
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: mainExternals,
              output: {
                // package.json is "type":"module", so the main bundle is ESM and lacks
                // __dirname/__filename. Re-create them from import.meta.url.
                banner:
                  "import{fileURLToPath as __nodusFU}from'node:url';import{dirname as __nodusDN}from'node:path';" +
                  'const __filename=__nodusFU(import.meta.url);const __dirname=__nodusDN(__filename);',
              },
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: mainExternals,
              // Emit a CommonJS .cjs preload: Electron loads it unambiguously as CJS,
              // which is far more reliable in packaged apps than an ESM (.mjs) preload.
              output: { format: 'cjs', entryFileNames: 'preload.cjs', inlineDynamicImports: true },
            },
          },
        },
      },
    }),
    renderer(),
  ],
});
