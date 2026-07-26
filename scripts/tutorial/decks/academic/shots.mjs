// Shot list for the ACADEMIC VAULT tutorial — the second video.
//
// Where the introductory tutorial explains what Nodus is, this one follows a real
// project from an empty vault to a finished analysis: configure the models, import
// a Zotero collection, scan it, and then walk the views that the scan makes
// possible. It is filmed against a real Zotero library and real API calls, so what
// the viewer sees is what they will get.
//
// ─────────────────────────────────────────────────────────────────────────────
// PRIVACY REQUIREMENTS — these are not preferences, they are conditions of
// recording, and record-academic.mjs enforces each one:
//
//   1. API keys are typed into masked fields and additionally covered by an
//      opaque overlay while typing. No frame may contain a legible key.
//   2. Only the "Nodus Tests" collection may be readable in the Zotero picker.
//      Every other collection row is blurred — the library has 100+ of them and
//      they are the author's real research.
//   3. The recording profile is a throwaway NODUS_USERDATA. The installed Nodus
//      and its vaults are never opened, read or modified.
//
// Zotero collection: "Nodus Tests" (key 3NUJ4GYJ) — 15 journal articles on the
// Overland Trail and the American West, every one with a PDF attached.
//
// Models, and only these two:
//   • embeddings — OpenRouter · baai/bge-m3
//   • everything else — Google Gemini · gemini-3.1-flash-lite
// ─────────────────────────────────────────────────────────────────────────────

export const nav = (view) => `[data-tour="nav-${view}"]`;

/** The collection this tutorial imports; everything else stays blurred. */
export const TARGET_COLLECTION = 'Nodus Tests';

/**
 * The subset actually scanned. Five is enough to produce a graph with genuine
 * relations while keeping the recording to a sane length, and these five were
 * picked to overlap: same subject, complementary angles (route, food, children,
 * women, method) and a century of historiography between the oldest and newest,
 * which is what produces contradictions worth showing.
 */
export const SCAN_TITLES = [
  'The Oregon Trail',
  'Food of the Overland Emigrants',
  'Children and Young People on the Overland Trail',
  'Argonauts and the Overland Trail Experience',
  'I have not told half we suffered',
];

/** The words on the opening card. */
export const TITLE = 'The academic vault';

