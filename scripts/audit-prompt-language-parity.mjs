#!/usr/bin/env node
/**
 * Prompt-language parity audit.
 *
 * Every per-language prompt table in Nodus must carry a complete entry for each
 * language in `PROMPT_LANGUAGES`; silent Spanish/English fallbacks are forbidden.
 * This script parses the prompt sources (not the general UI translation tables),
 * finds each language-keyed object literal and each `Record<PromptLanguage, …>`
 * declaration, and reports any language whose key is missing.
 *
 * Usage:
 *   node scripts/audit-prompt-language-parity.mjs            # audit every prompt source
 *   node scripts/audit-prompt-language-parity.mjs <file...>  # audit specific files
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The languages every prompt table must cover, in declaration order. */
export const PROMPT_LANGUAGE_CODES = [
  'es', 'en', 'fr', 'tr', 'de', 'pt', 'pt-BR', 'it',
  'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko',
];

/**
 * Prompt sources. Renderer interface dictionaries (`src/i18n.*`) are deliberately
 * excluded: this audit covers prompts, not the general UI localization.
 */
const DEFAULT_SOURCES = [
  'shared/academicPromptPacks.ts',
  'shared/aiOcrPrompt.ts',
  'shared/analysisCatalog.ts',
  'shared/biographyContext.ts',
  'shared/characterInterview.ts',
  'shared/dataProfile.ts',
  'shared/databaseAi.ts',
  'shared/databaseChat.ts',
  'shared/databaseDeepResearchPrompts.ts',
  'shared/deepResearchClientPromptPacks.ts',
  'shared/deepResearchLengthPromptPacks.ts',
  'shared/deepResearchPlanningPromptPacks.ts',
  'shared/deepResearchQualityPromptPacks.ts',
  'shared/deepResearchReport.ts',
  'shared/deepResearchWritingPromptPacks.ts',
  'shared/editorAiPrompts.ts',
  'shared/genealogyDeepResearchPromptPacks.ts',
  'shared/graphPromptPacks.ts',
  'shared/hypothesisLab.ts',
  'shared/imageAnalysis.ts',
  'shared/manuscriptVerifierPromptPacks.ts',
  'shared/newVaultPromptPacks.ts',
  'shared/nodiChatPromptPacks.ts',
  'shared/nodiDocumentation.ts',
  'shared/notesOrderPromptPacks.ts',
  'shared/primarySourceProposalPrompts.ts',
  'shared/primarySourceToolkitPrompts.ts',
  'shared/projectGuide.ts',
  'shared/projectInsertionPromptPacks.ts',
  'shared/prosopographyPrompts.ts',
  'shared/recordsExtraction.ts',
  'shared/reprocessConnectionsPromptPacks.ts',
  'shared/researchAssistantPromptPacks.ts',
  'shared/researchPromptPacks.ts',
  'shared/studyAssistantPromptPacks.ts',
  'shared/studyDeepResearchPromptPacks.ts',
  'shared/studyDiarizationPromptPacks.ts',
  'shared/studyGuidePromptPacks.ts',
  'shared/studyImprove.ts',
  'shared/studyKnowledgePromptPacks.ts',
  'shared/synthesisPromptPacks.ts',
  'shared/teachingExams.ts',
  'shared/teachingPromptPacks.ts',
  'shared/teachingRubrics.ts',
  'shared/rubricHtml.ts',
  'shared/testimonyPrompts.ts',
  'shared/tutorPromptPacks.ts',
  'shared/worldArticleContext.ts',
  'shared/worldChatContext.ts',
  'shared/worldContextPromptPacks.ts',
  'shared/worldMissingEntries.ts',
  'shared/worldOperationPrompts.ts',
  'shared/worldPromptLanguage.ts',
  'shared/worldQuestionContext.ts',
  'shared/worldRuleContext.ts',
  'shared/writingWorkshopPromptPacks.ts',
  'electron/ai/aiClient.ts',
  'electron/ai/argumentMap.ts',
  'electron/ai/chapterIdeas.ts',
  'electron/ai/databaseAnalysis.ts',
  'electron/ai/databaseChat.ts',
  'electron/ai/debate.ts',
  'electron/ai/decorativeImages.ts',
  'electron/ai/deepResearchApproaches.ts',
  'electron/ai/deepResearchCore.ts',
  'electron/ai/deepResearchQueue.ts',
  'electron/ai/folderIdeaSuggestions.ts',
  'electron/ai/genealogyDeepResearch.ts',
  'electron/ai/hypothesisLab.ts',
  'electron/ai/immersion.ts',
  'electron/ai/immersionCore.ts',
  'electron/ai/libraryReaderChat.ts',
  'electron/ai/liveRelations.ts',
  'electron/ai/manuscriptVerifier.ts',
  'electron/ai/nodiChat.ts',
  'electron/ai/prompts.ts',
  'electron/ai/researchMap.ts',
  'electron/ai/semanticSearch.ts',
  'electron/ai/studyAssistant.ts',
  'electron/ai/studyDeepResearch.ts',
  'electron/ai/studyGuide.ts',
  'electron/ai/studyQuestions.ts',
  'electron/ai/tutor.ts',
  'electron/ai/worldArticleDraft.ts',
  'electron/ai/worldChat.ts',
  'electron/ai/worldQuestionOptions.ts',
  'electron/ai/worldRules.ts',
  'src/serverWeb/serverAiPrompts.ts',
  'src/views/DictionaryView.tsx',
];

