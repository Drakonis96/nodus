import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const buildDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-new-vault-prompts-'));

function loadModule(source, name) {
  const output = path.join(buildDir, `${name}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, source), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${output}`],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(output);
}

test.after(() => rm(buildDir, { recursive: true, force: true }));

test('every new vault has a substantive native context pack in every prompt language', () => {
  const { PROMPT_LANGUAGES } = loadModule('shared/types.ts', 'types');
  const { NEW_VAULT_PROMPT_PACKS, localizedNewVaultPromptPack } = loadModule(
    'shared/newVaultPromptPacks.ts',
    'newVaultPromptPacks',
  );
  assert.deepEqual(PROMPT_LANGUAGES, ['es', 'en', 'fr', 'tr', 'de', 'pt', 'pt-BR', 'it']);

  for (const vaultType of [
    'primary_sources', 'testimonios', 'prosopography', 'worldbuilding',
    'genealogy', 'estudio', 'databases', 'docencia',
  ]) {
    const packs = NEW_VAULT_PROMPT_PACKS[vaultType];
    assert.deepEqual(Object.keys(packs).sort(), [...PROMPT_LANGUAGES].sort(), `${vaultType}: exact language set`);
    assert.equal(new Set(Object.values(packs)).size, PROMPT_LANGUAGES.length, `${vaultType}: no language silently reuses another`);
    for (const language of PROMPT_LANGUAGES) {
      assert.ok(packs[language].length > 400, `${vaultType}/${language}: substantive pack`);
      assert.equal(localizedNewVaultPromptPack(vaultType, language), packs[language]);
    }
  }
  assert.equal(localizedNewVaultPromptPack('academic', 'it'), null);
});

test('vault prompt consumers resolve every type and locale without Spanish leakage', () => {
  const { PROMPT_LANGUAGES } = loadModule('shared/types.ts', 'types-vault-runtime');
  const { VAULT_TYPES, vaultTypePromptPack } = loadModule('shared/vaultTypes.ts', 'vaultTypes-runtime');
  const vaultTypes = VAULT_TYPES.map(({ id }) => id);
  assert.deepEqual(vaultTypes, [
    'academic', 'genealogy', 'prosopography', 'estudio', 'primary_sources',
    'databases', 'testimonios', 'worldbuilding', 'docencia',
  ]);

  for (const vaultType of vaultTypes) {
    const Spanish = vaultTypePromptPack(vaultType, 'es');
    assert.equal(typeof Spanish, 'string');
    for (const language of PROMPT_LANGUAGES) {
      const prompt = vaultTypePromptPack(vaultType, language);
      assert.equal(typeof prompt, 'string', `${vaultType}/${language}: prompt is a string`);
      if (vaultType === 'academic') {
        assert.equal(prompt, '', `${vaultType}/${language}: academic remains empty`);
        continue;
      }
      assert.ok(prompt.length > 400, `${vaultType}/${language}: substantive runtime pack`);
      if (language !== 'es') {
        assert.notEqual(prompt, Spanish, `${vaultType}/${language}: reused Spanish pack`);
        assert.doesNotMatch(prompt, /CONTEXTO DEL VAULT|Este vault (reconstruye|se usa|es un gestor|es el espacio)|Tu tarea|No inventes|Cuando falte/i, `${vaultType}/${language}: Spanish prose leaked`);
      }
    }
  }
});

test('Testimonies analysis and transcript-correction prompts are native in all languages', () => {
  const { PROMPT_LANGUAGES } = loadModule('shared/types.ts', 'types-testimony');
  const { TESTIMONY_AI_PROMPTS } = loadModule('shared/testimonyPrompts.ts', 'testimonyPrompts');
  assert.deepEqual(Object.keys(TESTIMONY_AI_PROMPTS).sort(), [...PROMPT_LANGUAGES].sort());
  for (const language of PROMPT_LANGUAGES) {
    const prompt = TESTIMONY_AI_PROMPTS[language];
    assert.ok(prompt.analysisSystem.length > 500, `${language}: substantive analysis prompt`);
    assert.ok(prompt.improveSystem.length > 250, `${language}: substantive correction prompt`);
    assert.match(prompt.analysisSystem, /"codes"/);
    assert.match(prompt.analysisSystem, /"passages"/);
    assert.match(prompt.improveSystem, /"segments"/);
    assert.ok(prompt.interviewLabel);
    assert.ok(prompt.transcriptLabel);
  }
});

test('every Worldbuilding model operation has a native contract in all languages', () => {
  const { PROMPT_LANGUAGES } = loadModule('shared/types.ts', 'types-world-operations');
  const { WORLD_OPERATION_PROMPTS, worldOperationSystemPrompt } = loadModule(
    'shared/worldOperationPrompts.ts',
    'worldOperationPrompts',
  );
  const operations = [
    'articleDraft',
    'articleExpand',
    'missingEntries',
    'proseReview',
    'questionOptions',
    'ruleDraft',
    'worldChat',
    'characterInterview',
    'biography',
    'biographyPropose',
  ];
  assert.deepEqual(Object.keys(WORLD_OPERATION_PROMPTS).sort(), [...PROMPT_LANGUAGES].sort());
  for (const language of PROMPT_LANGUAGES) {
    const prompts = WORLD_OPERATION_PROMPTS[language];
    assert.deepEqual(Object.keys(prompts).sort(), [...operations].sort(), `${language}: exact operation set`);
    for (const operation of operations) {
      assert.ok(prompts[operation].length > 220, `${language}/${operation}: substantive native contract`);
      assert.ok(worldOperationSystemPrompt(operation, language).includes(prompts[operation]));
    }
  }
});
