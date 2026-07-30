import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Nodi's notification centre is ONE global file; the UI language is a PER-VAULT
// setting. Notifications used to be stored as finished prose, so a queue drained with
// a Spanish vault open stayed Spanish forever — and the panel, unable to match a
// sentence carrying an interpolated count against its translation tables, printed
// "This message could not be translated." (or leaked the Spanish when its heuristic
// failed to recognise it).
//
// The fix is that the store holds a catalogue KEY plus its values, and the panel
// translates it on every paint. These tests hold that line: the key survives the
// language change, and no emitter may go back to writing prose.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-nodi-ntf-'));
test.after(() => rm(outDir, { recursive: true, force: true }));

/** Bundle a TS module so its real exported values can be asserted on. */
function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const catalogue = loadModule('shared/nodiNotifications.ts');
const i18n = loadModule('src/i18n.ts');
const { NODI_NOTIFICATION_TEXT, nodiText, nodiTextSignature } = catalogue;
const { notificationLine, setActiveLang } = i18n;

const LANGUAGES = ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];

// '📅 {title}' is the calendar event's own name behind an emoji: nothing to translate,
// and every table holds it verbatim on purpose.
const LANGUAGE_NEUTRAL = new Set(['studyCalendarTitle']);

test('every catalogue entry really translates in every language', () => {
  for (const language of LANGUAGES) {
    setActiveLang(language);
    for (const [id, spanish] of Object.entries(NODI_NOTIFICATION_TEXT)) {
      if (LANGUAGE_NEUTRAL.has(id)) continue;
      const rendered = notificationLine({ id, params: sampleParams(spanish) }, undefined);
      assert.notEqual(rendered, spanish, `${language}: "${id}" fell through to Spanish`);
      assert.ok(rendered.trim(), `${language}: "${id}" rendered blank`);
      assert.doesNotMatch(rendered, /\{\w+\}/, `${language}: "${id}" left a placeholder unfilled`);
    }
  }
  setActiveLang('es');
});

/** One value per {placeholder} the Spanish source declares. */
function sampleParams(spanish) {
  const params = {};
  for (const [, name] of spanish.matchAll(/\{(\w+)\}/g)) {
    params[name] = name === 'when' ? { datetime: '2026-03-04T09:30:00.000Z' } : `«${name}»`;
  }
  return params;
}

test('the reported notification reads in the language on screen, not the one it was raised in', () => {
  // The exact pair from the bug report: a queue drained while a Spanish vault was
  // active, read later with the interface in English.
  const title = nodiText('scanQueueFailedTitle');
  const body = nodiText('scanQueueFailedBody', { done: 102, failed: 183 });

  setActiveLang('en');
  assert.equal(notificationLine(title, undefined), 'The analysis queue finished with issues');
  assert.equal(notificationLine(body, undefined), '102 tasks completed and 183 failed.');

  setActiveLang('de');
  assert.equal(notificationLine(body, undefined), '102 Aufgaben abgeschlossen und 183 fehlgeschlagen.');

  // The same stored notification, read in the language it was written in.
  setActiveLang('es');
  assert.equal(notificationLine(title, undefined), 'La cola de análisis ha terminado con incidencias');
  assert.equal(notificationLine(body, undefined), '102 tareas completadas y 183 con errores.');
});

test('no rendered notification can still say it could not be translated', () => {
  const untranslatable = 'This message could not be translated.';
  for (const language of LANGUAGES) {
    setActiveLang(language);
    for (const id of Object.keys(NODI_NOTIFICATION_TEXT)) {
      const rendered = notificationLine({ id, params: sampleParams(NODI_NOTIFICATION_TEXT[id]) }, undefined);
      assert.notEqual(rendered, untranslatable, `${language}: "${id}" reached the generic fallback`);
    }
  }
  setActiveLang('es');
});

test('a calendar reminder formats its date for the reader, not for the vault', () => {
  setActiveLang('en');
  const rendered = notificationLine(
    nodiText('studyCalendarBodyWithDetail', { when: { datetime: '2026-03-04T09:30:00.000Z' }, detail: 'Aula 2' }),
    undefined
  );
  assert.match(rendered, /^Starts on /);
  assert.doesNotMatch(rendered, /2026-03-04T09:30/, 'the raw ISO timestamp reached the panel');
  assert.match(rendered, /2026/);
  assert.ok(rendered.endsWith('Aula 2'), 'the event description was dropped');
  setActiveLang('es');
});

