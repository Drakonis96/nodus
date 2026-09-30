// Generate release descriptions from the same English notes and order as the app.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function loadReleaseNotes() {
  const result = await build({
    stdin: { contents: "export { RELEASE_NOTES } from './shared/releaseNotes'; export * from './shared/releaseNotesPresentation';", resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false,
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

export async function generateReleaseNotes(version) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const requested = (version ?? pkg.version).replace(/^v/, '');
  if (requested !== pkg.version) throw new Error(`Release ${requested} does not match package version ${pkg.version}`);
  const { RELEASE_NOTES, releaseNoteMarkdown } = await loadReleaseNotes();
  const note = RELEASE_NOTES.find(note => note.version === requested.split('-')[0]);
  if (!note) throw new Error(`Release ${requested} has no modal notes`);
  if (note.date !== pkg.releaseMetadata.dateReleased) throw new Error(`Release ${requested} notes and metadata dates disagree`);
  // Every authored release must cover the languages available in the interface.
  for (const highlight of note.highlights) for (const lang of ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
    if (!highlight[lang]?.trim() || (lang !== 'en' && highlight[lang] === highlight.en)) throw new Error(`Release ${requested} has no ${lang} translation`);
  }
  return releaseNoteMarkdown({ ...note, version: requested });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [version, output, mode] = process.argv.slice(2);
  const body = await generateReleaseNotes(version);
  if (!output) process.stdout.write(body);
  else if (mode === '--check') {
    if (await readFile(output, 'utf8') !== body) throw new Error('Release description differs from the English modal notes');
    console.log('Release description matches the English modal notes.');
  } else {
    await writeFile(output, body);
    console.log(`Generated ${output} from the English modal notes.`);
  }
}
