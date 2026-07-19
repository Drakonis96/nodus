// Verifies that streaming a cited AI answer does not storm the main process
// with citation-verification IPC.
//
// The main-process handler runs a synchronous SQLite lookup per citation, and
// the citation list grows as the answer streams, so verifying on every delta
// was quadratic in answer length — it starved the event loop for the whole
// duration of every cited response.
//
// This drives the real planning module over a realistic token stream and counts
// the calls that would actually reach IPC.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-citations-'));
const bundle = path.join(dir, 'citationVerification.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'src/citationVerification.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const { collectCitations, citationKey, planCitationVerification, VERIFY_DEBOUNCE_MS } =
  require(bundle);

try {
  // --- collectCitations still behaves as it did before extraction ----------
  {
    const refs = collectCitations(
      'See [a](nodus://idea/abc) and [b](nodus://work/w-1), plus [again](nodus://idea/abc).'
    );
    assert.deepEqual(
      refs,
      [
        { kind: 'idea', id: 'abc' },
        { kind: 'work', id: 'w-1' },
      ],
      'duplicates must collapse and order must be preserved'
    );

    assert.deepEqual(collectCitations('no citations here'), []);
    assert.deepEqual(
      collectCitations('[x](nodus://passage/p%20one)'),
      [{ kind: 'passage', id: 'p one' }],
      'percent-encoded ids must be decoded'
    );
    assert.deepEqual(
      collectCitations('[bad](nodus://nonsense/zzz)'),
      [],
      'unknown citation kinds must be ignored'
    );
  }

  // --- Repeated calls are independent (no shared regex lastIndex) ----------
  {
    const text = '[a](nodus://idea/one) [b](nodus://idea/two)';
    const first = collectCitations(text);
    const second = collectCitations(text);
    assert.deepEqual(first, second, 'a second call must return the same refs, not resume mid-string');
    assert.equal(first.length, 2);
  }

  // --- The core fix: a streaming answer collapses to ONE verification ------
  {
    // A realistic cited answer: 20 citations spread through ~4000 chars,
    // delivered as ~8-char deltas the way a token stream arrives.
    const sentences = [];
    for (let i = 0; i < 20; i++) {
      sentences.push(
        `Este argumento se apoya en la evidencia recogida en el corpus ` +
          `[fuente ${i}](nodus://idea/idea-${i}), que desarrolla el punto anterior. `
      );
    }
    const full = sentences.join('');

    /**
     * Replay a stream through the planner with a modelled clock, reproducing
     * what the effect actually does: each render clears the previous pending
     * timer, so a call only reaches IPC when the content has been quiet for
     * VERIFY_DEBOUNCE_MS. `fired` is therefore the true IPC count.
     *
     * @param msPerDelta inter-token gap; real streams deliver far faster than
     *   the debounce window, which is exactly why the bursts collapse.
     */
    function replay(text, step, msPerDelta = 25) {
      const deltas = [];
      for (let i = 0; i < text.length; i += step) deltas.push(text.slice(0, i + step));

      let now = 0;
      let lastVerified = '';
      let pendingAt = null; // when the currently-scheduled timer would fire
      let pendingKey = null;
      let fired = 0;
      let skipped = 0;

      const runDueTimer = (until) => {
        if (pendingAt !== null && pendingAt <= until) {
          fired += 1;
          lastVerified = pendingKey;
          pendingAt = null;
          pendingKey = null;
        }
      };

      for (const content of deltas) {
        now += msPerDelta;
        runDueTimer(now); // any timer that came due before this render fires
        const plan = planCitationVerification(content, lastVerified);
        if (plan.action === 'verify') {
          // Re-render clears the old timer and schedules a fresh one.
          pendingAt = now + VERIFY_DEBOUNCE_MS;
          pendingKey = plan.key;
        } else if (plan.action === 'skip') {
          skipped += 1;
        }
      }
      // The stream ends; the last scheduled timer finally gets to run.
      runDueTimer(now + VERIFY_DEBOUNCE_MS);
      return { deltas: deltas.length, fired, skipped };
    }

    const stream = replay(full, 8);
    assert.ok(stream.deltas > 300, `the stream should be long enough to matter (${stream.deltas} deltas)`);

    // Before the fix, every one of those deltas fired an IPC round-trip whose
    // handler did a synchronous DB lookup per citation. Now the whole stream
    // collapses to a single call once the answer settles.
    assert.equal(
      stream.fired,
      1,
      `a continuous stream must collapse to one verification, got ${stream.fired}`
    );
    // Nothing is "skipped" mid-stream because nothing has been verified yet —
    // the saving there comes from the debounce, not the dedupe. The dedupe is
    // what protects the app AFTER the answer lands, which is asserted below.

    // The load-bearing property: cost does NOT track stream length.
    // Tripling the prose around the same 20 citations must not add any work.
    const padded = sentences
      .map((s) => `${s}${'Texto adicional sin ninguna cita para alargar la respuesta. '.repeat(3)}`)
      .join('');
    const longer = replay(padded, 8);
    assert.ok(
      longer.deltas > stream.deltas * 2,
      `the padded stream must be substantially longer (${longer.deltas} vs ${stream.deltas})`
    );
    assert.equal(
      longer.fired,
      stream.fired,
      `a 3x longer answer must cost the same (${longer.fired} vs ${stream.fired}) — ` +
        `this is what makes it linear instead of quadratic`
    );

    // Halving the delta size doubles the renders but must not change the work.
    const finer = replay(full, 4);
    assert.ok(finer.deltas > stream.deltas * 1.8, 'finer deltas must produce more renders');
    assert.equal(finer.fired, stream.fired, 'a chattier token stream must not cost more verifications');

    // A slow stream that genuinely pauses SHOULD verify as it goes — the
    // debounce must defer work, not permanently suppress it.
    const halting = replay(full, 8, VERIFY_DEBOUNCE_MS * 2);
    assert.ok(
      halting.fired > 1,
      `a stream with real pauses must verify incrementally, got ${halting.fired}`
    );
    assert.ok(
      halting.fired < halting.deltas / 5,
      `even a halting stream must not verify per render (${halting.fired}/${halting.deltas})`
    );

    // And once the citation list stops growing, further text costs nothing.
    const settled = planCitationVerification(full, citationKey(collectCitations(full)));
    assert.equal(settled.action, 'skip', 'a settled answer must not re-verify');
    const withMoreProse = planCitationVerification(
      `${full} Y una conclusión final sin ninguna cita nueva.`,
      citationKey(collectCitations(full))
    );
    assert.equal(withMoreProse.action, 'skip', 'appending uncited prose must not trigger IPC');
  }

  // --- Clearing behaviour --------------------------------------------------
  {
    assert.deepEqual(planCitationVerification('plain text', ''), { action: 'clear' });
    assert.deepEqual(
      planCitationVerification('', 'idea:stale'),
      { action: 'clear' },
      'emptying the content must clear stale flags'
    );
  }

  // --- A genuinely different answer must re-verify -------------------------
  {
    const previous = citationKey(collectCitations('[a](nodus://idea/one)'));
    const plan = planCitationVerification('[b](nodus://idea/two)', previous);
    assert.equal(plan.action, 'verify', 'different citations must be verified');
    assert.deepEqual(plan.refs, [{ kind: 'idea', id: 'two' }]);
    assert.equal(plan.key, 'idea:two');
  }

  // --- The debounce must actually outlast a token gap ----------------------
  {
    assert.ok(VERIFY_DEBOUNCE_MS >= 200, 'debounce must be long enough to swallow inter-token gaps');
    assert.ok(VERIFY_DEBOUNCE_MS <= 1000, 'debounce must be short enough to feel immediate once settled');
  }

  console.log('# citation verification tests passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
