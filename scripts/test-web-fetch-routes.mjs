import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-web-fetch-'));
const outfile = path.join(root, 'webFetch.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'electron/websearch/webFetch.ts')], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  alias: { '@shared': path.join(repoRoot, 'shared') },
  external: ['electron'],
});
const { publicationsOfficeTarget } = await import(pathToFileURL(outfile).href);
test.after(() => rm(root, { recursive: true, force: true }));

test('an EU legal act is read from the Publications Office, not from the rendered page', () => {
  assert.deepEqual(publicationsOfficeTarget('https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng'), {
    url: 'http://publications.europa.eu/resource/celex/32024R1689', language: 'eng',
  });
  assert.deepEqual(publicationsOfficeTarget('https://eur-lex.europa.eu/eli/reg/2024/1689/oj/spa'), {
    url: 'http://publications.europa.eu/resource/celex/32024R1689', language: 'spa',
  });
  assert.deepEqual(publicationsOfficeTarget('https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32024R1689'), {
    url: 'http://publications.europa.eu/resource/celex/32024R1689', language: 'eng',
  });
  assert.deepEqual(publicationsOfficeTarget('https://eur-lex.europa.eu/eli/dir/2019/1024/oj/fra'), {
    url: 'http://publications.europa.eu/resource/celex/32019L1024', language: 'fra',
  });
});

test('anything that is not an identifiable EU act is left alone', () => {
  assert.equal(publicationsOfficeTarget('https://eur-lex.europa.eu/homepage.html'), null);
  assert.equal(publicationsOfficeTarget('https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ%3AL_202401689'), null, 'an OJ reference is not a CELEX identifier');
  assert.equal(publicationsOfficeTarget('https://www.cepc.gob.es/revistas/revista-de-estudios-politicos'), null);
  assert.equal(publicationsOfficeTarget('not a url'), null);
});
