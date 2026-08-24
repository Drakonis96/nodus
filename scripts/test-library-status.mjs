// The library row folds five pipeline fields into one readable status. These are
// the cases that decide whether a reader trusts it: an abstract-only work must
// never be reported as one retry away from ready, and a work with no ideas must
// not be reported as missing an idea index.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-status-'));
const bundle = path.join(outDir, 'libraryStatus.cjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/libraryStatus.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
], { cwd: root, stdio: 'inherit' });
const { deriveWorkStatus, queueItemsByWork, hasNoFullText, isAbstractOnly, READY_STEPS } = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

/** A fully-analysed work with full text; individual tests override what they exercise. */
const work = (over = {}) => ({
  nodus_id: 'w1',
  zotero_key: 'ZK1',
  title: 'Obra',
  authors: [],
  themes: [],
  zoteroTags: [],
  ideaCount: 10,
  year: 2006,
  source_type: 'pdf',
  light_status: 'done',
  deep_status: 'done',
  summary_status: 'done',
  ...over,
});
const embedded = (over = {}) => ({ nodus_id: 'w1', totalIdeas: 10, embeddedIdeas: 10, complete: true, ...over });
const indexed = (over = {}) => ({ nodus_id: 'w1', totalPassages: 40, status: 'complete', ...over });

test('a fully processed work is ready, and the summary does not gate it', () => {
  assert.equal(deriveWorkStatus(work(), embedded(), indexed()).readiness, 'ready');
  // Summary is an orientation aid, not citable evidence: missing it stays green.
  const noSummary = deriveWorkStatus(work({ summary_status: 'none' }), embedded(), indexed());
  assert.equal(noSummary.readiness, 'ready');
  assert.equal(noSummary.steps.summary.state, 'missing');
  assert.ok(!READY_STEPS.includes('summary'));
});

test('an untouched work is unstarted, not incomplete', () => {
  const s = deriveWorkStatus(work({ light_status: 'none', deep_status: 'none', summary_status: 'none' }), undefined, undefined);
  assert.equal(s.readiness, 'unstarted');
});

test('a work whose text was never extracted is noText, never incomplete', () => {
  // The whole point: passages can never be indexed, so "incomplete · 1 step"
  // would invite the reader to burn tokens on a retry that cannot succeed.
  const skipped = deriveWorkStatus(work({ deep_status: 'skipped_no_text' }), undefined, undefined);
  assert.equal(skipped.readiness, 'noText');
  assert.equal(skipped.steps.ideas.state, 'blocked');
  assert.equal(skipped.steps.citable.state, 'blocked');
});

test('abstract-only is its own state, distinct from having no text at all', () => {
  // The demo corpus is entirely abstract_only, so collapsing this into "no text"
  // would make every row of a new user's first library read as broken — and it
  // would understate a work whose ideas were genuinely extracted and are usable.
  const w = work({ source_type: 'abstract_only' });
  assert.equal(isAbstractOnly(w), true);
  assert.equal(hasNoFullText(w), true);
  const s = deriveWorkStatus(w, embedded(), { nodus_id: 'w1', totalPassages: 0, status: 'missing' });
  assert.equal(s.readiness, 'abstractOnly');
  // Deep analysis really did run — it just only saw the abstract.
  assert.equal(s.steps.ideas.state, 'partial');
  assert.equal(s.steps.citable.state, 'blocked');

  // Extraction attempted, nothing to read: that IS "no text".
  assert.equal(deriveWorkStatus(work({ deep_status: 'skipped_no_text' }), undefined, undefined).readiness, 'noText');
});

test('a work with no ideas is not reported as missing its idea index', () => {
  const s = deriveWorkStatus(work({ ideaCount: 0 }), { nodus_id: 'w1', totalIdeas: 0, embeddedIdeas: 0, complete: false }, indexed());
  assert.equal(s.steps.semantic.state, 'na');
  assert.ok(!s.missing.includes('semantic'));
  assert.equal(s.readiness, 'ready');
});

test('partial embeddings and outdated passages are partial, and carry their numbers', () => {
  const s = deriveWorkStatus(
    work(),
    embedded({ embeddedIdeas: 31, totalIdeas: 47, complete: false }),
    indexed({ status: 'outdated' })
  );
  assert.equal(s.readiness, 'incomplete');
  assert.equal(s.steps.semantic.state, 'partial');
  assert.equal(s.steps.semantic.done, 31);
  assert.equal(s.steps.semantic.total, 47);
  assert.equal(s.steps.citable.state, 'partial');
  // The semantic index is shown but does not gate readiness: SQL cannot evaluate
  // its freshness, so counting it here would make the preset and the pill differ.
  assert.deepEqual(s.missing, ['citable']);
  assert.ok(!READY_STEPS.includes('semantic'));
});

test('failure outranks absence, and live queue activity outranks both', () => {
  const failed = deriveWorkStatus(work({ summary_status: 'failed', light_status: 'none' }), embedded(), indexed());
  assert.equal(failed.readiness, 'failed');

  // A queued job wins even though nothing is persisted as pending yet.
  const running = deriveWorkStatus(work({ deep_status: 'failed' }), embedded(), indexed(), [
    { id: 'q1', nodus_id: 'w1', title: 'Obra', kind: 'deep', state: 'queued' },
  ]);
  assert.equal(running.readiness, 'running');
  assert.equal(running.steps.ideas.state, 'running');
});

