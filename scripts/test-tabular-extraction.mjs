import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tabular-'));
const bundle = path.join(outDir, 'tabular.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/extraction/tabular.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
    '--external:adm-zip',
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
// adm-zip stays external, so make the repo's node_modules resolvable from the bundle.
process.env.NODE_PATH = [path.join(repoRoot, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
const AdmZip = require('adm-zip');
const tab = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('parseCsv handles quotes, escaped quotes and embedded delimiters/newlines', () => {
  assert.deepEqual(tab.parseCsv('a,b,c\n1,"two, still",3'), [
    ['a', 'b', 'c'],
    ['1', 'two, still', '3'],
  ]);
  assert.deepEqual(tab.parseCsv('a,b\n"line1\nline2",x'), [
    ['a', 'b'],
    ['line1\nline2', 'x'],
  ]);
  assert.deepEqual(tab.parseCsv('a\n"he said ""hi"""'), [['a'], ['he said "hi"']]);
  // CRLF line endings.
  assert.deepEqual(tab.parseCsv('a,b\r\n1,2\r\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('detectDelimiter picks the dominant delimiter of the first row', () => {
  assert.equal(tab.detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(tab.detectDelimiter('a\tb\tc'), '\t');
  assert.equal(tab.detectDelimiter('a,b,c'), ',');
  // Semicolon file parses on its own delimiter.
  assert.deepEqual(tab.parseCsv('a;b;c\n1;2;3'), [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
});

test('rowsToText emits a schema line + numbered "Header: value" records', () => {
  const text = tab.csvToText('Nombre,Año,Lugar\nJuan Pérez,1850,Sevilla\nMaría Ruiz,1860,Cádiz');
  assert.match(text, /Campos: Nombre · Año · Lugar/);
  assert.match(text, /1\. Nombre: Juan Pérez · Año: 1850 · Lugar: Sevilla/);
  assert.match(text, /2\. Nombre: María Ruiz · Año: 1860 · Lugar: Cádiz/);
});

test('rowsToText drops fully-empty rows and omits empty cells from records', () => {
  const text = tab.csvToText('a,b\n\nc,\n,d');
  assert.doesNotMatch(text, /\n\n/); // no blank record lines
  assert.match(text, /1\. a: c/);
  assert.doesNotMatch(text, /a: c · b:/); // empty b cell omitted
  assert.match(text, /2\. b: d/);
});

test('rowsToText falls back to a plain grid without a usable header', () => {
  // Single column → not treated as a header/record table.
  assert.equal(tab.csvToText('solo\nuno\ndos'), 'solo\nuno\ndos');
});

test('xlsxFileToText reads shared strings + inline numbers into records', async () => {
  const xlsxPath = path.join(outDir, 'census.xlsx');
  const zip = new AdmZip();
  zip.addFile(
    'xl/sharedStrings.xml',
    Buffer.from(
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<si><t>Nombre</t></si><si><t>Año</t></si><si><t>Lugar</t></si>` +
        `<si><t>Juan Pérez</t></si><si><t>Sevilla</t></si></sst>`
    )
  );
  zip.addFile(
    'xl/worksheets/sheet1.xml',
    Buffer.from(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>` +
        `<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>1850</v></c><c r="C2" t="s"><v>4</v></c></row>` +
        `</sheetData></worksheet>`
    )
  );
  zip.writeZip(xlsxPath);

  const text = tab.xlsxFileToText(xlsxPath);
  assert.match(text, /Campos: Nombre · Año · Lugar/);
  assert.match(text, /Nombre: Juan Pérez/);
  assert.match(text, /Año: 1850/); // inline number resolved
  assert.match(text, /Lugar: Sevilla/);
});
