// The tutorial shot list: the single source of truth for narration, camera and
// subtitles.
//
// This deck replaces the cinematic BasicsTutorial. It is the first thing a new user
// sees, so it covers what is *general* to Nodus — vaults, models, embeddings, the
// integrations, Nodi — rather than any single vault type. Per-vault tutorials come
// later and may assume this one has been watched.
//
// Each shot is one narrated beat:
//   id         stable identifier; also the audio clip filename
//   say        one sentence of English voice-over = one subtitle cue
//   nav        sidebar view to open at the start of the shot (the click is filmed)
//   focus      CSS selector the camera pushes in on; omit for a wide shot
//   highlight  CSS selector to ring, without moving the camera
//   act        async interaction, played while the narration runs
//
// Two deliberate rules about the camera:
//
//   The push-in is reserved — the vault-type picker and meeting Nodi, nowhere else.
//   Zooming on every mention made the video restless and implied significance where
//   there was none.
//
//   Everything else points with `highlight`, which rings the subject while keeping
//   the whole window in view, so the viewer never loses their bearings.
//
// Timing is not specified here on purpose: each shot lasts exactly as long as its
// synthesized narration, so the picture can never drift from the voice.

/** Sidebar entries are tagged `data-tour="nav-<view>"` by App.tsx. */
export const nav = (view) => `[data-tour="nav-${view}"]`;

/** A vault-type card inside the add-vault dialog, found by its visible name. */
const vaultCard = (name) => `[role="dialog"] button:has-text("${name}")`;

/** The words on the opening card. */
export const TITLE = 'Introduction and first steps';

