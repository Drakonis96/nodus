// Shot list for the MCP and Nodus Server tutorial.
//
// Two features that get mistaken for each other, so the video draws the line
// first and configures second. Both halves are filmed for real: the MCP server is
// switched on and its connection details opened, and the vault is paired against
// a Nodus Server running locally, so the connection that appears is genuine.
//
// The bearer token is a secret and is blurred throughout — the same treatment the
// API keys got in the academic tutorial.
//
// What is NOT filmed, and is said plainly in the narration instead: standing the
// server up with Docker, and the admin steps of creating a space and generating a
// pairing code. Those happen outside the app.

export const nav = (view) => `[data-tour="nav-${view}"]`;

/** Where the tutorial pairs. A local server keeps the recording self-contained. */
export const SERVER_URL = 'http://localhost:7443';

/** The words on the opening card. */
export const TITLE = 'MCP and Nodus Server';

export const SHOTS = [
  // ────────────────────────────────────────────── what they are
  {
    id: 'welcome',
    say: 'Nodus can let other software reach your work in two different ways, and they are easy to confuse.',
    nav: 'settings',
    settleBefore: 2500,
  },
  {
    id: 'mcp-what',
    say: 'The first is M C P, the model context protocol. It opens a small server on this computer that an AI client can query, so a model can look things up in your vault while it answers you.',
  },
  {
    id: 'server-what',
    say: 'The second is Nodus Server, which is the opposite direction: it publishes a filtered copy of a vault so that other people can read it.',
  },
  {
    id: 'difference',
    say: 'The short version: M C P keeps everything on your machine, and Nodus Server is how you share with someone else.',
  },

  // ────────────────────────────────────────────── configuring MCP
  {
    id: 'mcp-open',
    say: 'M C P lives in the integrations settings.',
    act: async (h) => { await h.findSetting('MCP', 'section.card:has([data-testid="mcp-settings-card"])'); },
    highlight: 'section.card:has([data-testid="mcp-settings-card"])',
  },
  {
    id: 'mcp-enable',
    say: 'One switch starts it, and the status line below tells you it is listening.',
    act: async (h) => { await h.enableMcp(); },
    highlight: 'section.card:has([data-testid="mcp-settings-card"])',
  },
  {
    id: 'mcp-port',
    say: 'It listens on a local port, four three one nine by default, and only on this computer. Nothing is exposed to the network.',
    highlight: 'section.card:has([data-testid="mcp-settings-card"])',
  },
  {
    id: 'mcp-details',
    say: 'To connect a client you need two things, and both are here.',
    act: async (h) => { await h.openMcpDetails(); await h.mcpTab('Other client'); },
    keepOverlay: true,
    focus: '.modal, [role="dialog"]',
  },
  {
    id: 'mcp-values',
    say: 'The address the client should call, and a bearer token that proves the request is yours. The token is blurred here because it is a secret, exactly like an API key.',
    keepOverlay: true,
    focus: '.modal, [role="dialog"]',
  },
  {
    id: 'mcp-config',
    say: 'And for Claude Desktop there is a ready made configuration block, already filled in with your own address and token.',
    keepOverlay: true,
    act: async (h) => { await h.mcpTab('Claude Desktop'); },
    focus: '.modal, [role="dialog"]',
  },
  {
    id: 'mcp-chatgpt',
    say: 'There is also a guided option that connects to ChatGPT through a secure tunnel, without opening any port yourself.',
    act: async (h) => { await h.mcpTab('ChatGPT'); },
    keepOverlay: true,
    focus: '.modal, [role="dialog"]',
  },
  {
    id: 'mcp-regen',
    say: 'And if a token ever escapes, regenerating it revokes the old one straight away. Every client then has to be reconnected.',
    act: async (h) => { await h.closeMcpDetails(); },
    highlight: 'section.card:has([data-testid="mcp-settings-card"])',
  },

  // ────────────────────────────────────────────── configuring the server
  {
    id: 'server-open',
    say: 'Nodus Server has its own section, and it starts somewhere else entirely: on a machine that stays on.',
    act: async (h) => { await h.findSetting('Nodus Server', 'section.card:has([data-testid="nodus-server-settings-card"])'); },
    highlight: 'section.card:has([data-testid="nodus-server-settings-card"])',
  },
  {
    id: 'server-docker',
    say: 'You run it yourself with Docker, on a home server or a rented one, and the built-in guide walks through that part step by step.',
    highlight: 'section.card:has([data-testid="nodus-server-settings-card"])',
  },
  {
    id: 'server-how',
    say: 'Once it is up, the split is this: your computer publishes, and the server serves. It keeps answering even when your machine is off.',
    highlight: 'section.card:has([data-testid="nodus-server-settings-card"])',
  },
  {
    id: 'server-outbound',
    say: 'Nothing is opened on your side. Nodus pushes out over H T T P S, and it shares no port or token with the local M C P.',
    highlight: 'section.card:has([data-testid="nodus-server-settings-card"])',
  },
  {
    id: 'server-url',
    say: 'To connect a vault you give it the address of your server.',
    act: async (h) => { await h.typeServerUrl(); },
    highlight: 'section.card:has([data-testid="nodus-server-settings-card"])',
  },
  {
    id: 'server-code',
    say: 'And a pairing code, which you create in the server itself: sign in as administrator, make a space, and ask it for a code. It lasts fifteen minutes and works once.',
    act: async (h) => { await h.typePairCode(); },
    highlight: 'section.card:has([data-testid="nodus-server-settings-card"])',
  },
  {
    id: 'server-connect',
    say: 'Connect, and the vault is paired.',
    act: async (h) => { await h.connectServer(); },
    highlight: 'section.card:has([data-testid="nodus-server-settings-card"])',
  },
  {
    id: 'server-list',
    say: 'From here on each vault you connect is listed on its own, with when it last published.',
    highlight: 'section.card:has([data-testid="nodus-server-settings-card"])',
  },
  {
    id: 'server-privacy',
    say: 'What travels is a filtered copy: references and the academic layer built from them. P D Fs, credentials, file paths, embeddings and anything about students never leave your computer.',
    act: async (h) => { await h.showServerToggles(); },
    highlight: 'section.card:has([data-testid="nodus-server-settings-card"])',
  },
  {
    id: 'server-publish',
    say: 'Publishing then happens on its own, in the background, and you can always push the current state by hand.',
    act: async (h) => { await h.publishNow(); },
    highlight: 'section.card:has([data-testid="nodus-server-settings-card"])',
  },
  {
    id: 'recap',
    say: 'So: M C P to let a model read your vault here, Nodus Server to let people read it there. Different jobs, and you can run either one without the other.',
    settleBefore: 1200,
  },
];
