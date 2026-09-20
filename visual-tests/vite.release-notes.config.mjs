import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Render the production modal in isolation, without launching Electron or a user profile.
export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: { entries: ['visual-tests/release-notes-harness.html'] },
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { host: '127.0.0.1', port: 5198, strictPort: true },
});