const explicit = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const sources = explicit.length
  ? explicit.map((file) => path.relative(root, path.resolve(process.cwd(), file)))
  : DEFAULT_SOURCES;

const languageSet = new Set(PROMPT_LANGUAGE_CODES);

function keyName(property, source) {
  const name = property.name?.getText(source) ?? '?';
  return name.replace(/^['"]|['"]$/g, '');
}

/** Languages a `Record<Exclude<PromptLanguage, 'es'>, …>` type intentionally omits. */
function excludedLanguages(typeText) {
  const match = /Exclude<\s*PromptLanguage\s*,\s*'([^']+)'/.exec(typeText ?? '');
  return match ? match[1].split(/\s*\|\s*/) : [];
}

function inspectObject(node, source) {
  const properties = node.properties.filter(
    (property) =>
      ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property) ||
      ts.isMethodDeclaration(property) ||
      ts.isGetAccessorDeclaration(property),
  );
  if (!properties.length || properties.length !== node.properties.length) return null;
  const keys = properties.map((property) => keyName(property, source));
  const languageKeys = keys.filter((key) => languageSet.has(key));
  // A language map is an object whose properties are (almost) all language codes.
  if (languageKeys.length < 5 || languageKeys.length !== keys.length) return null;
  return languageKeys;
}

function collect(file) {
  const absolute = path.resolve(root, file);
  if (!fs.existsSync(absolute)) return { file, missing: null, maps: 0 };
  const source = ts.createSourceFile(
    absolute,
    fs.readFileSync(absolute, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
    absolute.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const records = [];
  const recordNodes = new Set();
  function visit(node) {
    // `const X: Record<PromptLanguage, …> = { … }` and `(… as Record<PromptLanguage, …>)`.
    const promptRecord = /Record<\s*(?:Exclude\s*<\s*)?PromptLanguage/;
    const declared = node.type && promptRecord.test(node.type.getText(source));
    const casted = ts.isAsExpression(node) && promptRecord.test(node.type.getText(source));
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && declared && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      const keys = node.initializer.properties.map((property) => keyName(property, source));
      recordNodes.add(node.initializer);
      records.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, keys: keys.filter((key) => languageSet.has(key)), omit: excludedLanguages(node.type.getText(source)) });
    } else if (casted && ts.isObjectLiteralExpression(node.expression)) {
      const keys = node.expression.properties.map((property) => keyName(property, source));
      recordNodes.add(node.expression);
      records.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, keys: keys.filter((key) => languageSet.has(key)), omit: excludedLanguages(node.type.getText(source)) });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  const maps = [];
  function visitObjects(node) {
    if (ts.isObjectLiteralExpression(node) && !recordNodes.has(node)) {
      const keys = inspectObject(node, source);
      if (keys) maps.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, keys });
    }
    ts.forEachChild(node, visitObjects);
  }
  visitObjects(source);

  const seen = new Set();
  const all = [...records, ...maps]
    .filter((entry) => {
      const signature = `${entry.line}:${entry.keys.join(',')}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .sort((a, b) => a.line - b.line);
  const withMissing = all
    .map((entry) => ({ ...entry, missing: PROMPT_LANGUAGE_CODES.filter((code) => !entry.keys.includes(code) && !(entry.omit ?? []).includes(code)) }))
    .filter((entry) => entry.missing.length);
  return { file, maps: all.length, withMissing };
}

let failed = false;
let totalMaps = 0;
let totalMissing = 0;
for (const file of sources) {
  const { maps, withMissing } = collect(file);
  totalMaps += maps;
  if (!withMissing.length) continue;
  failed = true;
  console.log(`\n${file} — ${withMissing.length}/${maps} incomplete`);
  for (const entry of withMissing) {
    totalMissing += entry.missing.length;
    console.log(`  line ${entry.line}: missing ${entry.missing.join(', ')}`);
  }
}
console.log(
  failed
    ? `\nPrompt-language parity FAILED: ${totalMissing} missing entries across ${sources.length} sources.`
    : `Prompt-language parity OK: ${totalMaps} language maps across ${sources.length} sources.`,
);
process.exitCode = failed ? 1 : 0;