test('prose with no key still falls back instead of disappearing', () => {
  setActiveLang('en');
  // A provider error: runtime text nobody can key in advance.
  assert.equal(notificationLine(undefined, 'HTTP 429: rate limited'), 'HTTP 429: rate limited');
  assert.equal(notificationLine(undefined, undefined), '');
  // An id no build of this app knows about must not blank the line either.
  assert.equal(notificationLine({ id: 'removedInSomeFutureBuild' }, 'Older wording'), 'Older wording');
  setActiveLang('es');
});

test('notifications already stored as Spanish prose are re-keyed on read', () => {
  // What is sitting in the store of anyone who hits this bug today: the sentence with
  // its counts baked in, which no table lookup can match.
  setActiveLang('en');
  assert.equal(
    notificationLine(undefined, '102 tareas completadas y 183 con errores.'),
    '102 tasks completed and 183 failed.'
  );
  assert.equal(
    notificationLine(undefined, '102 tareas completadas. El conocimiento de la bóveda está actualizado.'),
    '102 tasks completed. The vault knowledge is up to date.'
  );
  setActiveLang('tr');
  assert.equal(
    notificationLine(undefined, '5 conexiones nuevas tras revisar 40 candidatos.'),
    '40 aday incelendikten sonra 5 yeni bağlantı bulundu.'
  );
  // Prose that is not one of ours must pass through untouched, not be forced into a key.
  setActiveLang('en');
  assert.equal(notificationLine(undefined, 'Connection refused by 127.0.0.1'), 'Connection refused by 127.0.0.1');
  setActiveLang('es');
});

test('deduplication keys off the values, not off rendered prose', () => {
  const first = nodiTextSignature(nodiText('scanQueueFailedBody', { done: 102, failed: 183 }));
  const again = nodiTextSignature(nodiText('scanQueueFailedBody', { failed: 183, done: 102 }));
  const other = nodiTextSignature(nodiText('scanQueueFailedBody', { done: 103, failed: 183 }));
  assert.equal(first, again, 'the same notification produced two identities');
  assert.notEqual(first, other, 'two different results collapsed into one identity');
  assert.equal(nodiTextSignature(nodiText('welcomeTitle')), 'welcomeTitle');
});

/** Slice the balanced (...) argument list that starts at `openIdx`. */
function sliceCall(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return src.slice(openIdx, i + 1); }
    else if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
    }
  }
  return src.slice(openIdx);
}

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('no notification is raised as prose', () => {
  // The regression guard. A `title:` written as a sentence — or picked with uiText(),
  // which is the same thing one step removed — is frozen the moment it is stored.
  const offenders = [];
  for (const file of walk(path.join(repoRoot, 'electron'))) {
    const src = fs.readFileSync(file, 'utf8');
    // The lookbehind skips the declaration in electron/notifications.ts; the `title:`
    // guard skips the prose mentions of the function in comments.
    for (const match of src.matchAll(/(?<!function\s)\baddNotification\(/g)) {
      const call = sliceCall(src, match.index + 'addNotification'.length);
      if (!/\btitle:/.test(call)) continue;
      const where = `${path.relative(repoRoot, file)}: ${call.slice(0, 60).replace(/\s+/g, ' ')}…`;
      if (!/\btitle:\s*nodiText\(/.test(call)) offenders.push(`${where} (title is not a catalogue key)`);
      if (/\buiText\(/.test(call)) offenders.push(`${where} (uiText renders prose at emit time)`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the catalogue covers every notification the app raises', () => {
  const ids = new Set(Object.keys(NODI_NOTIFICATION_TEXT));
  const used = new Set();
  for (const file of walk(path.join(repoRoot, 'electron'))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const match of src.matchAll(/\bnodiText\(/g)) {
      // Slice the whole call: several emitters choose their id with a ternary, so the
      // id is not always the first token after the parenthesis.
      const call = sliceCall(src, match.index + 'nodiText'.length);
      for (const [, id] of call.matchAll(/['"](\w+)['"]/g)) used.add(id);
    }
  }
  const unused = [...ids].filter((id) => !used.has(id));
  assert.deepEqual(unused, [], 'catalogue entries nothing raises');
  const unknown = [...used].filter((id) => !ids.has(id));
  assert.deepEqual(unknown, [], 'an emitter asked for an id the catalogue does not define');
});