export const SHOTS = [
  // ───────────────────────────────────────────────────────────── opening
  {
    id: 'welcome',
    say: 'This is the academic vault, followed from an empty library all the way to a finished analysis.',
  },
  {
    id: 'plan',
    say: 'We will set up the models, bring in a Zotero collection, read it properly, and then explore what that reading produces.',
  },

  // ──────────────────────────────────────────────────── models: embeddings
  {
    id: 'models-first',
    say: 'Before anything else, the models. Nothing works well until these are right, so this is where a new vault should start.',
    nav: 'settings',
    act: async (h) => { await h.searchSettings('provider'); },
  },
  {
    id: 'provider-openrouter',
    say: 'First a provider. OpenRouter gives access to models from many companies with a single key.',
    act: async (h) => { await h.openProvider('openrouter'); },
  },
  {
    id: 'key-privacy',
    say: 'The key is pasted into a masked field and stored encrypted on this computer. It is never shown again, not even to you.',
    act: async (h) => { await h.enterProviderKey('openrouter'); },
  },
  {
    id: 'load-models',
    say: 'With the key saved, Nodus loads the provider catalogue.',
    act: async (h) => { await h.loadModels('openrouter'); },
  },
  {
    id: 'embedding-choose',
    say: 'Now the embedding model, which builds the semantic index everything else depends on.',
    act: async (h) => { await h.searchSettings('embedding'); },
  },
  {
    id: 'embedding-bge',
    say: 'The recommendation is B G E M three. It handles long passages and works across languages, which matters when your sources are not all in one.',
    act: async (h) => { await h.setEmbeddingModel('openrouter', 'baai/bge-m3'); },
  },
  {
    id: 'embedding-favourite',
    say: 'Marking it as a favourite keeps it at the top of every selector from now on.',
    act: async (h) => { await h.markFavourite('openrouter', 'baai/bge-m3'); },
  },

  // ────────────────────────────────────────────────────── models: Gemini
  {
    id: 'provider-gemini',
    say: 'For the reading itself we add a second provider: Google Gemini.',
    act: async (h) => { await h.searchSettings('provider'); await h.openProvider('gemini'); },
  },
  {
    id: 'gemini-key',
    say: 'Same again — a masked field, an encrypted key, and the catalogue loads.',
    act: async (h) => { await h.enterProviderKey('gemini'); await h.loadModels('gemini'); },
  },
  {
    id: 'gemini-model',
    say: 'Gemini 3.1 Flash Lite is the model to pick here: fast, inexpensive, and not a reasoning model, which is exactly what extraction needs.',
    act: async (h) => { await h.markFavourite('gemini', 'gemini-3.1-flash-lite'); },
  },

  // ───────────────────────────────────────────────── advanced configuration
  {
    id: 'advanced-why',
    say: 'Now we switch to advanced configuration, because these two models do different jobs and should not be interchangeable.',
    act: async (h) => { await h.searchSettings('model'); await h.switchModelMode('Advanced'); },
  },
  {
    id: 'advanced-assign',
    say: 'The embedding slot takes B G E M three from OpenRouter; every other task takes Gemini Flash Lite.',
    act: async (h) => { await h.assignAdvancedModels(); },
  },
  {
    id: 'advanced-done',
    say: 'That is the whole setup. One model to index, one model to read.',
  },

  // ─────────────────────────────────────────────────────────────── library
  {
    id: 'library-empty',
    say: 'The library is empty. Everything from here on comes from Zotero.',
    nav: 'library',
  },
  {
    id: 'collections-open',
    say: 'Nodus reads the Zotero library that is already on your machine, and asks which collections to watch.',
    act: async (h) => { await h.openCollections(); },
  },
  {
    id: 'collections-pick',
    say: 'You do not hand over your whole library — only what you choose. Here we take a single collection of fifteen articles on the American West.',
    act: async (h) => { await h.selectCollection(TARGET_COLLECTION); },
    keepOverlay: true,
  },
  {
    id: 'sync',
    say: 'Syncing brings in the metadata: titles, authors, years and the attached PDFs.',
    act: async (h) => { await h.syncZotero(); },
  },
  {
    id: 'library-full',
    say: 'Fifteen works, none of them read yet.',
    nav: 'library',
    settleBefore: 2500,
  },

  // ────────────────────────────────────────────────────────────── the scan
  {
    id: 'scan-start',
    say: 'For this walkthrough we take five of them, a tight group on the overland trail, and run a full scan. That is where Nodus actually reads.',
    // startFullScan opens the collections dialog itself, queues the work and closes
    // it again, so this beat does not depend on what the previous one left behind.
    keepOverlay: true,
    act: async (h) => { await h.startFullScan(); },
  },
  {
    id: 'scan-explain',
    say: 'It works through each PDF in chunks, pulling out themes, ideas, the evidence behind them, and the relationships between them.',
    // The queue card lives on Home, which is where the progress is legible.
    nav: 'home',
    focus: '[data-tour="queue"]',
  },
  {
    id: 'scan-progress',
    say: 'The queue shows exactly where it is. This takes real time and real API calls, so what you are watching here is sped up.',
    nav: 'home',
    focus: '[data-tour="queue"]',
    timelapse: true,
  },
  {
    id: 'scan-done',
    say: 'Five articles, read and indexed, with their ideas and the links between them.',
  },

  // ──────────────────────────────────────────────────────────────── graph
  {
    id: 'graph-open',
    say: 'And this is what that reading produced.',
    nav: 'graph',
    settleBefore: 3000,
  },
  {
    // The overview opens on themes, not ideas — describing it as a graph of ideas
    // put the narration at odds with what is on screen.
    id: 'graph-explore',
    say: 'It opens on the themes the corpus is built from, sized by how much of your reading sits under each one.',
    act: async (h) => { await h.exploreGraph(); },
  },
  {
    id: 'graph-expand',
    say: 'Opening them up shows the ideas underneath, and the links are the relationships Nodus found between them.',
    act: async (h) => { await h.exploreBiggestTheme(); },
  },
  {
    // The nodes are drawn on a WebGL canvas with no DOM handle, so a specific one
    // cannot be clicked by name. The Ideas view carries the same payload — idea,
    // source, supporting passage — and can actually be driven.
    id: 'graph-node',
    say: 'Each of those ideas is also listed on its own, with its type, the article it came from, and the passage that supports it.',
    nav: 'ideas',
    settleBefore: 2000,
    act: async (h) => { await h.clickIdea(); },
  },

  // ───────────────────────────────────────────────────────── the views
  {
    id: 'search',
    say: 'Search now works by meaning, not just by words, because the embedding model indexed every passage.',
    nav: 'search',
    // "women on the overland trail" returned a single work; this returns results
    // across ideas, works and themes, which is what the line claims.
    act: async (h) => { await h.searchByMeaning('overland trail'); },
  },
  {
    id: 'authors',
    say: 'Authors gathers what each writer argues across the corpus, so you can see a scholar’s position rather than a single article.',
    nav: 'authors',
  },
  {
    id: 'argument-map',
    say: 'The argument map lays out claims and the support or opposition between them.',
    nav: 'argument',
  },
  {
    id: 'debates',
    say: 'Debates collects the points where your sources genuinely disagree — often the most useful thing a corpus can tell you.',
    nav: 'debate',
  },
  {
    id: 'hypotheses',
    say: 'The hypothesis lab lets you state a claim and test it against the evidence you actually have.',
    nav: 'hypothesis',
  },
  {
    id: 'coverage',
    say: 'Coverage answers a blunter question: does this corpus support the question you are asking, and where is it thin?',
    nav: 'research',
  },
  {
    id: 'gaps',
    say: 'Gaps points at what is missing — the connections your sources imply but never make.',
    nav: 'gaps',
  },
  {
    id: 'reading-path',
    say: 'The reading path proposes an order to read in, built from how the ideas depend on each other.',
    nav: 'reading',
  },
  {
    id: 'immersion',
    say: 'Immersion turns the corpus into something you can browse and listen to rather than work through.',
    nav: 'immersion',
  },

  // ────────────────────────────────────────────────────────── deep research
  {
    id: 'deep-research',
    say: 'Deep Research is the most ambitious of them: it plans a report, writes it from your sources, and cites them as it goes.',
    nav: 'deepResearch',
  },
  {
    id: 'deep-run',
    say: 'You give it a question and it works through the corpus, section by section.',
    act: async (h) => { await h.runDeepResearch('How did women experience the Overland Trail?'); },
  },
  {
    id: 'deep-images',
    say: 'It can illustrate the result too, using the image model from the same Google key.',
    timelapse: true,
    maxWaitMinutes: 7,
  },
  {
    id: 'deep-result',
    say: 'What comes out is a cited draft, with every claim traceable back to the article it came from.',
    act: async (h) => { await h.openDeepResearchReport(); },
  },

  // ────────────────────────────────────────────────────────────── writing
  {
    id: 'writing',
    say: 'From there the writing workshop and projects are where you turn all of this into your own text, with the corpus alongside you.',
    nav: 'writing',
    act: async (h) => { await h.dismissDialog(); },
    focusBeforeAct: true,
  },

  // ──────────────────────────────────────────────────────────────── close
  {
    id: 'recap',
    say: 'That is the whole arc: two models, one collection, one scan, and a corpus you can question instead of just store.',
  },
  {
    id: 'closing',
    say: 'Start with a small collection you already know well. It is the fastest way to see whether Nodus is reading it the way you would.',
  },
];
