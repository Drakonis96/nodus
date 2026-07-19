// Verifies the multi-pattern substring counter used by the reading path.
//
// The reading path asked `ref.includes(author) || ref.includes(title)` for
// every work against every row of external_refs — O(works x refs) substring
// searches, measured at 13 s of blocked main process for 3,000 works against
// 60,000 references.
//
// Aho-Corasick was chosen specifically because it preserves `includes`
// semantics exactly; a word or token index would be faster still but would
// stop matching patterns occurring inside a longer word, silently changing the
// ranking users see. That equivalence is the thing worth testing, so most of
// this file is randomised differential testing against the naive loop.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-substr-'));
const bundle = path.join(dir, 'substringIndex.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/substringIndex.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const { SubstringIndex } = require(bundle);

/** The behaviour being replaced, kept as the oracle. */
function naiveCounts(patterns, haystacks) {
  return patterns.map((p) => (p ? haystacks.filter((h) => h.includes(p)).length : 0));
}

function build(patterns) {
  const index = new SubstringIndex();
  const ids = patterns.map((p) => index.add(p));
  return { index, ids };
}

function counts(patterns, haystacks) {
  const { index, ids } = build(patterns);
  const result = index.countContainingHaystacks(haystacks);
  return ids.map((id) => (id === -1 ? 0 : result[id]));
}

/** Deterministic PRNG so a failure is reproducible. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

try {
  // --- 1. Hand-picked cases, including the ones that break naive indexes ---
  {
    const patterns = ['smith', 'garcia', 'la memoria de trabajo en contexto'];
    const haystacks = [
      'smith, j. (1999) on method',
      'blacksmithing traditions',            // substring INSIDE a word: must count
      'garcia lorca, f.',
      'la memoria de trabajo en contexto amplio',
      'nothing relevant here',
      'smith again and smith twice',          // repeated: counts once
    ];
    assert.deepEqual(counts(patterns, haystacks), naiveCounts(patterns, haystacks));
    assert.equal(counts(['smith'], haystacks)[0], 3, 'substring inside a longer word must still match');
  }

  // --- 2. Overlapping and nested patterns ---------------------------------
  {
    const patterns = ['a', 'ab', 'abc', 'bc', 'c', 'abcabc'];
    const haystacks = ['abc', 'abcabc', 'xxbcxx', 'a', '', 'cab'];
    assert.deepEqual(counts(patterns, haystacks), naiveCounts(patterns, haystacks));
  }

  // --- 3. Degenerate inputs ------------------------------------------------
  {
    assert.deepEqual(counts([], ['anything']), []);
    assert.deepEqual(counts(['x'], []), [0]);
    assert.deepEqual(counts([''], ['abc']), [0], 'an empty pattern must be rejected, not match everything');
    assert.deepEqual(counts(['aaa'], ['aaaaa']), naiveCounts(['aaa'], ['aaaaa']));
    // Duplicate patterns share an id and must both report the same count.
    assert.deepEqual(counts(['dup', 'dup'], ['a dup here', 'no']), [1, 1]);
  }

  // --- 4. Non-ASCII, which citation strings are full of --------------------
  {
    const patterns = ['garcía', 'muñoz', 'año', '—dash'];
    const haystacks = ['garcía márquez, g.', 'muñoz molina', 'el año pasado', 'a —dash— here', 'garcia sin tilde'];
    assert.deepEqual(counts(patterns, haystacks), naiveCounts(patterns, haystacks));
  }

  // --- 5. Randomised differential testing ---------------------------------
  // Small alphabets maximise overlaps, collisions and failure-link traversal,
  // which is exactly where an Aho-Corasick bug would hide.
  {
    const random = makeRandom(20260719);
    const pick = (alphabet, maxLen) => {
      const length = 1 + Math.floor(random() * maxLen);
      let out = '';
      for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
      return out;
    };

    for (const alphabet of ['ab', 'abc', 'abcdef']) {
      for (let round = 0; round < 150; round += 1) {
        const patterns = Array.from({ length: 1 + Math.floor(random() * 12) }, () => pick(alphabet, 5));
        const haystacks = Array.from({ length: 1 + Math.floor(random() * 15) }, () => pick(alphabet, 14));
        const expected = naiveCounts(patterns, haystacks);
        const actual = counts(patterns, haystacks);
        assert.deepEqual(
          actual,
          expected,
          `mismatch for patterns ${JSON.stringify(patterns)} over ${JSON.stringify(haystacks)}`
        );
      }
    }
  }

  // --- 6. Realistic shape: many patterns, many haystacks ------------------
  {
    const random = makeRandom(7);
    const surnames = Array.from({ length: 300 }, (_, i) => `autor${i}`);
    const titles = Array.from({ length: 300 }, (_, i) => `titulo largo numero ${i} sobre el asunto`);
    const patterns = [...surnames, ...titles];
    const refs = Array.from({ length: 4000 }, () => {
      const surname = surnames[Math.floor(random() * surnames.length)];
      const title = titles[Math.floor(random() * titles.length)];
      return random() < 0.5 ? `${surname}, x. (1990) ${title}` : `obra sin coincidencia ${Math.floor(random() * 1000)}`;
    });
    assert.deepEqual(counts(patterns, refs), naiveCounts(patterns, refs), 'must agree at realistic scale');
  }

  // --- 7. Group counting matches the union the reading path asks for ------
  // Each work asks "does this reference mention my author OR my title", and a
  // reference mentioning both must count once. Summing per-pattern counts
  // would double it, which would inflate the foundational score.
  function naiveGroupCounts(groups, haystacks) {
    return groups.map((patterns) =>
      haystacks.filter((h) => patterns.some((p) => p && h.includes(p))).length
    );
  }

  function groupCounts(groups, haystacks) {
    const index = new SubstringIndex();
    const groupsByPattern = [];
    groups.forEach((patterns, group) => {
      for (const pattern of patterns) {
        const id = index.add(pattern);
        if (id < 0) continue;
        (groupsByPattern[id] ??= []).push(group);
      }
    });
    for (let id = 0; id < groupsByPattern.length; id += 1) groupsByPattern[id] ??= [];
    return index.countContainingHaystacksByGroup(haystacks, groupsByPattern, groups.length);
  }

  {
    // The double-count trap: a reference carrying both needles of one work.
    const groups = [['smith', 'la memoria de trabajo en contexto']];
    const haystacks = ['smith, j. la memoria de trabajo en contexto amplio'];
    assert.deepEqual(groupCounts(groups, haystacks), [1], 'author AND title in one reference counts once');
    assert.deepEqual(groupCounts(groups, haystacks), naiveGroupCounts(groups, haystacks));
  }

  {
    // A shared first author across works: one pattern, several groups.
    const groups = [['garcia'], ['garcia'], ['otro']];
    const haystacks = ['garcia, a.', 'garcia, b.', 'otro, c.'];
    assert.deepEqual(groupCounts(groups, haystacks), naiveGroupCounts(groups, haystacks));
    assert.deepEqual(groupCounts(groups, haystacks), [2, 2, 1], 'a shared pattern must credit every work that uses it');
  }

  {
    // Works with no usable needles at all must score zero, not everything.
    const groups = [[], ['x']];
    const haystacks = ['x marks it', 'nothing'];
    assert.deepEqual(groupCounts(groups, haystacks), naiveGroupCounts(groups, haystacks));
    assert.equal(groupCounts(groups, haystacks)[0], 0, 'a work with no patterns must count zero');
  }

  {
    // Randomised: overlapping groups over a small alphabet.
    const random = makeRandom(4242);
    const pick = (alphabet, maxLen) => {
      const length = 1 + Math.floor(random() * maxLen);
      let out = '';
      for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
      return out;
    };
    for (let round = 0; round < 200; round += 1) {
      const groups = Array.from({ length: 1 + Math.floor(random() * 8) }, () =>
        Array.from({ length: Math.floor(random() * 3) }, () => pick('abc', 4))
      );
      const haystacks = Array.from({ length: 1 + Math.floor(random() * 12) }, () => pick('abc', 12));
      assert.deepEqual(
        groupCounts(groups, haystacks),
        naiveGroupCounts(groups, haystacks),
        `group mismatch for ${JSON.stringify(groups)} over ${JSON.stringify(haystacks)}`
      );
    }
  }

  // --- 8. Adding after building is refused, not silently ignored ----------
  {
    const index = new SubstringIndex();
    index.add('a');
    index.countContainingHaystacks(['a']);
    assert.throws(() => index.add('b'), /cannot add patterns after building/);
  }

  console.log('# substring index tests passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
