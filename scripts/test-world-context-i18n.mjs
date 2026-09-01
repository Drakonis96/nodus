import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const out = await mkdtemp(path.join(os.tmpdir(), 'nodus-world-context-i18n-'));
const load = (file) => {
  const bundle = path.join(out, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [path.join(root, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`], { cwd: root, stdio: 'ignore' });
  return require(bundle);
};

const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const article = load('shared/worldArticleContext.ts');
const question = load('shared/worldQuestionContext.ts');
const missing = load('shared/worldMissingEntries.ts');
const rule = load('shared/worldRuleContext.ts');
const chat = load('shared/worldChatContext.ts');
const labels = load('shared/worldPromptLanguage.ts');
test.after(() => rm(out, { recursive: true, force: true }));

const articleSources = {
  title: 'Vaël', category: 'Magic system', aliases: ['The Veil'], summary: 'The author’s exact summary.', body: 'Canonical body with 4120.',
  neighbours: [{ title: 'Ilyra', kind: 'Character', summary: 'A named summary.', direction: 'outgoing' }], calendar: { eras: ['Third Era'], months: ['Ashfall'] },
};
const questionSources = {
  question: 'Who opened the gate?', anchorTitle: 'Ilyra', anchorKind: 'Character', fieldLabel: 'Backstory', evidence: 'The gate ???',
  anchorProse: [{ field: 'Backstory', text: 'Exact sheet text.' }], existing: ['Already chosen'], neighbours: [{ title: 'Vaël', kind: 'Place', summary: 'Exact place summary.' }], blockedScene: 'The crossing',
};
const candidates = [{ term: 'Ashfall', termKey: 'ashfall', source: 'unresolved_link', occurrences: [{ key: 'article:a', title: 'Vaël', snippet: 'Exact snippet.' }] }];
const ruleSources = {
  title: 'The Blood Law', hardness: 'Impossible', hardnessHint: 'It cannot happen here.', scope: 'The whole world', statement: 'The current statement.', cost: 'Exact cost.', limits: 'Exact limits.',
  exceptions: ['The Narrow Rule'], tests: [{ mark: 'Breaks', sceneTitle: 'The crossing', text: 'Exact beat text.', subjectName: 'Ilyra', paid: false }], mentions: [{ title: 'Vaël', kind: 'Place', summary: 'Exact summary.' }], calendar: { eras: ['Third Era'] },
};
const chatFacts = { question: 'Where was Ilyra on day 4120?', history: [{ role: 'user', content: 'Previous exact turn.' }], focus: [{ kind: 'character', id: 'i1', title: 'Ilyra' }], prose: [{ ref: { kind: 'character', id: 'i1', title: 'Ilyra' }, field: 'Backstory', text: 'Exact prose.' }], computed: { effectiveRules: [{ rule: 'The Blood Law', ruleId: 'r1', scope: 'The whole world', overriddenBy: ['The Narrow Rule'] }], presenceAt: [{ personName: 'Ilyra', placeName: 'Vaël', worldDay: 4120 }], findings: [{ headline: '«{rule}» no aparece en ninguna parte', severity: 'gap', subjects: ['The Blood Law'] }] }, citable: [{ kind: 'character', id: 'i1', title: 'Ilyra' }], worldDay: 4120 };

test('all eight locales translate every world user-context scaffold and preserve author data', () => {
  const forbidden = ['TÉRMINOS SIN DEFINIR', 'CALENDARIO DE ESTE MUNDO', 'LO QUE FALTA POR DECIDIR', 'DÍA DEL MUNDO', 'CALCULADO POR NODUS'];
  for (const language of languages) {
    const contexts = [
      article.composeWorldArticleContext(articleSources, language),
      question.composeWorldQuestionContext(questionSources, language),
      missing.composeMissingEntriesContext(candidates, language),
      rule.composeWorldRuleContext(ruleSources, language),
      chat.composeWorldChatContext(chatFacts, language),
    ].join('\n');
    assert.match(contexts, /Vaël|Ilyra|Ashfall|4120|Exact/);
    if (language !== 'es') for (const marker of forbidden) assert.doesNotMatch(contexts, new RegExp(marker));
  }
});

test('localized world labels cover kinds, categories, fields, rules and marks', () => {
  for (const language of languages) {
    if (language !== 'es') {
      assert.ok(labels.worldEntryKindLabel('character', language));
      assert.ok(labels.worldArticleCategoryLabel('magic', language));
      assert.ok(labels.worldFieldLabel('backstory', language));
      assert.ok(labels.worldRuleHardnessLabel('physical', language));
      assert.ok(labels.worldBeatMarkLabel('breaks', language));
    }
  }
});

test('world-day parsing recognizes each prompt language without changing the number', () => {
  const phrases = { es: 'día 4 120', en: 'day 4 120', fr: 'jour 4 120', de: 'Tag 4.120', pt: 'dia 4 120', 'pt-BR': 'dia 4.120', it: 'giorno 4 120', tr: 'gün 4 120' };
  for (const language of languages) assert.equal(chat.readWorldDay(phrases[language], language), 4120, language);
});

test('direct system contracts follow all eight prompt languages and retain parser protocol', () => {
  const systems = [
    [article, 'worldArticleSystemPrompt'], [question, 'worldQuestionOptionsSystemPrompt'], [missing, 'missingEntriesSystemPrompt'],
    [rule, 'worldRuleSystemPrompt'], [chat, 'worldChatSystemPrompt'],
  ];
  for (const language of languages) {
    for (const [module, name] of systems) {
      const text = module[name](language);
      assert.ok(text.length > 80);
      if (language !== 'es') assert.doesNotMatch(text, /Escribe|Respondes|Propones|Ayudas|Redactas|CALCULADO POR NODUS/);
    }
    // These are parser tokens, not reader-facing prose, and must stay byte-for-byte fixed.
    assert.match(question.worldQuestionOptionsSystemPrompt(language), /OPCIÓN/);
    assert.match(question.worldQuestionOptionsSystemPrompt(language), /IMPLICA/);
  }
});
