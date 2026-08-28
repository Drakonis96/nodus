// Load the desktop's append-only migration source for the server-native vault store.
//
// The server is JavaScript while the canonical SQLite schema lives in Electron's TypeScript
// tree. Keeping a second hand-copied schema here would eventually create two incompatible
// Nodus databases. esbuild is already a production dependency of the monorepo; the small
// bundle is compiled once per process and imported from a private temporary file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';

let loaded;

export async function loadCanonicalMigrations() {
  if (loaded) return loaded;
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  // In the repository this module is /repo/server/lib; in the production image it is
  // /app/lib. Resolve both layouts explicitly instead of assuming one parent depth.
  const repositoryRoot = [path.resolve(moduleDirectory, '../..'), path.resolve(moduleDirectory, '..')]
    .find((candidate) => fs.existsSync(path.join(candidate, 'electron', 'db', 'migrations.ts')));
  if (!repositoryRoot) throw new Error('Canonical Electron migrations are not present in this server runtime.');
  const source = path.join(repositoryRoot, 'electron', 'db', 'migrations.ts');
  const temporary = path.join(os.tmpdir(), `nodus-native-migrations-${process.pid}.mjs`);
  buildSync({
    entryPoints: [source],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: temporary,
    external: ['better-sqlite3'],
    alias: { '@shared': path.join(repositoryRoot, 'shared') },
    logLevel: 'silent',
  });
  loaded = await import(`${pathToFileURL(temporary).href}?v=${fs.statSync(temporary).mtimeMs}`);
  return loaded;
}
