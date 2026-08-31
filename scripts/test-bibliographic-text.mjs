import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-bibliographic-text-'));

try {
  const output = path.join(scratch, 'bibliographic-text.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/bibliographicText.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  const { bibliographicPlainText } = await import(pathToFileURL(output).href);

  assert.equal(
    bibliographicPlainText('<span style="font-variant:small-caps;">CLE</span> peptides in plant-biotic interactions'),
    'CLE peptides in plant-biotic interactions',
  );
  assert.equal(
    bibliographicPlainText('  <i>Arabidopsis</i><br>and H<sub>2</sub>O &amp; salt&nbsp;stress  '),
    'Arabidopsis and H2O & salt stress',
  );
  assert.equal(bibliographicPlainText('A &lt; B and C &#62; D'), 'A < B and C > D',
    'decoded comparison signs remain text because tags are stripped first');
  assert.equal(bibliographicPlainText('2 < 3 and 4 > 1'), '2 < 3 and 4 > 1',
    'unencoded mathematical comparison signs are not mistaken for tags');
  assert.equal(bibliographicPlainText('A&#x1F331;B &#55296;'), 'A🌱B �',
    'valid supplementary code points decode and invalid surrogate values cannot abort an import');
  assert.equal(bibliographicPlainText('<!-- note --><div> A </div>\n<section>B</section>'), 'A B');
  assert.equal(bibliographicPlainText('<span title="A > B">Visible</span>'), 'Visible',
    'a greater-than sign inside a quoted attribute does not leak the rest of the tag');
  assert.equal(bibliographicPlainText('Keep <span title="truncated"'), 'Keep <span title="truncated"',
    'malformed unterminated markup is preserved instead of deleting title text');
  assert.equal(bibliographicPlainText(null), '');

  console.log('Bibliographic plain-text tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
