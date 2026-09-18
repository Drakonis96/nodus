// Live verification of Nodi's product documentation.
//
// The unit test proves the right sheet is retrieved for every question; this walk proves
// the answer a real model gives is grounded in it. It launches the packaged Electron app
// against a throwaway profile, copies the DeepSeek key from this machine's own profile
// (read-only — the live profile is never opened or written), asks every question in the
// shared matrix through the real Nodi pipeline with only the documentation context on,
// and checks three things per answer: it cites the sheet that answers the question, it is
// a real answer (not a refusal) for answerable questions, and it never invents its way
// past a question whose honest answer is "planned" or "not available".
//
// The walk outlives a lot of things: a shell that times out, a terminal that closes, a
// session that restarts. Any of those signals the walk process, and Playwright answers a
// signal by closing the Electron app it launched — so a single signal ninety answers in
// used to end the run there, with the app's exit code never printed and every remaining
// question recorded as a failure. The app is therefore a *restartable* resource: the walk
// says why the instance went away, brings up a fresh one against the same profile, and
// re-asks only the questions whose answers went down with it.
//
// Usage: node scripts/verify-nodi-documentation.mjs [--limit N] [--sample]
//   --kill-app-after N                take the app down after N answers, to exercise the
//                                     relaunch-and-continue path on purpose
//   NODUS_DOCS_MODEL=deepseek-flash   model id (provider is always deepseek here)
//   NODUS_DEEPSEEK_KEY_FILE=…         encrypted key file to copy into the throwaway profile
//   NODUS_DOCS_RELAUNCHES=…           replacement apps the walk may launch (default 4)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';
import { FORBIDDEN, RECALL, TRAPS } from './nodus-docs-questions.mjs';
import { createInstanceKeeper } from './lib/walk-app-instance.mjs';

const repoRoot = process.env.NODUS_REPO_ROOT ?? path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const modelId = process.env.NODUS_DOCS_MODEL ?? 'deepseek-flash';
const shots = process.env.NODUS_VERIFY_SHOTS ?? path.join(os.tmpdir(), 'nodus-docs-shots');
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 0;
const sample = process.argv.includes('--sample');

