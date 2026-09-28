import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-calendar-test-'));
const bundle = path.join(temporary, 'calendar.mjs');
await build({ stdin: { contents: `export * from './electron/calendar/ical'; export * from './electron/calendar/appleCalendarCore'; export * from './electron/calendar/appleCalendarState';`, resolveDir: root }, outfile: bundle, platform: 'node', bundle: true, format: 'esm', logLevel: 'silent' });
const { renderCalendarIcs, foldIcsLine, calendarEventDates, appleCalendarPayload, appleCalendarMarker, planAppleCalendarChanges, syncAppleCalendarBinding, readAppleCalendarState, writeAppleCalendarState } = await import(pathToFileURL(bundle).href);
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

const makeEvent = (patch = {}) => ({ id: 'evt-1', title: 'Clase de biología', description: 'Aula 2', url: 'https://example.test/?a=1&b=2', startsAt: '2026-09-27T09:00:00Z', endsAt: null, allDay: false, reminderAt: null, reminderMinutes: 10, notes: 'Private study notes', ...patch });
const binding = (id = 'icloud') => ({ enabled: true, calendarId: id, calendarName: 'Nodus', links: {}, pending: {}, lastSyncedAt: null });
const unfold = (ics) => ics.replace(/\r\n[ \t]/g, '');

