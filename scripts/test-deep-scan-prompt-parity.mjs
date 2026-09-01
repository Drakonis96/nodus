import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const buildDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-scan-prompts-'));
const output = path.join(buildDir, 'prompts.mjs');

try {
  execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
    path.join(root, 'electron/ai/prompts.ts'),
    '--bundle', '--platform=node', '--format=esm', `--outfile=${output}`,
  ], { cwd: root, stdio: 'pipe' });
  const prompts = await import(`file://${output}`);
  const copies = Object.fromEntries(languages.map((language) => [language, prompts.deepScanPrompt(language)]));
  const coreKeys = {
    fusion: ['new_idea', 'candidates', 'global_id', 'type', 'label', 'statement', 'similarity', 'same_as', 'variant_of', 'matched_id', 'merged_label', 'edge_to_existing', 'basis', 'confidence', 'rationale', '0.7'],
    summary: ['2', '3'],
    debate: ['nodus://idea/<id>', 'nodus://work/<nodus_id>', '3', '5', '#'],
    rqDecompose: ['subQuestions', 'text', 'rationale', 'MECE', '4', '8'],
    rqCoverage: ['status', 'covered', 'partial', 'disputed', 'uncovered', 'justification', 'ideaIds', 'g-0001', 'g-0002'],
  };
  const canonicalCore = {
    fusion: prompts.PROMPT_FUSION,
    summary: prompts.PROMPT_SUMMARY,
    debate: prompts.PROMPT_DEBATE,
    rqDecompose: prompts.PROMPT_RQ_DECOMPOSE,
    rqCoverage: prompts.PROMPT_RQ_COVERAGE,
  };
  for (const [key, tokens] of Object.entries(coreKeys)) {
    assert.equal(prompts.coreStructuredPrompt(key, 'es'), canonicalCore[key], `${key}: Spanish canonical contract changed`);
    for (const language of languages) {
      const value = prompts.coreStructuredPrompt(key, language);
      assert.ok(value.length >= canonicalCore[key].length * 0.65, `${language}.${key}: translated contract is unexpectedly short`);
      for (const token of tokens) assert.ok(value.includes(token), `${language}.${key}: missing ${token}`);
      assert.equal((value.match(/^- /gm) ?? []).length, (canonicalCore[key].match(/^- /gm) ?? []).length, `${language}.${key}: list-rule count changed`);
      if (language !== 'es') assert.doesNotMatch(value, /Eres el (motor|analista|planificador|evaluador)|Devuelve SOLO JSON|PRINCIPIO RECTOR|TU TAREA/, `${language}.${key}: Spanish prose leaked`);
    }
  }
  for (const language of languages) {
    const locked = prompts.lightScanPrompt(language, true);
    assert.match(locked, /available_main_themes/, `${language}: locked-theme contract was lost`);
    if (language !== 'es') assert.doesNotMatch(locked, /usa únicamente etiquetas/, `${language}: Spanish locked-theme rule leaked`);
    if (language !== 'en') assert.doesNotMatch(locked, /LOCKED THEMES/, `${language}: English locked-theme rule leaked`);
  }

  assert.equal(copies.es, prompts.PROMPT_DEEP, 'Spanish must remain the canonical contract byte-for-byte');

  // These are machine-facing contract tokens, not translatable prose. Every
  // locale must retain the same extraction schema, enums, limits and markers.
  const contractTokens = [
    'theme_nodes', 'ideas', 'internal_relations', 'external_references', 'gaps',
    'authors_detail', 'zotero_key', 'title', 'authors', 'year', 'container',
    'item_type', 'has_fulltext', 'language_hint', 'available_theme_labels',
    'context_mode', 'analysis_limits', 'max_ideas', 'max_internal_relations',
    'max_gaps', 'target_chunk_words', 'overlap_words', 'chunk', 'index', 'total',
    'word_count', 'text', 'claim', 'finding', 'construct', 'method', 'framework',
    'primary', 'secondary', 'principal', 'explicit', 'inferred', 'quote', 'source',
    'page', 'location', 'kind', 'extends', 'contradicts', 'applies_to',
    'shares_method', 'precondition_of', 'measures_same', 'supports', 'refutes',
    'variant_of', 'refines', 'future_work', 'limitation', 'open_question',
    'unresolved_contradiction', 'empirical', 'review', 'theoretical', 'book', 'other',
    'processing_status', 'ok', 'partial_no_fulltext', 'unreadable', 'out_of_scope',
    '[[src:sN', 'p.N', '0.0-1.0', '1-3', '0-2', '0-3', '0.9-1.0',
  ];
  for (const language of languages) {
    assert.ok(copies[language].length > 3000, `${language}: complete contract is unexpectedly short`);
    for (const token of contractTokens) assert.ok(copies[language].includes(token), `${language}: missing contract token ${token}`);
    assert.equal((copies[language].match(/═══/g) ?? []).length, (copies.es.match(/═══/g) ?? []).length, `${language}: section count differs`);
  }

  // Non-Spanish packs must not retain Spanish instructional prose. Invariant
  // JSON keys/enum values and source-language quote instructions are allowed.
  const SpanishProse = [
    /Eres el motor de extracción/i,
    /Lees una obra académica/i,
    /PRINCIPIO RECTOR/i,
    /No inventes nada/i,
    /TIPOS DE NODO/i,
    /NODOS TEMÁTICOS/i,
    /RELACIONES INTERNAS/i,
    /REFERENCIAS EXTERNAS/i,
    /HUECOS/i,
    /CONFIANZA/i,
    /SALIDA —/i,
    /en español/i,
    /No inventes citas/i,
  ];
  for (const language of languages.slice(1)) {
    for (const pattern of SpanishProse) assert.doesNotMatch(copies[language], pattern, `${language}: Spanish prose leak: ${pattern}`);
  }

  console.log(`Deep-scan prompt parity passed for ${languages.length} locales.`);
} finally {
  await rm(buildDir, { recursive: true, force: true });
}