if (!process.argv.includes('--child')) {
  execFileSync(require('electron'), [import.meta.filename, '--child', ...process.argv.slice(2)], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

if (!existsSync(path.join(repoRoot, 'dist-electron/main.js')) || !existsSync(path.join(repoRoot, 'dist/index.html'))) {
  console.log('[docs] no build found — running npm run build first…');
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

const userData = mkdtempSync(path.join(os.tmpdir(), 'nodus-docs-verify-'));
mkdirSync(shots, { recursive: true });
// The live profile supplies the key; the throwaway profile stores its own copy so the
// real vaults, settings and history are never touched.
const keyFile = process.env.NODUS_DEEPSEEK_KEY_FILE
  ?? path.join(os.homedir(), 'Library', 'Application Support', 'Nodus', 'secrets', 'ai_key_deepseek.bin');
if (!existsSync(keyFile)) throw new Error(`no DeepSeek key to copy at ${keyFile}`);
mkdirSync(path.join(userData, 'secrets'), { recursive: true });
copyFileSync(keyFile, path.join(userData, 'secrets', 'ai_key_deepseek.bin'));

const childEnv = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available' };
delete childEnv.ELECTRON_RUN_AS_NODE;

const fold = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// The corpus itself, to compare an answer against the sheet it should have used.
const docsBundle = path.join(userData, 'docs-bundle.cjs');
const { build: bundle } = await import('esbuild');
await bundle({
  entryPoints: [path.join(repoRoot, 'shared/nodusDocs/index.ts')],
  outfile: docsBundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
});
const { NODUS_DOC_TOPICS, selectNodusDocs, nodusDocsIndex } = await import(`file://${docsBundle}`);
const sheets = new Map(NODUS_DOC_TOPICS.map((topic) => [topic.id, topic]));
const questions = RECALL.map(([question, ...ids]) => ({ question, ids, kind: 'answerable' }));
for (const [question, honest, ...ids] of TRAPS) questions.push({ question, ids, honest, kind: 'trap' });
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
const selected = sample ? questions.filter((_, index) => index % 5 === 0) : questions;
const filtered = only ? selected.filter((item) => item.question.toLowerCase().includes(only.toLowerCase())) : selected;
const from = Number(process.argv[process.argv.indexOf('--from') + 1]) || 0;
const to = Number(process.argv[process.argv.indexOf('--to') + 1]) || filtered.length;
const run = (limit ? filtered.slice(0, limit) : filtered).slice(from, to);

const failures = [];
const results = [];
const collected = [];
const RELAUNCH_LIMIT = Number(process.env.NODUS_DOCS_RELAUNCHES ?? 4);
const killAppAfter = Number(process.argv[process.argv.indexOf('--kill-app-after') + 1]) || 0;
let app = null;
let page = null;
let pageCrashed = false;

/** Whether the walk has an instance it can ask a question of. A crashed renderer counts as
 *  gone: the app process survives its renderer, but that window will never answer again.
 *  This must never throw: once the app is gone, Playwright's own handles start throwing
 *  (ElectronApplication.process() reads a dispatcher that no longer exists), and a dead
 *  instance is exactly what that means. */
function appIsUp() {
  try {
    return !!app && !!page && !pageCrashed
      && app.process().exitCode === null && app.process().signalCode === null
      && !page.isClosed();
  } catch {
    return false;
  }
}

/** Launch the app and leave it in the walk's starting state: settings applied, shell
 *  rendered, welcome modals out of the way. The throwaway profile keeps what the first
 *  instance wrote, so a relaunch mostly re-proves it. */
async function startWalkedApp(label) {
  const launched = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  // The exit code and signal are the part of "why the app went away" the log used to omit:
  // from the outside, quitting, being killed and crashing all look alike.
  launched.process().stdout?.on('data', (chunk) => process.stdout.write(`[app-out] ${chunk}`));
  launched.process().stderr?.on('data', (chunk) => process.stdout.write(`[app-err] ${chunk}`));
  launched.process().on('exit', (code, signal) => {
    console.log(`[docs] app exited (code=${code ?? 'null'} signal=${signal ?? 'null'}) — ${label}`);
  });
  const window = await launched.firstWindow();
  window.setDefaultTimeout(60_000);
  window.on('crash', () => {
    pageCrashed = true;
    console.log('[docs] the renderer crashed — the walk will relaunch the app');
  });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForFunction(() => !!document.getElementById('root')?.children.length, { timeout: 60_000 });
  await window.evaluate(() => window.nodus.updateSettings({
    onboardingComplete: true, recoverySetupVersion: 1, tourComplete: true, advancedTourComplete: true,
    basicsTutorialVersion: 5, uiLanguage: 'es', promptLanguage: 'es', mascotEnabled: false,
    reduceMotion: true, theme: 'dark', chatModel: { provider: 'deepseek', model: 'deepseek-flash' },
  }));
  await window.reload();
  await window.getByTestId('app-shell').waitFor({ timeout: 60_000 });
  for (let i = 0; i < 10; i++) {
    if (!await window.locator('.whats-new-backdrop, .nodi-style-backdrop').count()) break;
    await window.keyboard.press('Escape').catch(() => {});
    await window.locator('.whats-new-close').click({ force: true }).catch(() => {});
    await window.waitForTimeout(300);
  }
  pageCrashed = false;
  return { launched, window };
}

// The app a signal to *this* process takes down is not the end of the walk: the keeper
// brings up a fresh instance and the lost question is asked again on it.
const keeper = createInstanceKeeper({
  limit: RELAUNCH_LIMIT,
  isUp: appIsUp,
  close: () => app?.close().catch(() => {}),
  launch: async () => {
    ({ launched: app, window: page } = await startWalkedApp(`relaunch ${keeper.relaunches}/${RELAUNCH_LIMIT}`));
  },
  log: (message) => console.log(`[docs] ${message}`),
});

/** One Nodi answer, surviving an instance that dies under it. */
function askNodi(question, contexts = ['documentation']) {
  return keeper.ask(() => page.evaluate(async ([text, model, selected]) => {
    const answer = await window.nodus.nodiChatStream({
      messages: [{ role: 'user', content: text }],
      contexts: selected,
      model: { provider: 'deepseek', model },
    }, { onDelta: () => {} });
    return typeof answer === 'string' ? answer : JSON.stringify(answer);
  }, [question, modelId, contexts]));
}

try {
  ({ launched: app, window: page } = await startWalkedApp('first instance'));

  // A small worker pool: DeepSeek is fast, the app pipeline is not the bottleneck.
  // Stress mode: the same call N times in one app instance, to separate "this question
  // broke it" from "the hundredth call broke it".
  const stress = Number(process.argv[process.argv.indexOf('--stress') + 1]) || 0;
  if (stress) {
    const withDocs = !process.argv.includes('--no-docs');
    for (let index = 1; index <= stress; index++) {
      const answer = await page.evaluate(async ([text, model, contexts]) => window.nodus.nodiChatStream({
        messages: [{ role: 'user', content: text }], contexts, model: { provider: 'deepseek', model },
      }, { onDelta: () => {} }), ['¿Cómo abro la paleta de comandos?', modelId, withDocs ? ['documentation'] : []]);
      if (index % 20 === 0) {
        const heap = await app.evaluate(() => Math.round(process.memoryUsage().heapUsed / 1_048_576)).catch(() => -1);
        console.log(`[docs] stress ${index}/${stress} docs=${withDocs} mainHeap=${heap}MB chars=${answer.length}`);
      }
    }
    console.log('[docs] stress finished without the app exiting');
    await app.close().catch(() => {});
    process.exit(0);
  }

  const queue = [...run];
  let appKilled = false;
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      const started = Date.now();
      // Self-test for the recovery path: --kill-app-after takes the app down between
      // answers, the way an OOM or a stray kill does, so the relaunch is exercised on
      // purpose instead of assumed.
      if (killAppAfter && !appKilled && collected.length >= killAppAfter) {
        appKilled = true;
        console.log(`[docs] --kill-app-after ${killAppAfter}: taking the app down to exercise the relaunch`);
        app.process().kill('SIGKILL');
      }
      try {
        const answer = await askNodi(item.question);
        collected.push({ ...item, answer, ms: Date.now() - started });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        collected.push({ ...item, answer: '', ms: Date.now() - started, error: message });
        // A walk that could not bring the app back fails its remaining questions instead of
        // dropping them: the report then says how much of the matrix went unasked.
        if (!keeper.isUp) for (const left of queue.splice(0)) collected.push({ ...left, answer: '', ms: 0, error: message });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const cited = /base\s*:/i;
  /** Faithfulness where it can be exact: a quoted interface label or a `Menu > Option`
   *  route in the answer must exist in what the reply was served — the retrieved sheets
   *  plus the index of every sheet. That is what an invented button or path looks like,
   *  and it needs no second model to catch it. */
  const clean = (value) => value.replace(/[*_`]/g, '').trim();
  const inventedNames = (answer, material) => {
    const haystack = fold(material);
    const problems = [];
    const known = (candidate) => {
      const folded = fold(clean(candidate)).replace(/[.,;:)]+$/, '');
      if (haystack.includes(folded)) return true;
      // A route step can carry the next word of the sentence: drop up to two before giving up.
      const words = folded.split(/\s+/).filter(Boolean);
      for (let drop = 1; drop <= 2 && words.length - drop >= 1; drop++) {
        const shorter = words.slice(0, words.length - drop).join(' ');
        if (shorter.length >= 4 && haystack.includes(shorter)) return true;
      }
      return false;
    };
    for (const match of answer.matchAll(/[«"“]([^«»"”\n]{3,60})[»"”]/g)) {
      const label = clean(match[1]);
      // Spanish paraphrase is lowercase; interface names are not. This keeps «notas del
      // alumnado» out while still catching a quoted button that does not exist.
      if (!/^[A-ZÁÉÍÓÚÑ0-9]/.test(label)) continue;
      if (label.split(/\s+/).length > 6) continue;
      if (!known(label)) problems.push(`label not in the served sheets: «${label}»`);
    }
    for (const match of answer.matchAll(/\*\*([^*\n]{3,80})\*\*/g)) {
      const route = clean(match[1]);
      if (!route.includes(' > ')) continue;
      for (const segment of route.split(' > ')) {
        const step = segment.trim();
        if (step.length >= 3 && !known(step)) problems.push(`route step not in the served sheets: «${step}» of «${route}»`);
      }
    }
    for (const match of answer.matchAll(/\b([A-ZÁÉÍÓÚÑ][\wáéíóúñ]{2,}(?: > [A-ZÁÉÍÓÚÑ][\wáéíóúñ]{2,}(?: [a-záéíóúñ]{2,9})?){1,3})/g)) {
      const route = clean(match[1]);
      for (const segment of route.split(' > ')) {
        const step = segment.trim();
        if (step.length >= 3 && !known(step)) problems.push(`route step not in the served sheets: «${step}» of «${route}»`);
      }
    }
    return [...new Set(problems)].slice(0, 4);
  };
  // The checker must fire on an invention and stay quiet on a grounded answer.
  {
    const guard = 'Ajustes > Interfaz > Mascota Nodi. Pulsa «Mostrar a Nodi».';
    assert.deepEqual(inventedNames(guard, 'Ajustes > Interfaz > Mascota Nodi y el botón «Mostrar a Nodi».'), []);
    assert.ok(inventedNames('Ajustes > Laboratorio > Hechizos y pulsa «Invocar dragón».', guard).length >= 1, 'the invention checker no longer fires');
  }
  for (const item of collected) {
    const text = fold(item.answer);
    const problems = [];
    if (!item.answer || item.answer.length < 120) problems.push(`too short (${item.answer.length} chars)`);
    if (item.error) problems.push(`error: ${item.error}`);
    if (!cited.test(item.answer)) problems.push('no «Base:» line');
    for (const forbidden of FORBIDDEN) if (text.includes(fold(forbidden))) problems.push(`forbidden claim: ${forbidden}`);
    const servedIds = selectNodusDocs({ question: item.question, language: 'es' }).ids;
    const served = [
      ...servedIds.map((id) => sheets.get(id)).filter(Boolean).map((sheet) => `${sheet.body.es}\n${sheet.body.en}`),
      nodusDocsIndex('es'), nodusDocsIndex('en'),
    ].join('\n');
    if (item.answer) problems.push(...inventedNames(item.answer, served));
    if (item.kind === 'trap') {
      if (!item.honest.some((marker) => text.includes(fold(marker)))) problems.push('no honest refusal/phase/roadmap marker');
    } else {
      // Accept the sheet id in the «Base:» line, or the sheet's own title anywhere in the
      // answer: both prove the answer was written from the sheet that documents it.
      const named = item.ids.some((id) => {
        if (text.includes(fold(id))) return true;
        const title = fold(sheets.get(id)?.title?.es ?? '');
        return title.length > 10 && text.includes(title.slice(0, 24));
      });
      if (!named) problems.push(`does not cite any of ${item.ids.join(', ')}`);
    }
    const ok = problems.length === 0;
    results.push({ question: item.question, ids: item.ids, kind: item.kind, ms: item.ms, ok, problems, answer: item.answer.slice(0, 1_200) });
    if (!ok) failures.push({ question: item.question, problems });
    console.log(`[docs] ${ok ? 'ok  ' : 'FAIL'} ${item.question.slice(0, 70)}${ok ? '' : ` -> ${problems.join('; ')}`}`);
  }
  // A second model, with no documentation in its own context, compares each sampled
  // answer with the sheet it should have used. The deterministic checks above catch a
  // missing sheet; this catches an answer that reads plausibly and says something the
  // sheet does not support.
  const judgeTargets = results.filter((item) => item.kind === 'trap' || item.ids.length)
    .filter((_, index) => index % 8 === 0 || RECALL.length + index < 0);
  const trapResults = results.filter((item) => item.kind === 'trap');
  const judged = [...new Set([...trapResults, ...judgeTargets])];
  const judgeOne = async (item) => {
    const sheet = item.ids.map((id) => sheets.get(id)).find(Boolean);
    const material = sheet ? `Ficha ${sheet.id}:
${sheet.body.es}` : 'No hay ficha: la respuesta honesta debe negarse o remitir al roadmap.';
    const prompt = [
      'Eres un verificador estricto de respuestas de producto.',
      `<material>\n${material}\n</material>`,
      `Pregunta del usuario: ${item.question}`,
      `<respuesta>\n${item.answer}\n</respuesta>`,
      item.kind === 'trap'
        ? 'Comprueba que la respuesta NO invente funciones inexistentes y que deje claro que la función no está disponible, está planificada o no se puede verificar.'
        : 'Comprueba que toda afirmación de la respuesta esté respaldada por el material y que la respuesta sea útil (pasos, rutas y nombres exactos cuando proceda).',
      'Devuelve SOLO un objeto JSON, sin texto alrededor: {"faithful": true|false, "useful": true|false, "unsupported": ["afirmación no respaldada", ...]}',
    ].join('\n\n');
    const raw = await askNodi(prompt, []);
    const match = /\{[\s\S]*\}/.exec(raw ?? '');
    if (!match) return { verdict: null, raw: (raw ?? '').slice(0, 300) };
    try { return { verdict: JSON.parse(match[0]), raw: '' }; }
    catch { return { verdict: null, raw: match[0].slice(0, 300) }; }
  };
  const alive = appIsUp() && await page.evaluate(() => true).catch(() => false);
  for (const item of judged) {
    if (!alive) break;
    const { verdict, raw } = await judgeOne(item);
    const entry = results.find((result) => result.question === item.question);
    // Advisory only, and deliberately not a gate: a weak judge calls facts that are
    // literally in the sheets "unsupported", so its verdicts are reported for a human to
    // read instead of failing the walk. The deterministic checks above are the gate.
    const okVerdict = !!verdict && verdict.faithful === true && verdict.useful === true;
    if (entry) entry.judge = { ok: okVerdict, verdict, raw };
    if (!okVerdict) console.log(`[docs] note (judge) ${item.question.slice(0, 70)} -> ${verdict ? JSON.stringify(verdict) : raw}`);
    if (entry) delete entry.answer;
  }
  writeFileSync(path.join(shots, 'nodi-documentation-report.json'), JSON.stringify(results, null, 2));
  // An instance that died mid-walk is part of the result, not a footnote: a run that needed
  // one says so here, with the reason, instead of hiding it behind a green count.
  const instances = keeper.losses.length ? ` — ${keeper.losses.length} app loss(es): ${keeper.losses.join('; ')}` : '';
  console.log(`[docs] ${results.length - failures.length}/${results.length} answers grounded${instances}; report in ${shots}`);
  assert.deepEqual(failures, [], `${failures.length} of ${results.length} answers were not grounded in the documentation`);
} finally {
  await app?.close().catch(() => {});
}
