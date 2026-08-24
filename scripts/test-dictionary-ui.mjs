import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [view, corpus, navigation, authors, ai, academicIpc, preload] =
  await Promise.all([
    readFile(path.join(root, "src/views/DictionaryView.tsx"), "utf8"),
    readFile(path.join(root, "src/app/views/corpus.tsx"), "utf8"),
    readFile(path.join(root, "src/navigation.ts"), "utf8"),
    readFile(path.join(root, "src/views/AuthorsView.tsx"), "utf8"),
    readFile(path.join(root, "electron/ai/dictionary.ts"), "utf8"),
    readFile(path.join(root, "electron/ipc/academic.ts"), "utf8"),
    readFile(path.join(root, "electron/preload/academic.ts"), "utf8"),
  ]);

assert.match(
  navigation,
  /id: 'dictionary'[\s\S]*group: 'analyze'/,
  "Dictionary sits in the Analyse group",
);
assert.match(
  corpus,
  /dictionary:[\s\S]*<DictionaryView/,
  "Dictionary is registered as an internal view",
);
assert.match(
  view,
  /WorkspaceTabStrip/,
  "entries use the existing internal-tab strip",
);
assert.match(
  view,
  /bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100/,
  "Dictionary supports the existing light and dark themes",
);
assert.match(
  view,
  /DictionaryRows/,
  "the overview uses an Ideas-style row list",
);
assert.match(
  view,
  /<ConfirmModal/,
  "destructive actions use the app confirmation modal",
);
assert.doesNotMatch(
  view,
  /window\.confirm/,
  "Dictionary never opens a native confirmation window",
);
assert.doesNotMatch(
  view,
  /md:grid-cols-2 2xl:grid-cols-3/,
  "the overview no longer renders a card grid",
);
assert.match(
  view,
  /input input-with-leading-icon/,
  "search fields use the shared leading-icon padding",
);
assert.match(
  view,
  /useFeatureModel\(settings, ["']dictionaryModel["']\)/,
  "Dictionary persists an independent model selection",
);
assert.match(
  view,
  /<ModelPicker/,
  "Dictionary exposes the shared saved-model picker",
);
assert.match(
  view,
  /onCitation=\{onCitation\}/,
  "inline citations are interactive",
);
assert.match(
  view,
  /onOpenIdea\(item\.id\)/,
  "evidence can navigate to its idea",
);
assert.match(
  view,
  /onOpenAuthor\(author\.id, author\.name\)/,
  "related authors navigate to Authors",
);
assert.match(
  authors,
  /showAuthor\(\{ id: target\.authorId, label: target\.name \}\)/,
  "Authors consumes external tab targets",
);
assert.match(
  view,
  /onOpenLibraryWork\(work\.id\)/,
  "works open in Nodus Library",
);
assert.match(
  view,
  /window\.nodus\.openInZotero/,
  "valid Zotero references use the existing opener",
);
assert.match(
  view,
  /listDictionaryEntries\(\{[\s\S]*?query,[\s\S]*?letter:[\s\S]*?sort:/,
  "overview sends search, filters and sorting through IPC",
);
assert.match(view, /updateDictionaryEntry/, "manual editing is wired");
assert.match(
  view,
  /scanDictionaryNewEvidence/,
  "new-evidence detection is user controllable",
);
assert.match(
  view,
  /w-\[220px\] shrink-0 justify-center whitespace-nowrap[\s\S]*busy === "scan"/,
  "new-evidence button keeps a reserved width while its busy label changes",
);
assert.match(
  view,
  /btn btn-primary !text-white disabled:!text-white h-9 w-\[112px\] shrink-0[\s\S]*busy === mode/,
  "generation button keeps its reserved width while its busy label changes",
);
assert.match(
  view,
  /w-\[112px\] shrink-0 justify-center whitespace-nowrap border border-neutral-300[\s\S]*busy === "update"/,
  "update button keeps its reserved width while its busy label changes",
);
assert.match(
  view,
  /generate\(["']update["']\)/,
  "Update is separate from regeneration",
);
assert.match(
  view,
  /startDictionaryGeneration\(\{/,
  "creation starts the automatic background pipeline without an evidence-review gate",
);
assert.match(
  view,
  /onDictionaryProgress/,
  "the overview subscribes to background generation progress",
);
assert.match(
  view,
  /Icon name="refresh"[\s\S]*animate-spin/,
  "the status column renders an animated generation indicator",
);
assert.match(
  academicIpc,
  /dictionary:generate:start[\s\S]*retrieveDictionaryEvidence[\s\S]*generateDictionaryEntry/,
  "the background IPC automatically retrieves and generates in order",
);
assert.match(
  preload,
  /failureDetail[\s\S]*throw new Error\(result\.failureDetail\)/,
  "synchronous regeneration preserves the real backend failure detail",
);
assert.match(
  view,
  /mode: "creation"/,
  "the automatic creation result is saved as the initial applied version",
);
assert.match(
  view,
  /<ButtonBusy label=\{t\("Preparando definición…"\)\} \/>/,
  "creation closes after preparing the persisted background job",
);
assert.match(
  view,
  /className="btn btn-primary !text-white disabled:!text-white"/,
  "primary generation controls retain white text in every theme",
);
assert.match(
  view,
  /restoreDictionaryVersion/,
  "version restoration is available",
);
const generatedAt = ai.indexOf("const generated = await generator");
const savedAt = ai.indexOf("return saveDictionaryVersion", generatedAt);
assert.ok(
  generatedAt >= 0 && savedAt > generatedAt,
  "provider generation completes before any version is saved, so failure preserves current content",
);
assert.match(
  ai,
  /La versión anterior se conserva/,
  "citation-validation failure reports that the previous version is preserved",
);
assert.match(
  ai,
  /findSimilarIdeasPaged\(vector,[\s\S]*nodusIds: scope\.ids/,
  "retrieval reuses scoped Deep Research idea embeddings",
);
assert.match(
  ai,
  /findSimilarPassagesPaged\(vector,[\s\S]*nodusIds: scope\.ids/,
  "retrieval reuses scoped Deep Research passage embeddings",
);
assert.match(
  ai,
  /FROM edges e JOIN ideas related/,
  "automatic retrieval enriches idea evidence with existing graph relations",
);
assert.match(
  ai,
  /Relación almacenada en el grafo:/,
  "stored relations are supplied to the synthesis as evidence",
);
assert.match(
  ai,
  /selectedIdeas < 12[\s\S]*selectedPassages < 8/,
  "initial retrieval automatically selects the strongest ideas and passages",
);
assert.match(
  ai,
  /applyCitationPolicy[\s\S]*extractCitationClaims[\s\S]*aiVerifyCitations/,
  "generation reuses Deep Research citation validation",
);
assert.match(
  ai,
  /No se encontró evidencia relevante suficiente/,
  "an empty automatic retrieval fails explicitly without inventing content",
);
assert.doesNotMatch(
  ai,
  /SELECT type,label,statement,created_at,updated_at FROM ideas/,
  "retrieval never queries a nonexistent ideas.updated_at column",
);

console.log("test-dictionary-ui: OK");
