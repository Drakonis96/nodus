// Unit tests for the student pseudonymisation layer (teaching vault).
//
// shared/studentPseudonyms.ts is pure, so we bundle just that file with esbuild and
// import the REAL functions rather than a mirror of them. The invariants locked here
// are the ones whose failure is a privacy incident rather than a cosmetic bug:
//
//   · an unambiguous name never survives into the outgoing payload
//   · an AMBIGUOUS name is never guessed at (two Juanes stay two Juanes)
//   · an ordinary word that happens to be a name does not corrupt the prompt
//   · a placeholder split across streaming chunks still reaches the UI intact
//
// The streaming section is exhaustive on purpose: it splits the same answer at every
// single offset, because "works for the split I happened to think of" is exactly the
// bug this class of code ships with.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-pseudonym-test-'));
try {
  const outfile = path.join(tmp, 'studentPseudonyms.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/studentPseudonyms.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['@shared/*'],
    logLevel: 'silent',
  });
  const {
    PSEUDONYM_RE,
    isPseudonym,
    generatePseudonymCode,
    buildPseudonymScope,
    displayNameOf,
    labelFor,
    anonymizeText,
    findResidualNames,
    deanonymizeText,
    deanonymizeDeep,
    createStreamDeanonymizer,
    PSEUDONYM_MAX_HOLD,
  } = await import(pathToFileURL(outfile).href);

  const student = (id, code, givenNames, surnames) => ({ id, code, givenNames, surnames });

  // ── Code generation ────────────────────────────────────────────────────────
  {
    const codes = new Set();
    for (let i = 0; i < 2000; i++) codes.add(generatePseudonymCode(codes));
    assert.equal(codes.size, 2000, 'rejection sampling never returns a taken code');
    for (const code of codes) {
      assert.ok(isPseudonym(code), `${code} matches the canonical shape`);
      // Visually ambiguous glyphs would be misread when a teacher types a code back.
      assert.ok(!/[01ILOU]/.test(code.slice(4)), `${code} avoids ambiguous glyphs`);
    }
    // The code must not be derivable from the name: same student, different draws.
    const drawn = new Set();
    for (let i = 0; i < 50; i++) drawn.add(generatePseudonymCode(new Set()));
    assert.ok(drawn.size > 1, 'codes are random, not a hash of anything');

    assert.ok(!isPseudonym('STU_0000'), 'excluded glyphs are not canonical codes');
    assert.ok(!isPseudonym('STU_ABC'), 'codes are exactly four symbols');
    assert.deepEqual('a STU_7K3Q b STU_MMMM'.match(PSEUDONYM_RE), ['STU_7K3Q', 'STU_MMMM']);
  }

  // ── Scope + structured path ────────────────────────────────────────────────
  const ana = student('s1', 'STU_7K3Q', 'Ana María', 'Peña López');
  const juanA = student('s2', 'STU_MMMM', 'Juan', 'García Ruiz');
  const juanB = student('s3', 'STU_NNNN', 'Juan', 'Sáez Coll');
  const rosa = student('s4', 'STU_QQQQ', 'Rosa', 'Ferrer Vidal');

  {
    const scope = buildPseudonymScope([ana, juanA, juanB, rosa]);
    assert.equal(labelFor(scope, 's1'), 'STU_7K3Q', 'structured path yields the code, never the name');
    assert.equal(labelFor(scope, 'missing'), 'missing', 'unknown id falls back to the id, not a guess');
    assert.equal(displayNameOf(ana), 'Ana María Peña López');
  }

  // ── Rung 1: unambiguous full name ──────────────────────────────────────────
  {
    const scope = buildPseudonymScope([ana, juanA, juanB, rosa]);
    const out = anonymizeText('Ana María Peña López ha entregado la práctica.', scope);
    assert.equal(out.text, 'STU_7K3Q ha entregado la práctica.');
    assert.equal(out.substitutions, 1, 'the full name is one substitution, not four');
    assert.equal(findResidualNames(out.text, scope).length, 0);

    // "Apellidos, Nombre" is how school management systems export rosters.
    assert.equal(anonymizeText('Peña López, Ana María', scope).text, 'STU_7K3Q');
  }

  // ── Accents, case and Unicode word boundaries ──────────────────────────────
  {
    const scope = buildPseudonymScope([ana, juanA, juanB, rosa]);
    // Teachers type without accents; over-matching is the safe direction.
    assert.equal(anonymizeText('pena lopez ha mejorado', scope).text, 'STU_7K3Q ha mejorado');
    assert.equal(anonymizeText('PEÑA LÓPEZ', scope).text, 'STU_7K3Q');

    // JS \b is ASCII-only: without explicit Unicode guards, "Sáez" would match inside
    // a longer accented word. These two assertions are what pin that.
    const sub = anonymizeText('Sáezcoll no es nadie', scope);
    assert.equal(sub.text, 'Sáezcoll no es nadie', 'no match inside a longer accented word');
    assert.equal(anonymizeText('Ferrervidal', scope).text, 'Ferrervidal');
  }

  // ── Rule 1: never guess when ambiguous ─────────────────────────────────────
  {
    const scope = buildPseudonymScope([ana, juanA, juanB, rosa]);
    const out = anonymizeText('¿Cómo va Juan?', scope);
    assert.equal(out.text, '¿Cómo va Juan?', 'two Juanes: the text is left exactly as written');
    assert.equal(out.substitutions, 0);
    const warn = out.warnings.find((w) => w.kind === 'ambiguous');
    assert.ok(warn, 'an ambiguous name raises a warning the UI can surface');
    assert.equal(warn.candidateCount, 2);

    // Disambiguated by the surname, the very same first name now resolves.
    assert.equal(anonymizeText('Juan García Ruiz aprobó', scope).text, 'STU_MMMM aprobó');
    // And an ambiguous span is NOT re-scanned into its shorter parts.
    assert.ok(!anonymizeText('Juan', scope).text.startsWith('STU_'));
  }

  // ── Rule 3: an ordinary word that is also a name ────────────────────────────
  {
    const scope = buildPseudonymScope([ana, juanA, juanB, rosa]);

    const prose = anonymizeText('Explica la rosa de los vientos a la clase.', scope);
    assert.equal(prose.text, 'Explica la rosa de los vientos a la clase.', 'the prompt is not corrupted');
    assert.ok(prose.warnings.some((w) => w.kind === 'common-word'));

    // Corroborated by a following name token.
    assert.equal(anonymizeText('Rosa Ferrer Vidal ha faltado', scope).text, 'STU_QQQQ ha faltado');
    // Corroborated by a nexus word plus capitalisation.
    assert.equal(anonymizeText('He hablado con Rosa esta mañana', scope).text, 'He hablado con STU_QQQQ esta mañana');
    // Capitalised but with no corroboration at all: left alone rather than guessed.
    assert.equal(anonymizeText('Rosa náutica del mapa', scope).text, 'Rosa náutica del mapa');
  }

  // ── The leak detector ──────────────────────────────────────────────────────
  {
    const scope = buildPseudonymScope([ana, juanA, juanB, rosa]);
    assert.deepEqual(findResidualNames('Nada que ver aquí.', scope), []);
    assert.ok(
      findResidualNames('Ana María Peña López sigue aquí', scope).length > 0,
      'an unambiguous full name left in the payload is caught',
    );
    // Deliberate non-substitutions must NOT trip the detector, or every request with
    // a "Rosa" or a second "Juan" would be blocked and users would switch it off.
    assert.deepEqual(findResidualNames('¿Cómo va Juan?', scope), [], 'ambiguous names do not block the send');
    assert.deepEqual(findResidualNames('la rosa de los vientos', scope), [], 'guarded words do not block the send');

    // An empty roster is a no-op, not a crash — and not a false sense of safety.
    const empty = buildPseudonymScope([]);
    assert.equal(anonymizeText('Ana María Peña López', empty).text, 'Ana María Peña López');
    assert.deepEqual(findResidualNames('Ana María Peña López', empty), []);
  }

  // ── Round trip ─────────────────────────────────────────────────────────────
  {
    const scope = buildPseudonymScope([ana, juanA, juanB, rosa]);
    const outbound = anonymizeText('Ana María Peña López y Juan García Ruiz trabajan bien.', scope);
    assert.ok(!/Ana|Peña|García/.test(outbound.text), 'no real name survives outbound');
    const back = deanonymizeText(outbound.text, scope);
    assert.equal(back.text, 'Ana María Peña López y Juan García Ruiz trabajan bien.');
    assert.deepEqual(back.unknownCodes, []);

    // Models mangle placeholders: lowercase, hyphen, stray space. All resolve.
    for (const variant of ['stu_7k3q', 'STU-7K3Q', 'STU 7K3Q', '**STU_7K3Q**']) {
      assert.ok(
        deanonymizeText(variant, scope).text.includes('Ana María Peña López'),
        `${variant} maps back to the real name`,
      );
    }

    // Rule 1 on the way back: an invented code is shown raw, never resolved to
    // "the nearest student".
    const bogus = deanonymizeText('STU_ZZZZ ha aprobado', scope);
    assert.equal(bogus.text, 'STU_ZZZZ ha aprobado');
    assert.deepEqual(bogus.unknownCodes, ['STU_ZZZZ']);

    // Nested JSON, which is what completeJson hands back.
    const deep = deanonymizeDeep(
      { rows: [{ who: 'STU_MMMM', note: 'bien' }], n: 3, ok: true, nil: null },
      scope,
    );
    assert.deepEqual(deep, { rows: [{ who: 'Juan García Ruiz', note: 'bien' }], n: 3, ok: true, nil: null });
  }

  // ── Streaming: split at EVERY offset ───────────────────────────────────────
  {
    const scope = buildPseudonymScope([ana, juanA, juanB, rosa]);
    const answer = 'Creo que STU_7K3Q y STU_MMMM han mejorado, pero STU_QQQQ no.';
    const expected = deanonymizeText(answer, scope).text;

    for (let cut = 0; cut <= answer.length; cut++) {
      const rw = createStreamDeanonymizer(scope);
      const got = rw.push(answer.slice(0, cut)) + rw.push(answer.slice(cut)) + rw.flush();
      assert.equal(got, expected, `two-way split at offset ${cut} reconstructs the answer`);
    }

    // One character at a time — the worst case a provider can produce.
    {
      const rw = createStreamDeanonymizer(scope);
      let got = '';
      for (const ch of answer) got += rw.push(ch);
      got += rw.flush();
      assert.equal(got, expected, 'character-by-character streaming still resolves');
    }

    // Three-way splits across the placeholder itself.
    for (let a = 8; a < 20; a++) {
      for (let b = a; b < 22; b++) {
        const rw = createStreamDeanonymizer(scope);
        const got =
          rw.push(answer.slice(0, a)) + rw.push(answer.slice(a, b)) + rw.push(answer.slice(b)) + rw.flush();
        assert.equal(got, expected, `three-way split at ${a}/${b} reconstructs the answer`);
      }
    }
  }

  // ── Streaming edge cases ───────────────────────────────────────────────────
  {
    const scope = buildPseudonymScope([ana, juanA, juanB, rosa]);

    // A placeholder that never completes is emitted verbatim, not swallowed. This is
    // what an aborted stream looks like mid-token.
    {
      const rw = createStreamDeanonymizer(scope);
      const streamed = rw.push('Va bien STU_7K') + rw.flush();
      assert.equal(streamed, 'Va bien STU_7K', 'a truncated placeholder is never eaten');
    }

    // Nothing is lost when the stream ends on a complete placeholder — this only
    // works because flush() runs, which is why the caller must put it in a finally.
    {
      const rw = createStreamDeanonymizer(scope);
      const withoutFlush = rw.push('El mejor es STU_7K3Q');
      const withFlush = withoutFlush + rw.flush();
      assert.ok(!withoutFlush.includes('Ana'), 'a trailing placeholder is held for one chunk');
      assert.equal(withFlush, 'El mejor es Ana María Peña López');
    }

    // The buffer is bounded: a megabyte of prose after "STU_" must not be held.
    {
      const rw = createStreamDeanonymizer(scope);
      rw.push('STU_');
      const big = 'x'.repeat(100_000);
      const out = rw.push(big);
      assert.ok(out.length >= big.length - PSEUDONYM_MAX_HOLD, 'the hold never grows unbounded');
    }

    // Unknown codes are reported once, and reported through the streaming path too.
    {
      const rw = createStreamDeanonymizer(scope);
      rw.push('STU_ZZZZ y STU_ZZZZ');
      rw.flush();
      assert.deepEqual(rw.unknownCodes(), ['STU_ZZZZ']);
    }

    // Content and reasoning are separate streams and must not share a buffer.
    {
      const content = createStreamDeanonymizer(scope);
      const reasoning = createStreamDeanonymizer(scope);
      reasoning.push('pienso en STU_');
      const out = content.push('STU_7K3Q') + content.flush();
      assert.equal(out, 'Ana María Peña López', 'one rewriter is not disturbed by the other');
    }
  }

  console.log('student pseudonyms: OK');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
