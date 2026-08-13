// Build the shared, pure modules the Nodus Server needs into plain ESM it can just import.
//
// The server is deliberately unusual: `server/Dockerfile` copies three things into
// `node:22-alpine` and runs `node server.mjs`. No `npm install`, no build, no dependencies at
// all. That is worth keeping — it is what makes a self-hosted Nodus something you can run on
// a small box and audit in an afternoon.
//
// But the styled Deep Research document is eight hundred lines of TypeScript that the desktop
// also prints, and two copies of a design is one copy that will drift. So the source of truth
// stays in `shared/`, and this compiles it — types stripped, imports inlined — into
// `server/lib/core/generated/`. The output is committed, so the Docker build still copies a
// directory and runs it.
//
// `scripts/test-server-generated.mjs` fails if what is committed is not what this produces,
// which is the whole reason this is safe.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'server/lib/core/generated');

/** Entry points, and what the server calls them. */
export const GENERATED = [
  { entry: 'shared/deepResearchReport.ts', out: 'deepResearchReport.mjs' },
  { entry: 'shared/vaultColors.ts', out: 'vaultColors.mjs' },
];

const BANNER = `// GENERATED — do not edit.
//
// Built from shared/ by scripts/build-server-shared.mjs so the server can print the same
// document the desktop does without taking on a dependency or a build step. Edit the
// TypeScript and run \`npm run build:server-shared\`; scripts/test-server-generated.mjs
// fails if this file and that source disagree.
`;

export async function buildGenerated() {
  await mkdir(outputDir, { recursive: true });
  const written = [];
  for (const { entry, out } of GENERATED) {
    const result = await build({
      entryPoints: [path.join(repoRoot, entry)],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      // Bundled rather than left as imports: the server has no `shared/` to resolve against.
      // Nothing in this graph reaches outside it — a build error here means somebody imported
      // Electron or a DOM into a module that two processes share, which is worth failing on.
      external: [],
      legalComments: 'none',
      write: false,
      logLevel: 'silent',
    });
    const code = BANNER + result.outputFiles[0].text;
    written.push({ file: path.join(outputDir, out), code });
  }
  return written;
}

/** True when what is on disk already matches what a fresh build produces. */
export async function generatedIsCurrent() {
  const stale = [];
  for (const { file, code } of await buildGenerated()) {
    const existing = await readFile(file, 'utf8').catch(() => null);
    if (existing !== code) stale.push(path.relative(repoRoot, file));
  }
  return { current: stale.length === 0, stale };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const { file, code } of await buildGenerated()) {
    await writeFile(file, code, 'utf8');
    console.log(`wrote ${path.relative(repoRoot, file)} (${(code.length / 1024).toFixed(1)} kB)`);
  }
}
