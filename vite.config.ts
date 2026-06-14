import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';

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
  'openai',
];

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
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
            rollupOptions: { external: mainExternals },
          },
        },
      },
    }),
    renderer(),
  ],
});
