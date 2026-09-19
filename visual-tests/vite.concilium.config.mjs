import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Renderer-only harness: this never launches the user's Electron profile.
export default defineConfig({ plugins: [react()], resolve: { alias: { '@shared': path.resolve('shared') } }, define: { __APP_VERSION__: JSON.stringify(version) }, server: { host: '127.0.0.1', port: 5198, strictPort: true } });
