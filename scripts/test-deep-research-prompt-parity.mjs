// Structural regression test for the locale packs used by the core extraction
// prompts and shared Deep Research writer rules. It intentionally checks only
// machine-facing contract tokens, never prose wording.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const source = fs.readFileSync(path.join(root, 'electron/ai/prompts.ts'), 'utf8');
const core = fs.readFileSync(path.join(root, 'electron/ai/deepResearchCore.ts'), 'utf8');

// Every supported locale must be represented in the explicit native rule registry.
for (const language of languages) {
  const key = language === 'pt-BR' ? "['\"]pt-BR['\"]" : language;
  assert.match(core, new RegExp(`\\n  ${key}:`), `missing narrative pack ${language}`);
}
assert.equal((core.match(/'Prioriza una narración argumental continua/g) ?? []).length, 1);
assert.equal((core.match(/'Prioritize a continuous/g) ?? []).length, 1);

// The core contracts must retain their schema keys, enums, citation fields and
// hard limits. This catches accidental “short translation” replacements.
const required = [
  'themes', 'key_concepts', 'tentative_type', 'notes', 'confidence',
  'theme_nodes', 'internal_relations', 'external_references', 'gaps',
  'authors_detail', 'zotero_key', 'analysis_limits', 'max_ideas',
  'claim', 'finding', 'construct', 'method', 'framework',
  'empirical', 'review', 'theoretical', 'book', 'other',
  'supports', 'refutes', 'variant_of', 'explicit', 'inferred',
  'quote', 'source', 'page', 'location', 'kind',
];
for (const token of required) assert.ok(source.includes(token), `missing contract token ${token}`);

console.log(`Deep Research prompt parity passed for ${languages.length} locales.`);
