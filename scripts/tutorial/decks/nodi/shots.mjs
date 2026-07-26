// Shot list for the Nodi mini-tutorial.
//
// Filmed on a copy of the already-scanned academic corpus, so no work is
// re-analysed and no scan is paid for. The chat answers are scripted rather than
// generated: a tutorial should show the same thing every time it is watched, and
// a live model would not. They are written from what this corpus actually
// contains, so nothing is claimed that the sources do not support.
//
// Camera rules, unchanged from the other two decks: push in for modals and for
// Nodi itself, highlight everything else.

export const nav = (view) => `[data-tour="nav-${view}"]`;

/** What Nodi is told to answer. Both replies stay inside what the corpus says. */
export const SCRIPTED = {
  app: `To bring in your own library, open **Library → Collections**. Nodus reads the Zotero installed on this machine and asks which collections it may watch — you pick them one by one, and everything you do not pick stays private.

Once a collection is monitored, **Sync** brings across titles, authors, years and attached PDFs. Nothing is analysed until you ask for it: choose the works you want and run a scan.`,

  corpus: `From the works in this vault, the dangers fall into three groups.

**Illness and the body.** The sources list disease, drowning, starvation and heat stroke among the causes of death, with the Donner Party study treating the episode as an epidemiological event rather than an anecdote.

**The journey itself.** Accidental injury recurs — loaded firearms carried alongside household goods, and animals stampeding when buffalo herds crossed the route.

**What the writing does not say.** *"I have not told half we suffered"* argues that women's diaries suppress mourning rather than record it: the dead were buried in shallow, unmarked graves and the party moved on, so grief is often visible only as an omission.`,
};

/** The words on the opening card. */
export const TITLE = 'Meet Nodi';

export const SHOTS = [
  // ─────────────────────────────────────────────────────── settings first
  {
    id: 'welcome',
    say: 'Nodi is the companion that lives inside Nodus, and everything about it starts here, in settings.',
    nav: 'settings',
    settleBefore: 2500,
    act: async (h) => { await h.findNodiSettings(); },
    highlight: 'section.card:has(.nodi-style-grid)',
  },
  {
    id: 'enable',
    say: 'A single switch turns it on or off, so if you would rather work without it, it simply is not there.',
    highlight: 'section.card:has(.nodi-style-grid)',
  },
  {
    id: 'style-open',
    say: 'It comes in two shapes, and you are shown both before choosing.',
    act: async (h) => { await h.openStylePicker(); },
    keepOverlay: true,
    focus: '.nodi-style-grid',
  },
  {
    id: 'style-orb',
    say: 'We will keep the orb.',
    act: async (h) => { await h.pickOrb(); },
    keepOverlay: true,
    focus: '.nodi-style-grid',
  },
  {
    id: 'colour-manual',
    say: 'Its colour can be chosen by hand, from a small set that sits well against both themes.',
    act: async (h) => { await h.setColourMode('manual'); },
  },
  {
    id: 'colour-cycle',
    say: 'Pick one and the orb changes with you, straight away.',
    act: async (h) => { await h.cycleColours(); },
  },
  {
    id: 'colour-auto',
    say: 'Left on automatic, which is where we will leave it, it takes the colour of whichever vault you are working in.',
    act: async (h) => { await h.setColourMode('auto'); },
  },
  {
    id: 'always-on-top',
    say: 'It can also float above every other window, so it stays with you when Nodus is not the app in front.',
    highlight: 'section.card:has(.nodi-style-grid)',
  },

  // ─────────────────────────────────────────────────────── meeting Nodi
  {
    id: 'meet',
    say: 'Back in the vault, there it is, in the corner and out of the way.',
    nav: 'graph',
    settleBefore: 3000,
    act: async (h) => { await h.clearGraphSearch(); },
    focus: '.nodi-companion',
  },
  {
    id: 'radial',
    say: 'One click opens its menu, and there are four things it can do.',
    act: async (h) => { await h.openRadial(); },
    focus: '.nodi-companion',
  },
  {
    id: 'who',
    say: 'The first is the simplest: it explains what it is and what it can help with.',
    act: async (h) => { await h.openRadialItem('help'); },
  },
  {
    id: 'notifications',
    say: 'Notifications gathers what Nodus wants to tell you, so nothing has to interrupt your reading.',
    act: async (h) => { await h.openRadialItem('ntf'); },
  },
  {
    id: 'notes',
    say: 'Quick notes is a scratchpad that follows you between views, for anything you would rather not lose.',
    act: async (h) => { await h.openRadialItem('notes'); },
  },

  // ─────────────────────────────────────────────────────── the chat
  {
    id: 'chat-open',
    say: 'And then the chat, which is the part that knows where it is.',
    act: async (h) => { await h.openRadialItem('chat'); },
  },
  {
    id: 'chat-app',
    say: 'Ask it about Nodus itself and it answers from the application, telling you the route rather than guessing at it.',
    act: async (h) => { await h.askNodi('How do I import a Zotero collection?', 'app'); },
  },
  {
    id: 'contexts',
    say: 'You decide what it may look at: the documentation, the view you have open, this vault, or every vault at once.',
    act: async (h) => { await h.openContexts(); },
  },
  {
    id: 'chat-corpus',
    say: 'With the vault selected it searches your own sources by meaning, and answers from what you have actually read.',
    act: async (h) => { await h.askNodi('What dangers did emigrants face on the Overland Trail?', 'corpus'); },
  },

  // ─────────────────────────────────────────────────────── closing it
  {
    id: 'context-menu',
    say: 'A right click on Nodi opens its own small menu.',
    act: async (h) => { await h.rightClickNodi(); },
    focus: '.nodi-companion',
  },
  {
    id: 'close',
    say: 'And from there it closes, without going back into settings to do it.',
    act: async (h) => { await h.closeNodi(); },
    // No push-in here: Nodi is gone by the end of the beat, and a wide shot is
    // what shows the corner it used to occupy now empty.
  },
  {
    id: 'recap',
    say: 'It stays gone until you want it back, and settings is where you turn it on again.',
    settleBefore: 1500,
  },
];
