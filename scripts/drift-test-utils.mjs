// Shared helpers for the Nodus Drift tests: bundle a TypeScript module with the repo's
// `@shared` alias so the real code (not a copy) is what gets asserted on.
import { build, buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = mkdtempSync(path.join(tmpdir(), 'nodus-drift-test-'));
process.on('exit', () => { try { rmSync(outDir, { recursive: true, force: true }); } catch { /* best effort */ } });

let counter = 0;
const outfileFor = (file) => path.join(outDir, `${path.basename(file).replace(/\.\w+$/, '')}-${counter++}.cjs`);
const baseOptions = (file, outfile, extra) => ({
  entryPoints: [path.join(repoRoot, file)],
  outfile,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  logLevel: 'silent',
  alias: { '@shared': path.join(repoRoot, 'shared') },
  ...extra,
});

/** Bundle `file` (repo-relative) to CommonJS and require it. */
export function loadTs(file, { external = [], define = {} } = {}) {
  const outfile = outfileFor(file);
  buildSync(baseOptions(file, outfile, { external, define }));
  return require(outfile);
}

/**
 * The same, with modules replaced by stand-ins: a key of `stubs` is a regular expression
 * matched against the import specifier (`'^electron$'`, `'browser/session$'`), the value is
 * the CommonJS source of the stand-in. That is how a main-process module that imports
 * Electron is driven from plain Node. Plugins need esbuild's asynchronous API.
 */
export async function loadTsStubbed(file, { stubs = {}, external = [] } = {}) {
  const outfile = outfileFor(file);
  const plugins = [{
    name: 'drift-test-stubs',
    setup(builder) {
      for (const pattern of Object.keys(stubs)) {
        builder.onResolve({ filter: new RegExp(pattern) }, (args) => ({ path: args.path, namespace: 'drift-stub', pluginData: pattern }));
      }
      builder.onLoad({ filter: /.*/, namespace: 'drift-stub' }, (args) => ({ contents: stubs[args.pluginData], loader: 'js' }));
    },
  }];
  await build(baseOptions(file, outfile, { external, plugins }));
  return require(outfile);
}
