import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-nodi-notes-'));

try {
  const helperBundle = path.join(tmp, 'nodiNotes-helper.mjs');
  await build({
    entryPoints: [path.join(root, 'shared/nodiNotes.ts')],
    outfile: helperBundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  const helper = await import(pathToFileURL(helperBundle).href);
  assert.equal(helper.deriveNodiNoteTitle('Una nota con muchas palabras'), 'Una nota con');
  assert.equal(helper.deriveNodiNoteTitle('\n## **Plan de trabajo completo**\n- siguiente paso'), 'Plan de trabajo');
  assert.equal(helper.deriveNodiNoteTitle(''), '');

  const storeRoot = path.join(tmp, 'user-data');
  const repositoryBundle = path.join(tmp, 'nodiNotes-repository.mjs');
  await build({
    entryPoints: [path.join(root, 'electron/nodiNotes.ts')],
    outfile: repositoryBundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    tsconfig: path.join(root, 'tsconfig.json'),
    logLevel: 'silent',
    plugins: [{
      name: 'electron-test-stub',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'nodi-notes-test' }));
        buildApi.onLoad({ filter: /.*/, namespace: 'nodi-notes-test' }, () => ({
          contents: `export const app = { getPath: () => ${JSON.stringify(storeRoot)} };`,
          loader: 'js',
        }));
      },
    }],
  });
  const repository = await import(pathToFileURL(repositoryBundle).href);
  const derived = repository.saveNodiNote({ content: 'Primera nota guardada sin título manual' });
  assert.equal(derived.title, 'Primera nota guardada');
  assert.equal(derived.titleExplicit, false);
  const explicit = repository.saveNodiNote({ title: 'Título elegido', content: 'Este contenido no manda' });
  assert.equal(explicit.title, 'Título elegido');
  assert.equal(explicit.titleExplicit, true);
  const updated = repository.saveNodiNote({ id: derived.id, title: '', content: 'Nuevo comienzo para la nota' });
  assert.equal(updated.id, derived.id);
  assert.equal(updated.title, 'Nuevo comienzo para');
  assert.equal(repository.listNodiNotes().length, 2);

  const [component, css, types] = await Promise.all([
    readFile(path.join(root, 'src/components/nodi/NodiCompanion.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/nodi/companion.css'), 'utf8'),
    readFile(path.join(root, 'shared/types.ts'), 'utf8'),
  ]);
  assert.match(types, /title\?: string;[\s\S]*first three content words/, 'the bridge accepts an optional explicit title');
  assert.match(component, /const NOTE_AUTOSAVE_DELAY_MS = 600/, 'notes use a short autosave debounce');
  assert.match(component, /window\.setTimeout\(\(\) => \{ void saveNote\(\); \}, NOTE_AUTOSAVE_DELAY_MS\)/, 'typing schedules autosave');
  assert.match(component, /useEffect\(\(\) => \(\) => flushNote\(\)/, 'unmounting flushes the live note');
  assert.match(component, /noteSaveChainRef/, 'overlapping autosaves are serialized');
  assert.match(component, /deriveNodiNoteTitle\(noteDraft\)/, 'the editor previews the shared fallback title');
  assert.match(component, /className="nodi-note-title-input"/, 'users can assign an explicit title');
  assert.match(component, /t\('Guardado automáticamente'\)/, 'the footer communicates autosave');
  assert.doesNotMatch(component, /className="nodi-note-save"/, 'the editor no longer requires a manual save action');
  assert.match(css, /\.nodi-notes-list\s*\{[^}]*padding:\s*6px 10px/s, 'the list keeps a small lateral margin');
  assert.match(css, /\.nodi-note-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 30px/s, 'each note reserves a fixed column for its delete action');
  assert.match(css, /\.nodi-note-open\s*\{[^}]*overflow:\s*hidden/s, 'note text is clipped before the delete action');

  console.log('Nodi quick-note autosave tests passed!');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
