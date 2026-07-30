// The Nodi overlay and the Presenter windows no longer receive the whole bridge.
//
// Nothing else can catch a gap: src/global.d.ts declares `window.nodus: NodusApi`
// for every renderer, so a Nodi component calling a method its window does not
// expose typechecks fine and fails at runtime, in a window with no devtools open.
// This test compares the declared per-window surfaces against every
// `window.nodus.*` call in the code each window actually loads.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource, ipcCensus } from './ipc-channel-census.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const allFiles = sourceFiles(path.join(repoRoot, 'src')).map((file) => ({
  rel: path.relative(repoRoot, file).split(path.sep).join('/'),
  code: readFileSync(file, 'utf8'),
}));

/** The bridge methods called by the files a window class loads. */
function methodsUsedBy(owns) {
  const used = new Map();
  for (const { rel, code } of allFiles) {
    if (!owns(rel)) continue;
    for (const match of code.matchAll(/window\.nodus\??\.([A-Za-z0-9_]+)/g)) {
      if (!used.has(match[1])) used.set(match[1], rel);
    }
  }
  return used;
}

/** The names in a `X_WINDOW_METHODS` tuple in shared/api/windows.ts. */
function declaredMethods(constName) {
  const source = readFileSync(path.join(repoRoot, 'shared/api/windows.ts'), 'utf8');
  const start = source.indexOf(`export const ${constName} = [`);
  assert.ok(start >= 0, `${constName} is not declared in shared/api/windows.ts`);
  const end = source.indexOf('] as const', start);
  return [...source.slice(start, end).matchAll(/^\s*'([A-Za-z0-9_]+)',$/gm)].map((match) => match[1]);
}

test('the Nodi overlay declares every bridge method its code calls', () => {
  const declared = new Set(declaredMethods('NODI_WINDOW_METHODS'));
  // mascot.html loads src/mascot.tsx, whose own tree is the Nodi components. Anything
  // else in the bundle is dead code the overlay never renders.
  const used = methodsUsedBy((rel) => /nodi|mascot/i.test(rel));
  const missing = [...used].filter(([name]) => !declared.has(name)).map(([name, rel]) => `${name} (${rel})`);
  assert.deepEqual(missing, [], 'Nodi calls methods its preload does not expose');
});

test('the Presenter windows declare every bridge method their code calls', () => {
  const declared = new Set(declaredMethods('PRESENTER_WINDOW_METHODS'));
  // presenterAudience.html and presenterView.html, plus the deck and PDF helpers
  // they share. src/presenter/remote/ is the phone remote: served over HTTP by the
  // cast server, with no preload at all, so it is not a window class here.
  const used = methodsUsedBy((rel) =>
    (rel.startsWith('src/presenter/') || rel.startsWith('src/lib/presenter/')) && !rel.startsWith('src/presenter/remote/'));
  const missing = [...used].filter(([name]) => !declared.has(name)).map(([name, rel]) => `${name} (${rel})`);
  assert.deepEqual(missing, [], 'the Presenter calls methods its preload does not expose');
});

test('every declared per-window method exists on the NodusApi surface', () => {
  const { apiMethods } = ipcCensus();
  for (const constName of ['NODI_WINDOW_METHODS', 'PRESENTER_WINDOW_METHODS']) {
    for (const name of declaredMethods(constName)) {
      assert.ok(apiMethods.has(name), `${constName} lists '${name}', which NodusApi does not declare`);
    }
  }
});

test('each window class loads its own preload, sandboxed', () => {
  const expectations = [
    ['electron/main.ts', 'preload.cjs'],
    ['electron/mascotWindow.ts', 'preload.nodi.cjs'],
    ['electron/toolkit/presenter/windows.ts', 'preload.presenter.cjs'],
  ];
  for (const [file, preload] of expectations) {
    const source = readSource(file);
    assert.match(source, new RegExp(`preload: path\\.join\\(__dirname, '${preload.replace(/\./g, '\\.')}'\\)`), `${file} must load ${preload}`);
    // One line per window, and the only line that has to be reverted if a
    // sandboxed renderer ever turns out to break something subtle.
    assert.match(source, /sandbox: true,/, `${file} must sandbox its renderer`);
  }
});

test('each preload is built on its own, because a sandboxed one cannot require a chunk', () => {
  const config = readSource('vite.config.ts');
  // rollup splits shared modules into chunks as soon as a build has two entries, and
  // a sandboxed preload's `require` resolves electron and a couple of builtins only.
  assert.match(config, /inlineDynamicImports: true/, 'preload builds must stay single-file');
  for (const name of ['preload.nodi', 'preload.presenter']) {
    assert.ok(config.includes(`'${name}'`), `vite.config.ts must build ${name}`);
  }
});
