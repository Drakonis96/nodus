import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, buildSync } from 'esbuild';
const require = createRequire(import.meta.url);
if (!process.versions.electron) {
  execFileSync(require('electron'), [process.argv[1]], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TZ: 'Europe/Madrid' }, stdio: 'inherit' });
  process.exit(0);
}
const temp = mkdtempSync(path.join(tmpdir(), 'nodus-focus-test-'));
try {
  buildSync({ entryPoints: ['electron/study/focusService.ts', 'electron/db/studyFocusSchema.ts', 'shared/studyFocus.ts'], outdir: temp, outbase: '.', bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { FocusService } = require(path.join(temp, 'electron/study/focusService.js'));
  await build({ entryPoints: ['electron/study/focusStore.ts'], outdir: temp, outbase: '.', bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'native-sqlite', setup(build) { build.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: require.resolve('better-sqlite3'), external: true })); } }] });
  const { importLegacyFocus } = require(path.join(temp, 'electron/study/focusStore.js'));
  const { STUDY_FOCUS_SQL, ensureStudyFocusTaskColumn } = require(path.join(temp, 'electron/db/studyFocusSchema.js'));
  const { splitFocusInterval } = require(path.join(temp, 'shared/studyFocus.js'));
  const Database = require('better-sqlite3');
  let cases = 0;
  const check = (name, fn) => { fn(); cases++; console.log(`✓ ${name}`); };
  const fixture = (start = new Date(2026, 8, 27, 10).getTime(), file = ':memory:') => {
    const db = new Database(file); db.exec(STUDY_FOCUS_SQL); db.exec('CREATE TABLE IF NOT EXISTS study_subjects (id TEXT, name TEXT, deleted_at TEXT)'); ensureStudyFocusTaskColumn(db);
    let wall = start, mono = 0, notices = 0;
    const make = () => new FocusService(db, () => wall, () => mono, () => { notices++; });
    let service = make();
    return { db, get service() { return service; }, advance(ms) { wall += ms; mono += ms; }, changeWall(ms) { wall += ms; }, restart() { service = make(); }, notices: () => notices,
      act(action, subject = null, task) { return service.act(action, service.snapshot().revision, subject, task); },
      actKeeping(action) { return service.act(action, service.snapshot().revision); } };
  };
  check('four work blocks, manual transitions, long break, exactly one completion notice per phase', () => {
    const f = fixture(); f.service.configure({ workMinutes: 1, breakMinutes: 1, longBreakMinutes: 2 });
    for (let block = 1; block <= 4; block++) {
      f.act('start'); f.advance(60001); f.service.tick(); f.service.tick();
      assert.equal(f.service.snapshot().status, 'complete'); assert.equal(f.service.snapshot().cycleBlocks, block);
      f.advance(120000); f.service.tick(); assert.equal(f.service.stats().days.at(-1).milliseconds, block * 60000);
      f.act('start'); assert.equal(f.service.snapshot().phase, block === 4 ? 'longBreak' : 'break');
      f.advance(block === 4 ? 120000 : 60000); f.service.tick();
    }
    assert.equal(f.notices(), 8); assert.equal(f.service.stats().days.at(-1).blocks, 4);
    f.act('start'); assert.equal(f.service.snapshot().phase, 'work'); f.db.close();
  });
  check('pause, resume and early finish exclude absence and preserve partial time without blocks', () => {
    const f = fixture(); f.act('start'); f.advance(22400); f.act('pause');
    f.advance(3600000); f.act('pause'); assert.equal(f.service.snapshot().elapsedMs, 22400);
    f.act('resume'); f.advance(17600); f.act('finish'); f.act('finish');
    assert.equal(f.service.stats().days.at(-1).milliseconds, 40000); assert.equal(f.service.stats().days.at(-1).blocks, 0);
    assert.equal(f.service.stats().recent[0].status, 'ended'); f.db.close();
  });
  check('duplicate/stale start, pause, resume and finish are idempotent', () => {
    const f = fixture(); const revision = f.service.snapshot().revision;
    f.service.act('start', revision); f.service.act('start', revision);
    f.advance(15000); f.act('pause'); f.service.act('resume', revision); assert.equal(f.service.snapshot().status, 'paused');
    f.act('resume'); f.service.act('finish', revision); assert.equal(f.service.snapshot().status, 'running');
    f.act('finish'); assert.equal(f.service.stats().recent.length, 1); f.db.close();
  });
  check('preferences affect only next phase; goal optional; validation rejects invalid numbers', () => {
    const f = fixture(); f.act('start'); f.service.configure({ workMinutes: 1, dailyGoalMinutes: 60, sound: false });
    assert.equal(f.service.snapshot().durationMs, 25 * 60000); f.act('finish'); f.act('start'); assert.equal(f.service.snapshot().durationMs, 60000);
    for (const value of [0, -1, 1.2, NaN, Infinity, 181]) assert.throws(() => f.service.configure({ workMinutes: value }));
    f.service.configure({ dailyGoalMinutes: null }); assert.equal(f.service.snapshot().preferences.dailyGoalMinutes, null); f.db.close();
  });
  check('unexpected exit recovers paused at last 15-second checkpoint without adding absence', () => {
    const f = fixture(); f.act('start'); f.advance(15000); f.service.tick(); f.advance(14000); f.service.tick();
    f.advance(7200000); f.restart(); assert.equal(f.service.snapshot().status, 'paused'); assert.equal(f.service.snapshot().elapsedMs, 15000);
    assert.equal(f.service.snapshot().recovered, true); f.act('resume'); f.advance(5000); f.act('finish');
    assert.equal(f.service.stats().days.at(-1).milliseconds, 20000); f.db.close();
  });
  check('real elapsed time works with delayed callbacks and wall-clock jumps', () => {
    const f = fixture(); f.act('start'); f.advance(17000); f.changeWall(-3600000); f.service.tick();
    assert.equal(f.service.snapshot().elapsedMs, 17000); f.changeWall(7200000); f.advance(1000); f.act('finish');
    assert.equal(f.service.stats().recent[0].milliseconds, 18000); f.db.close();
  });
  check('midnight splits partial minutes exactly; blocks credited once on completion day', () => {
    const f = fixture(new Date(2026, 8, 26, 23, 59, 30).getTime()); f.service.configure({ workMinutes: 1 }); f.act('start'); f.advance(60000); f.service.tick();
    const days = f.service.stats().days.slice(-2); assert.deepEqual(days.map(d => [d.milliseconds, d.blocks]), [[30000, 0], [30000, 1]]); f.db.close();
  });
  check('DST boundaries use local midnights, with 23/25-hour days', () => {
    for (const [month, day, hours] of [[2, 29, 23], [9, 25, 25]]) {
      const start = new Date(2026, month, day).getTime(); const parts = splitFocusInterval(start, (hours + 1) * 3600000);
      assert.equal(parts.length, 2); assert.equal(parts[0].milliseconds, hours * 3600000); assert.equal(parts[1].milliseconds, 3600000);
    }
  });
  check('per-vault isolation, empty days, subject snapshots and reopen persistence', () => {
    const a = fixture(); const b = fixture(); a.db.prepare('INSERT INTO study_subjects (id, name) VALUES (?, ?)').run('history', 'Historia');
    a.act('start', 'history'); a.advance(12345); a.service.pause(); a.restart();
    assert.equal(a.service.stats().recent[0].subjectName, 'Historia'); assert.equal(a.service.stats().recent[0].milliseconds, 12345);
    assert.equal(b.service.stats().recent.length, 0); assert.equal(b.service.stats().days.length, 84); assert.ok(b.service.stats().days.every(d => d.milliseconds === 0));
    a.db.close(); b.db.close();
  });
  check('interval/state write failure rolls back atomically, retry cannot duplicate time', () => {
    const f = fixture(); f.act('start'); f.advance(15000);
    f.db.exec("CREATE TRIGGER reject_focus BEFORE INSERT ON study_focus_intervals BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    assert.throws(() => f.service.tick()); assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM study_focus_intervals').get().n, 0);
    f.db.exec('DROP TRIGGER reject_focus'); f.service.tick(); f.act('finish'); assert.equal(f.service.stats().days.at(-1).milliseconds, 15000); f.db.close();
  });
  check('subject and intention carry across the break into the next block until changed', () => {
    const f = fixture(); f.db.prepare('INSERT INTO study_subjects (id, name) VALUES (?, ?)').run('history', 'Historia');
    f.service.configure({ workMinutes: 1, breakMinutes: 1 });
    f.act('start', 'history', '  Repasar   el tema 3 '); assert.equal(f.service.snapshot().task, 'Repasar el tema 3');
    f.advance(60000); f.service.tick(); f.actKeeping('start'); assert.equal(f.service.snapshot().phase, 'break');
    f.advance(60000); f.service.tick(); f.actKeeping('start');
    const next = f.service.snapshot(); assert.equal(next.phase, 'work'); assert.equal(next.subjectId, 'history'); assert.equal(next.task, 'Repasar el tema 3');
    assert.deepEqual(f.service.stats().recent.map(s => [s.subjectName, s.task]), [['Historia', 'Repasar el tema 3'], ['Historia', 'Repasar el tema 3']]);
    f.act('finish'); f.act('start', null, ''); assert.equal(f.service.snapshot().subjectId, null); assert.equal(f.service.snapshot().task, null);
    assert.equal(f.service.stats().recent[0].subjectName, null); f.db.close();
  });
  check('a carried-over subject deleted meanwhile is dropped; an explicit unknown one is refused', () => {
    const f = fixture(); f.db.prepare('INSERT INTO study_subjects (id, name) VALUES (?, ?)').run('history', 'Historia');
    f.act('start', 'history'); f.act('finish');
    f.db.prepare("UPDATE study_subjects SET deleted_at = 'now' WHERE id = 'history'").run();
    f.actKeeping('start'); assert.equal(f.service.snapshot().subjectId, null); assert.equal(f.service.stats().recent[0].subjectName, null);
    f.act('finish'); assert.throws(() => f.act('start', 'missing'), /Asignatura no encontrada/); assert.equal(f.service.snapshot().status, 'ready'); f.db.close();
  });
  check('state saved before the intention existed still loads, with every default filled in', () => {
    const f = fixture();
    f.db.prepare('INSERT INTO study_focus_state (id, state_json) VALUES (1, ?)').run(JSON.stringify({ revision: 3, phase: 'work', status: 'ready', durationMs: 1500000, elapsedMs: 0, cycleBlocks: 2, sessionId: null, subjectId: null, recovered: false, preferences: { workMinutes: 30, breakMinutes: 5, longBreakMinutes: 15, dailyGoalMinutes: null } }));
    f.restart(); const state = f.service.snapshot();
    assert.equal(state.task, null); assert.equal(state.cycleBlocks, 2); assert.equal(state.preferences.workMinutes, 30); assert.equal(state.preferences.sound, true);
    assert.equal(state.preferences.enterOnStart, true); assert.deepEqual(state.preferences.layout, {}); f.db.close();
  });
  check('focus mode layout: validated, replaced as a whole, persisted, and never shared by reference', () => {
    const f = fixture();
    f.service.configure({ layout: { 'nav:studyReview': true, 'nav:browser': false, 'header:theme': false }, enterOnStart: false });
    for (const bad of [null, [], 'x', { 'nav:studyReview': 'yes' }, { '../../etc': true }, { 'other:thing': true }, Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`nav:v${i}`, true]))]) {
      assert.throws(() => f.service.configure({ layout: bad }), /Valor inválido/);
    }
    assert.throws(() => f.service.configure({ enterOnStart: 'no' }), /Valor inválido/);
    const leaked = f.service.snapshot().preferences.layout; leaked['nav:studyReview'] = false;
    f.restart(); const prefs = f.service.snapshot().preferences;
    assert.deepEqual(prefs.layout, { 'nav:studyReview': true, 'nav:browser': false, 'header:theme': false }); assert.equal(prefs.enterOnStart, false);
    f.service.configure({ layout: {} }); f.restart(); assert.deepEqual(f.service.snapshot().preferences.layout, {}); f.db.close();
  });
  const study = { id: 'a', name: 'Estudio', type: 'estudio' };
  const research = { id: 'b', name: 'Investigación', type: 'academic' };
  check('one running block crosses vaults with exact attribution and its intention intact', () => {
    const f = fixture(); f.service.setVault(study); f.act('start', null, 'Escribir');
    const id = f.service.snapshot().sessionId;
    f.advance(12345); f.service.setVault(research); f.advance(17655);
    const state = f.service.snapshot();
    assert.equal(state.status, 'running'); assert.equal(state.sessionId, id); assert.equal(state.elapsedMs, 30000);
    assert.equal(state.originVaultId, study.id); assert.equal(state.task, 'Escribir'); assert.equal(state.cycleBlocks, 0);
    const stats = f.service.stats();
    assert.equal(stats.days.at(-1).milliseconds, 30000);
    assert.deepEqual(stats.recent[0].vaults.map(v => [v.vaultId, v.milliseconds]), [['a', 12345], ['b', 17655]]);
    assert.equal(stats.vaults.reduce((sum, v) => sum + v.days.at(-1).milliseconds, 0), 30000);
    f.db.close();
  });
  check('switching paused and break states preserves their phase; completion counted once at destination', () => {
    const f = fixture(); f.service.configure({ workMinutes: 1, breakMinutes: 1 }); f.service.setVault(study);
    f.act('start'); f.advance(20000); f.act('pause'); f.service.setVault(research); f.advance(10000);
    assert.equal(f.service.snapshot().status, 'paused'); assert.equal(f.service.snapshot().elapsedMs, 20000);
    f.act('resume'); f.advance(40000); f.service.tick();
    assert.equal(f.service.stats().vaults.find(v => v.vaultId === 'b').days.at(-1).blocks, 1);
    f.actKeeping('start'); f.advance(10000); f.service.setVault(study); f.advance(50000); f.service.tick();
    assert.equal(f.service.snapshot().phase, 'break'); assert.equal(f.notices(), 2);
    assert.equal(f.service.stats().days.at(-1).milliseconds, 60000); f.db.close();
  });
  check('layouts remain per vault while timer preferences and manual opt-out are global', () => {
    const f = fixture(); f.service.setVault(study); f.service.configure({ layout: { 'nav:browser': false }, enterOnStart: false, workMinutes: 40 });
    f.service.setVault(research); assert.deepEqual(f.service.snapshot().preferences.layout, {});
    assert.equal(f.service.snapshot().preferences.enterOnStart, false); assert.equal(f.service.snapshot().preferences.workMinutes, 40);
    f.service.configure({ layout: { 'header:theme': false } }); f.service.setVault(study);
    assert.deepEqual(f.service.snapshot().preferences.layout, { 'nav:browser': false }); f.db.close();
  });
  check('a subject is retained during a cross-vault block and dropped before a new unrelated block', () => {
    const f = fixture(); f.db.prepare('INSERT INTO study_subjects(id, name) VALUES (?, ?)').run('history', 'Historia');
    f.service.setVault(study); f.act('start', 'history'); f.advance(1000); f.service.setVault(research);
    assert.equal(f.service.snapshot().subjectVaultId, 'a'); assert.equal(f.service.snapshot().subjectName, 'Historia');
    f.act('finish'); f.actKeeping('start'); assert.equal(f.service.snapshot().subjectId, null);
    f.act('finish'); assert.throws(() => f.act('start', 'history'), /Asignatura no encontrada/); f.db.close();
  });
  check('legacy import is idempotent, preserves colliding ids, opt-out, layouts and paused recovery', () => {
    const sourceA = fixture(undefined, path.join(temp, 'legacy-a.sqlite'));
    const sourceB = fixture(undefined, path.join(temp, 'legacy-b.sqlite'));
    sourceA.act('start', null, 'Historial A'); sourceA.advance(12345); sourceA.act('pause');
    sourceA.service.configure({ enterOnStart: false, workMinutes: 35, layout: { 'nav:browser': false } });
    sourceB.act('start', null, 'Historial B'); sourceB.advance(6789); sourceB.act('pause');
    const sharedId = sourceA.service.snapshot().sessionId;
    sourceB.db.prepare('UPDATE study_focus_sessions SET id = ?').run(sharedId);
    sourceB.db.prepare('UPDATE study_focus_intervals SET session_id = ?').run(sharedId);
    const legacyB = sourceB.service.snapshot(); legacyB.sessionId = sharedId;
    sourceB.db.prepare('UPDATE study_focus_state SET state_json = ? WHERE id = 1').run(JSON.stringify(legacyB));
    const vaults = [{ ...study, path: sourceA.db.name }, { ...research, path: sourceB.db.name }];
    const global = fixture(); importLegacyFocus(global.db, vaults, 'a'); importLegacyFocus(global.db, vaults, 'a'); global.restart(); global.service.setVault(study);
    assert.equal(global.service.snapshot().status, 'paused'); assert.equal(global.service.snapshot().task, 'Historial A');
    assert.equal(global.service.snapshot().preferences.enterOnStart, false); assert.equal(global.service.snapshot().preferences.workMinutes, 35);
    assert.deepEqual(global.service.snapshot().preferences.layout, { 'nav:browser': false });
    assert.equal(global.service.stats().recent.length, 2); assert.equal(global.service.stats().days.at(-1).milliseconds, 19134);
    assert.equal(sourceA.service.stats().recent.length, 1);
    global.service.configure({ enterOnStart: true }); importLegacyFocus(global.db, vaults, 'a'); global.restart();
    assert.equal(global.service.snapshot().preferences.enterOnStart, true);
    sourceA.db.close(); sourceB.db.close(); global.db.close();
  });
  check('a failed vault-context transaction cannot duplicate already committed work', () => {
    const f = fixture(); f.service.setVault(study); f.act('start'); f.advance(15000);
    f.db.exec("CREATE TRIGGER reject_vault BEFORE INSERT ON focus_vaults BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    assert.throws(() => f.service.setVault(research)); assert.equal(f.service.context.id, 'a');
    f.db.exec('DROP TRIGGER reject_vault'); f.service.setVault(research); f.advance(1000); f.act('finish');
    assert.equal(f.service.stats().days.at(-1).milliseconds, 16000); f.db.close();
  });
  console.log(`${cases} focus integration cases passed (real SQLite).`);
} finally { rmSync(temp, { recursive: true, force: true }); }