test('Outlook ICS is UTF-8 folded, escaped, stable, UTC and has a usable duration', () => {
  const event = makeEvent({ title: '🧪 中文 á '.repeat(30), description: 'uno, dos; tres\\cuatro\r\ncinco\rseis\nBEGIN:VEVENT', reminderAt: '2026-09-27T08:45:00Z' });
  const ics = renderCalendarIcs([event], new Date('2026-09-01T00:00:00Z'));
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(ics.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
  const plain = unfold(ics);
  assert.match(plain, /UID:evt-1@nodus\r\n/);
  assert.match(plain, /DTSTART:20260927T090000Z\r\nDTEND:20260927T100000Z/);
  assert.match(plain, /TRIGGER;VALUE=DATE-TIME:20260927T084500Z/);
  assert.equal(plain.split('\r\n').filter((line) => line === 'BEGIN:VEVENT').length, 1, 'description cannot inject an event');
  assert.ok(plain.includes('DESCRIPTION:uno\\, dos\\; tres\\\\cuatro\\ncinco\\nseis\\nBEGIN:VEVENT'));
  assert.ok(plain.includes(`SUMMARY:${event.title}`));
  assert.ok(!plain.includes('\uFFFD'));
  assert.ok(plain.includes('URL:https://example.test/?a=1&b=2'));
  assert.equal(unfold(foldIcsLine('a'.repeat(150))), 'a'.repeat(150));
});

test('all-day exports use DATE and exclusive end across DST, while timed events keep instants', () => {
  const before = process.env.TZ;
  process.env.TZ = 'Europe/Madrid';
  try {
    const event = makeEvent({ allDay: true, startsAt: new Date(2026, 2, 28, 10).toISOString(), endsAt: new Date(2026, 2, 29, 10).toISOString() });
    const ics = renderCalendarIcs([event]);
    assert.match(ics, /DTSTART;VALUE=DATE:20260328\r\nDTEND;VALUE=DATE:20260330/);
    const dates = calendarEventDates(event);
    assert.equal((dates.end - dates.start) / 3600000, 47);
    const single = renderCalendarIcs([{ ...event, endsAt: null }]);
    assert.match(single, /DTEND;VALUE=DATE:20260329/);
    assert.throws(() => renderCalendarIcs([makeEvent({ startsAt: 'invalid' })]), /date/i);
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});

function fixture() {
  const store = new Map();
  let durable;
  let calls = 0;
  let failAfterCommit = false;
  const io = {
    persist() { durable = structuredClone(current); },
    async mutate(operation) {
      calls++;
      assert.ok(durable.pending['evt-1'], 'intent must be persisted before the native write');
      const key = operation.calendarId + operation.marker;
      if (operation.action === 'remove') { store.delete(key); return {}; }
      const nativeId = store.get(key)?.nativeId ?? `apple-${store.size + 1}`;
      store.set(key, { nativeId, ...operation.event });
      if (failAfterCommit) { failAfterCommit = false; throw new Error('lost acknowledgement'); }
      return { nativeId };
    },
  };
  let current = binding();
  return { io, store, get current() { return current; }, get calls() { return calls; }, failNext() { failAfterCommit = true; }, restart() { current = structuredClone(durable); } };
}

test('Apple create/update/delete is idempotent and shares no private associations or notes', async () => {
  const f = fixture();
  const event = makeEvent();
  await syncAppleCalendarBinding('study', [event], f.current, f.io);
  assert.equal(f.calls, 1);
  assert.equal(f.store.size, 1);
  assert.equal(appleCalendarPayload(event).reminder, Date.parse(event.startsAt) - 600000);
  assert.ok(!JSON.stringify([...f.store.values()]).includes(event.notes));
  await syncAppleCalendarBinding('study', [{ ...event, notes: 'Edited notes', notifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], f.current, f.io);
  assert.equal(f.calls, 1, 'unshared fields and notification acknowledgements do not cause writes');
  const id = f.current.links[event.id].nativeId;
  await syncAppleCalendarBinding('study', [{ ...event, title: 'Otra clase', startsAt: '2035-01-02T15:30:00Z', reminderMinutes: null }], f.current, f.io);
  assert.equal(f.calls, 2);
  assert.equal(f.current.links[event.id].nativeId, id);
  assert.equal(f.store.size, 1);
  await syncAppleCalendarBinding('study', [], f.current, f.io);
  assert.equal(f.store.size, 0);
  assert.deepEqual(f.current.links, {});
  await syncAppleCalendarBinding('study', [], f.current, f.io);
  assert.equal(f.calls, 3);
  assert.notEqual(appleCalendarMarker('study', event.id), appleCalendarMarker('teaching', event.id));
});

test('a crash after commit recovers without duplicates, even after a newer local edit or deletion', async () => {
  for (const latest of [[makeEvent({ startsAt: '2035-01-01T00:00:00Z' })], []]) {
    const f = fixture();
    f.failNext();
    await assert.rejects(syncAppleCalendarBinding('study', [makeEvent()], f.current, f.io), /lost acknowledgement/);
    assert.equal(f.store.size, 1);
    f.restart();
    await syncAppleCalendarBinding('study', latest, f.current, f.io);
    assert.equal(f.store.size, latest.length);
    assert.deepEqual(f.current.pending, {});
    assert.equal(planAppleCalendarChanges('study', latest, f.current).length, 0);
  }
});

test('disk and native failures preserve recovery intent and stop before unsafe writes', async () => {
  let calls = 0;
  const current = binding();
  await assert.rejects(syncAppleCalendarBinding('study', [makeEvent()], current, {
    persist: () => { throw new Error('disk full'); }, mutate: async () => { calls++; return {}; },
  }), /disk full/);
  assert.equal(calls, 0);
  await assert.rejects(syncAppleCalendarBinding('study', [makeEvent()], current, {
    persist: () => {}, mutate: async () => { throw new Error('APPLE_CALENDAR_PERMISSION'); },
  }), /PERMISSION/);
  assert.ok(current.pending['evt-1']);
  assert.deepEqual(current.links, {});
});

test('disabling during a batch finishes only the in-flight write and preserves remaining work', async () => {
  const current = binding();
  const events = [makeEvent(), makeEvent({ id: 'evt-2' })];
  let keepGoing = true;
  let calls = 0;
  await syncAppleCalendarBinding('study', events, current, {
    persist: () => {}, shouldContinue: () => keepGoing,
    mutate: async () => { calls++; keepGoing = false; return { nativeId: 'apple-1' }; },
  });
  assert.equal(calls, 1);
  assert.equal(Object.keys(current.links).length, 1);
  assert.equal(planAppleCalendarChanges('study', events, current).length, 1);
});

test('state survives restart; malformed state is never silently reset', () => {
  const file = path.join(temporary, 'state', 'apple.json');
  assert.deepEqual(readAppleCalendarState(file), { version: 1, vaults: {} });
  const state = { version: 1, vaults: { study: { selected: 'icloud', bindings: { icloud: binding() } } } };
  writeAppleCalendarState(file, state);
  assert.deepEqual(readAppleCalendarState(file), state);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.writeFileSync(file, '{malformed');
  assert.throws(() => readAppleCalendarState(file), /APPLE_CALENDAR_STATE/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{malformed');
});

test('macOS service keeps vaults isolated, persists opt-in, preserves events on disable and retries on restart', { skip: process.platform !== 'darwin' }, async () => {
  const appData = path.join(temporary, 'app');
  const dbPath = path.join(temporary, 'vault.sqlite');
  fs.writeFileSync(dbPath, 'fixture');
  const context = globalThis.__calendarTest = { appData, dbPath, active: '', data: { study: [makeEvent()], teaching: [makeEvent({ title: 'Docencia' })] }, calls: [], calendarsCalls: 0 };
  const outfile = path.join(temporary, 'service.mjs');
  await build({ entryPoints: [path.join(root, 'electron/calendar/appleCalendarSync.ts')], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'calendar-test-dependencies', setup(builder) {
    builder.onResolve({ filter: /^(electron|\.\.\/db\/database|\.\.\/db\/studyLearningRepo|\.\.\/vaults\/vaultRegistry|\.\/appleCalendarBridge)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: id }) => ({ contents: {
      electron: `export const app={getPath:()=>globalThis.__calendarTest.appData};`,
      '../db/database': `export async function withVaultDatabase(id,work){globalThis.__calendarTest.active=id;return work();}`,
      '../db/studyLearningRepo': `export function getStudyPlanner(){const c=globalThis.__calendarTest;return {events:c.data[c.active]};}`,
      '../vaults/vaultRegistry': `export function getVault(id){return {id,type:id==='study'?'estudio':'docencia',path:globalThis.__calendarTest.dbPath};}`,
      './appleCalendarBridge': `export async function listAppleCalendars(){globalThis.__calendarTest.calendarsCalls++;return [{id:'icloud',title:'Nodus',source:'iCloud'}];} export async function mutateAppleCalendar(op){globalThis.__calendarTest.calls.push(op);return {nativeId:op.marker};}`,
    }[id], loader: 'js' }));
  } }] });
  const service = await import(pathToFileURL(outfile).href);
  const waitFor = async (condition) => { for (let n = 0; n < 150; n++) { if (condition()) return; await new Promise((resolve) => setTimeout(resolve, 20)); } assert.fail('service did not settle'); };
  try {
    service.startAppleCalendarSync();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(context.calls.length, 0);
    assert.equal(context.calendarsCalls, 0, 'startup must not request access or enumerate accounts');
    await service.configureAppleCalendarSync('study', { enabled: true, calendarId: 'icloud' });
    await service.configureAppleCalendarSync('teaching', { enabled: true, calendarId: 'icloud' });
    await waitFor(() => context.calls.length === 2 && service.getAppleCalendarSyncStatus('teaching').phase === 'idle');
    assert.deepEqual(context.calls.map((op) => op.event.title).sort(), ['Clase de biología', 'Docencia']);
    assert.notEqual(context.calls[0].marker, context.calls[1].marker);
    await service.configureAppleCalendarSync('study', { enabled: false });
    context.data.study = [];
    context.data.teaching = [makeEvent({ title: 'Docencia editada' })];
    service.requestAppleCalendarSync();
    await waitFor(() => context.calls.length === 3);
    assert.ok(context.calls.every((op) => op.action === 'upsert'), 'disable keeps the Apple copy');
    service.stopAppleCalendarSync();
    const restarted = await import(pathToFileURL(outfile).href + '?restart');
    try {
      assert.equal(restarted.getAppleCalendarSyncStatus('study').enabled, false);
      restarted.startAppleCalendarSync();
      await restarted.configureAppleCalendarSync('study', { enabled: true, calendarId: 'icloud' });
      await waitFor(() => context.calls.length === 4);
      assert.equal(context.calls.at(-1).action, 'remove', 're-enable reconciles local deletes while disabled');
    } finally { restarted.stopAppleCalendarSync(); }
  } finally { service.stopAppleCalendarSync(); delete globalThis.__calendarTest; }
});