export const SHOTS = [
  // ---------------------------------------------------------------- opening
  {
    id: 'welcome',
    say: 'Welcome to Nodus. It is a workspace for your documents, notes and sources, built to show you how they connect.',
  },
  {
    id: 'local-first',
    say: 'Everything is stored on your own computer. Your material only leaves it when you choose a feature that uses an external service.',
  },
  {
    id: 'tour-plan',
    say: 'In the next few minutes we will look at vaults, at the AI models Nodus needs, and at the tools built around them.',
  },

  // ----------------------------------------------------------------- vaults
  {
    id: 'vault-concept',
    say: 'Everything starts with a vault. A vault is a separate workspace that keeps one project together.',
    focus: '[data-vault-trigger]',
  },
  {
    id: 'vault-open-types',
    say: 'When you create one, Nodus asks what kind of work it is for, and that choice shapes the whole vault.',
    act: async (h) => {
      await h.openVaultTypes();
    },
  },
  {
    id: 'vault-academic',
    say: 'Academic is for research: a bibliography from Zotero, extracted ideas, authors and relationships.',
    focus: '[role="dialog"]',
    keepOverlay: true,
    highlight: vaultCard('Academic'),
  },
  {
    id: 'vault-study',
    say: 'Study is for learning: courses, subjects, notes, materials and revision.',
    focus: '[role="dialog"]',
    keepOverlay: true,
    highlight: vaultCard('Study'),
  },
  {
    id: 'vault-teaching',
    say: 'Teaching is for the other side of the classroom: your own courses, timetables, materials and marking.',
    focus: '[role="dialog"]',
    keepOverlay: true,
    highlight: vaultCard('Teaching'),
  },
  {
    id: 'vault-databases',
    say: 'Databases is for structured information: typed tables, relations between them, and analysis.',
    focus: '[role="dialog"]',
    keepOverlay: true,
    highlight: vaultCard('Databases'),
  },
  {
    id: 'vault-genealogy',
    say: 'Genealogy is for family history: people, kinship, timelines and documentary evidence.',
    focus: '[role="dialog"]',
    keepOverlay: true,
    highlight: vaultCard('Genealogy'),
  },
  {
    id: 'vault-more',
    say: 'More are on the way, and the badges tell you which ones are still in beta or preview.',
    focus: '[role="dialog"]',
    keepOverlay: true,
    highlight: vaultCard('Worldbuilding'),
  },
  {
    id: 'vault-isolation',
    say: 'Each vault keeps its own library, its own notes and its own settings, so two projects never mix.',
    focus: '[role="dialog"]',
    keepOverlay: true,
    focusBeforeAct: true,
    act: async (h) => {
      await h.settle(1600);
      await h.dismiss();
    },
  },

  // ------------------------------------------------------------- the layout
  {
    id: 'sidebar',
    say: 'Inside a vault you move through the sidebar. Its sections are grouped by what you are doing: exploring, analysing and creating.',
    highlight: '[data-testid="resizable-sidebar"]',
  },

  // ---------------------------------------------------------------- library
  {
    id: 'library-intro',
    say: 'The Library holds your sources. Depending on the vault they come from Zotero, from your own files, or from what you record.',
    nav: 'library',
  },
  {
    id: 'library-scan',
    say: 'Each item shows how far Nodus has read it. A light pass finds themes; a deep pass extracts ideas together with the evidence for them.',
    nav: 'library',
    highlight: '[data-tour="library-actions"]',
  },
  {
    id: 'library-analyse',
    say: 'You choose what gets analysed and when. Nothing is processed unless you ask for it.',
    nav: 'library',
  },

  // ------------------------------------------------------------------ ideas
  {
    id: 'ideas-intro',
    say: 'What that deep pass extracts appears here, as individual ideas rather than whole documents.',
    nav: 'ideas',
  },
  {
    id: 'ideas-open',
    say: 'Open one and you get the full picture of it.',
    nav: 'ideas',
    act: async (h) => {
      await h.clickIdea();
    },
  },
  {
    id: 'ideas-evidence',
    say: 'Its type, the source it came from, and the exact passage that supports it.',
  },
  {
    id: 'ideas-trust',
    say: 'That last part is the important one: trust an idea only once you have read the evidence behind it.',
  },

  // ------------------------------------------------------------------ graph
  {
    id: 'graph-intro',
    say: 'The graph turns those ideas into a landscape. Every node is an idea and every link a relationship between them.',
    nav: 'graph',
    settleBefore: 2600,
  },
  {
    id: 'graph-reading',
    say: 'Clusters show where your sources agree. The bridges between clusters are often the most interesting places to look.',
    nav: 'graph',
  },

  // ----------------------------------------------------------------- models
  {
    id: 'models-why',
    say: 'None of that happens by itself. Nodus brings no intelligence of its own — you choose which AI models it uses, and this is the setup step that matters most.',
    nav: 'settings',
    act: async (h) => {
      await h.searchSettings('model');
    },
  },
  {
    id: 'models-basic',
    say: 'There are two ways to configure them. Basic configuration uses one general model for everything, and it is the right place to start.',
    highlight: '[data-testid="model-settings-mode"]',
  },
  {
    id: 'models-advanced',
    say: 'Advanced configuration assigns a different model to each task. That is useful later, once you know which parts you want to tune.',
    act: async (h) => {
      await h.switchModelMode('Advanced');
    },
  },
  {
    id: 'models-providers',
    say: 'Models come from providers. You add one with its API key, and Nodus keeps that key encrypted on your machine.',
    act: async (h) => {
      await h.searchSettings('provider');
    },
  },
  {
    id: 'models-openrouter',
    say: 'OpenRouter is a good place to begin, because a single key gives you models from many different companies.',
    highlight: '[data-testid="provider-openrouter"]',
    act: async (h) => {
      await h.openProvider('openrouter');
    },
  },
  {
    id: 'models-catalogue',
    say: 'Once a provider is connected, its whole catalogue becomes available in every model selector in Nodus.',
    act: async (h) => {
      await h.searchSettings('model');
      await h.scrollTo('main label:has-text("Theme, idea and evidence extraction")');
    },
  },

  // ------------------------------------------------------ extraction advice
  {
    id: 'extraction-intro',
    say: 'Two pieces of advice about the model that extracts ideas, because they decide whether Nodus feels quick or feels broken.',
    highlight: [
      'main div:has(> label:has-text("Theme, idea and evidence extraction"))',
      'main label:has-text("Theme, idea and evidence extraction")',
    ],
  },
  {
    id: 'extraction-api',
    say: 'First, prefer a model reached through an API. Extraction reads your documents in chunks, and a remote model does in seconds what a local one takes minutes to do.',
    highlight: [
      'main div:has(> label:has-text("Theme, idea and evidence extraction"))',
      'main label:has-text("Theme, idea and evidence extraction")',
    ],
  },
  {
    id: 'extraction-thinking',
    say: 'Second, do not use a reasoning model for extraction. Thinking models spend their budget deliberating and often return nothing usable, so a plain, fast model is the better choice.',
    highlight: [
      'main div:has(> label:has-text("Theme, idea and evidence extraction"))',
      'main label:has-text("Theme, idea and evidence extraction")',
    ],
  },
  {
    id: 'extraction-recommend',
    say: 'After a lot of testing, the Gemini Flash Lite models gave the best balance of speed, cost and dependable results for this particular job.',
    highlight: [
      'main div:has(> label:has-text("Theme, idea and evidence extraction"))',
      'main label:has-text("Theme, idea and evidence extraction")',
    ],
    act: async (h) => {
      await h.chooseExtractionModel('openrouter', 'google/gemini-3.1-flash-lite');
      await h.scrollTo('main label:has-text("Theme, idea and evidence extraction")');
    },
  },

  // ----------------------------------------------------------- local models
  {
    id: 'local-models',
    say: 'Nodus can also run models on your own machine, with nothing leaving your computer at all.',
    act: async (h) => {
      await h.searchSettings('model');
    },
  },
  {
    id: 'local-kinds',
    say: 'There is one for chat, one for transcribing audio, one for generating images, and one for embeddings. Each is downloaded only if you want it.',
    highlight: '[data-testid="nodus-local-ai-models"]',
  },
  {
    id: 'local-tradeoff',
    say: 'They are private and free, but slower, and they need a capable computer. A good compromise is local models for everyday chat and an API for heavy analysis.',
  },

  // ------------------------------------------------------------- embeddings
  {
    id: 'embeddings-what',
    say: 'Now the setting most people overlook: the embedding model, which builds a semantic index of your material.',
    act: async (h) => {
      await h.searchSettings('embedding');
    },
  },
  {
    id: 'embeddings-why',
    say: 'That index is what lets you search by meaning instead of exact words, and it is what finds the relationships and bridges between your ideas.',
    highlight: '[data-testid="nodus-local-embedding-list"]',
  },
  {
    id: 'embeddings-warning',
    say: 'Without it, semantic search simply returns nothing — and an empty result then means the vault was never indexed, not that your sources lack the topic.',
  },
  {
    id: 'embeddings-recommend',
    say: 'The recommendation is B G E M three. It runs locally, it handles long passages, and it works across languages, which matters when your sources are not all in the same one.',
  },

  // ----------------------------------------------------- other capabilities
  // These two stay in the model settings they are describing. They used to jump to
  // the Toolkit and back, which left the narration talking about image and audio
  // models over a screen showing neither.
  {
    id: 'images',
    say: 'Beyond text, Nodus reads images and can generate them, which helps with figures, diagrams and scanned pages.',
    highlight: '[data-testid="nodus-local-image-models"]',
    act: async (h) => {
      await h.searchSettings('model');
      await h.scrollTo('[data-testid="nodus-local-image-models"]');
    },
  },
  {
    id: 'audio',
    say: 'It also transcribes recordings and reads your material aloud, so you can listen to a long document instead of reading it.',
    highlight: '[data-testid="stt-settings"]',
    act: async (h) => {
      await h.scrollTo('[data-testid="stt-settings"]');
    },
  },
  {
    id: 'toolkit',
    say: 'The Toolkit gathers the practical tools: converting files, protecting documents, translating, a presentation mode and an OCR workspace.',
    nav: 'toolkit',
    highlight: '[data-testid="toolkit-home"]',
  },

  // ----------------------------------------------------------- integrations
  {
    id: 'mcp-intro',
    say: 'Nodus can also open up to other software. The MCP server lets an AI assistant read this vault directly.',
    nav: 'settings',
    act: async (h) => {
      await h.searchSettings('server');
    },
  },
  {
    id: 'mcp-how',
    say: 'It listens only on your own computer, so an assistant can search your sources, read your notes and cite them, without your library being published anywhere.',
    highlight: '[data-testid="mcp-settings-card"]',
  },
  {
    id: 'server-intro',
    say: 'Nodus Server does something different: it keeps a filtered copy of a vault up to date over an outbound connection.',
    highlight: '[data-testid="nodus-server-settings-card"]',
  },
  {
    id: 'server-how',
    say: 'That is how you reach the same vault from another device or share it with someone, while no port is opened on your machine.',
    highlight: '[data-testid="nodus-server-settings-card"]',
  },
  {
    id: 'plugins',
    say: 'There are also plugins for the places you already work: Zotero, Microsoft Word and LibreOffice.',
    act: async (h) => {
      await h.searchSettings('MCP');
    },
  },

  // ------------------------------------------------------------------- nodi
  {
    id: 'nodi-settings',
    say: 'Last of all, you are not alone in here. Nodi is the companion that floats in the corner, and you can choose how it looks.',
    act: async (h) => {
      await h.searchSettings('Nodi');
    },
  },
  {
    id: 'nodi-meet',
    say: 'This is Nodi.',
    focus: '.nodi-anchor',
  },
  {
    id: 'nodi-open',
    say: 'Click it and you get a chat that knows both the app and your own material, along with your notifications and help when you need it.',
    focus: '.nodi-anchor',
    act: async (h) => {
      await h.clickNodi();
    },
  },

  // ------------------------------------------------------------------ close
  {
    id: 'first-setup',
    say: 'A safe way to start is small. Create one vault, connect one provider, choose an embedding model, and analyse a handful of documents you already know well.',
    act: async (h) => {
      await h.dismiss();
    },
  },
  {
    id: 'closing',
    say: 'That is Nodus. Check the evidence, keep your material yours, and let the graph grow with your reading.',
  },
];