test('queue indexing keeps only live items and groups them by work', () => {
  const map = queueItemsByWork([
    { id: 'q1', nodus_id: 'w1', kind: 'light', state: 'running' },
    { id: 'q2', nodus_id: 'w1', kind: 'deep', state: 'queued' },
    { id: 'q3', nodus_id: 'w2', kind: 'deep', state: 'done' },
    { id: 'q4', nodus_id: 'w3', kind: 'summary', state: 'failed' },
  ]);
  assert.equal(map.get('w1').length, 2);
  // Finished and failed items are not "in flight" and must not light a row up.
  assert.equal(map.has('w2'), false);
  assert.equal(map.has('w3'), false);
});

test('the SQL presets stay in step with the JS readiness derivation', async () => {
  const [sql, repo, status] = await Promise.all([
    readFile(path.join(root, 'electron/db/readinessFilters.ts'), 'utf8'),
    readFile(path.join(root, 'electron/db/worksRepo.ts'), 'utf8'),
    readFile(path.join(root, 'src/libraryStatus.ts'), 'utf8'),
  ]);

  // Same precedence chain as deriveWorkStatus: failed, then unstarted, then the
  // two text-shortage states, and only then ready vs incomplete.
  assert.match(sql, /w\.light_status = 'failed' OR w\.deep_status = 'failed' OR w\.summary_status = 'failed'/);
  assert.match(sql, /w\.light_status = 'none' AND w\.deep_status = 'none'/);
  assert.match(sql, /w\.deep_status = 'done' AND w\.source_type IN \('abstract_only', 'none'\)/);
  assert.match(sql, /NOT \$\{FAILED\} AND NOT \$\{UNSTARTED\} AND NOT \$\{ABSTRACT_ONLY\} AND NOT \$\{NO_TEXT\}/);
  // ready and incomplete must be exact complements over the analysable set,
  // or a work would fall through both presets and be unreachable.
  assert.match(sql, /case 'ready':[\s\S]{0,120}\$\{ANALYSABLE\} AND \$\{READY_CORE\}/);
  assert.match(sql, /case 'incomplete':[\s\S]{0,140}\$\{ANALYSABLE\} AND NOT \(\$\{READY_CORE\}\)/);

  // READY_CORE must cover exactly READY_STEPS: themes, ideas and citable text.
  assert.match(status, /READY_STEPS: readonly StepId\[\] = \['themes', 'ideas', 'citable'\]/);
  assert.match(sql, /READY_CORE = `w\.light_status = 'done' AND w\.deep_status = 'done'[\s\S]{0,120}w\.deep_hash = w\.resolved_text_hash[\s\S]{0,80}\$\{HAS_IDEAS\} AND \$\{PASSAGES_COMPLETE\}`/);
  // The semantic index cannot be evaluated in SQL, so it must not gate readiness
  // on either side; if it ever appears here the two would silently disagree.
  assert.doesNotMatch(sql, /embedding_text_hash/);

  assert.match(repo, /if \(filter\.readiness\)/);
  assert.match(repo, /Object\.assign\(params, readiness\.params\)/);

  // A bare HAVING with no GROUP BY is rejected by SQLite as a non-aggregate
  // query. It shipped in the passages/!passages status filters, which threw
  // instead of filtering, and would do the same to any readiness preset that
  // reused the shape. `HAVING COUNT(*)` is that shape; the tag filter's
  // `GROUP BY … HAVING COUNT(DISTINCT …)` is a real aggregate and stays.
  assert.doesNotMatch(sql, /HAVING COUNT\(\*\)/);
  assert.doesNotMatch(repo, /HAVING COUNT\(\*\)/);
  for (const source of [sql, repo]) {
    assert.match(source, /NOT EXISTS \(\s*SELECT 1 FROM passages p/);
  }
});

test('the status modal repairs missing steps without wasting work', async () => {
  const source = await readFile(path.join(root, 'src/views/WorkStatusModal.tsx'), 'utf8');

  // Indexes are built FROM the ideas. Firing startEmbedding alongside a pending
  // deep pass would index nothing, so the chain has to take over in that case.
  assert.match(source, /if \(retryable\.includes\('themes'\) \|\| retryable\.includes\('ideas'\)\)/);
  assert.match(source, /await window\.nodus\.processFull\(work\.nodus_id\)/);
  // ...but when the ideas are already done, re-running the deep pass would purge
  // good analysis, so the individual steps must run directly instead.
  assert.match(source, /for \(const id of retryable\) await runStep\(id\)/);

  // Every step maps to its own retry, and a finished deep pass is re-scanned
  // rather than re-flagged (setManualDeep is not an idempotent retry).
  assert.match(source, /rescan\(work\.nodus_id, 'light'\)/);
  assert.match(source, /work\.deep_status === 'done'[\s\S]{0,120}rescan\(work\.nodus_id, 'deep'\)/);
  assert.match(source, /summarizeWork\(work\.nodus_id\)/);
  assert.match(source, /startEmbedding\(\[work\.nodus_id\]\)/);
  assert.match(source, /startPassageEmbedding\(\[work\.nodus_id\]\)/);

  // Blocked and not-applicable steps are terminal: offering a retry there spends
  // tokens on something that cannot succeed.
  assert.match(source, /const RETRYABLE: StepState\[\] = \['partial', 'missing', 'failed'\]/);
  assert.match(source, /role="dialog"[\s\S]{0,120}aria-modal="true"/);
});

test('the library row renders the derived status instead of the five pipeline columns', async () => {
  const source = await readFile(path.join(root, 'src/views/Library.tsx'), 'utf8');
  assert.match(source, /deriveWorkStatus/);
  // The tour and the tutorial video both anchor on this.
  assert.match(source, /data-tour="library-actions"/);
  // The pipeline columns and the per-row icon toolbar are gone.
  assert.doesNotMatch(source, /sortKey="embeddings"/);
  assert.doesNotMatch(source, /sortKey="passages"/);
  assert.doesNotMatch(source, /nodus_id\.slice\(0, 8\)/);
});
