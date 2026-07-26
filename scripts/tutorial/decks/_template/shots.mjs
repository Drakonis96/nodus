// Shot list template. Copy this folder to decks/<yourdeck>/ and edit.
//
// A shot is one sentence of narration plus whatever the app should be doing while
// that sentence is spoken. The narration decides how long the shot lasts, so write
// the sentence first and let the action fit inside it — never the other way round.
//
// Fields:
//   id            unique, stable; it names the audio clip and the subtitle cue
//   say           ONE sentence, spoken English. Spell out acronyms the way they
//                 should sound: 'M C P', 'H T T P S', 'P D F'
//   nav           a view to click first, e.g. 'graph' (see `nav` below)
//   settleBefore  ms to wait after navigating, before acting
//   act           async (h) => {}  — h is ctx + this deck's helpers
//   focus         selector to PUSH THE CAMERA IN on
//   highlight     selector to draw the ring around (no zoom)
//   keepOverlay   true when the shot's subject IS an open dialog
//   focusBeforeAct  measure the camera target before acting, not after
//   timelapse     hold until the deck's waitForWork resolves, then compress
//   chapter       label for describe.mjs; omit on shots that are not chapters
//
// CAMERA RULE, kept across every deck so the videos feel like one series:
//   push in (`focus`) only for modals and for Nodi. Everything else gets the ring
//   (`highlight`). Zooming on ordinary panels makes the picture restless.

export const nav = (view) => `[data-tour="nav-${view}"]`;

/** The words on the opening card. */
export const TITLE = 'Your tutorial title';

export const SHOTS = [
  {
    id: 'welcome',
    say: 'One sentence that says what this video is about.',
    nav: 'home',
    settleBefore: 2500,
    chapter: 'Introduction',
  },
  {
    id: 'example-highlight',
    say: 'A sentence about something on screen, with a ring drawn around it.',
    highlight: 'section.card:has(h2)',
  },
  {
    id: 'example-act',
    say: 'A sentence about something being done, while it is being done.',
    act: async (h) => { await h.doSomething(); },
    highlight: 'main',
  },
  {
    id: 'example-modal',
    say: 'A sentence about a dialog, which is the one case where the camera pushes in.',
    act: async (h) => { await h.openSomething(); },
    keepOverlay: true,
    focus: '[role="dialog"], .modal',
  },
  {
    id: 'recap',
    say: 'One closing sentence that leaves the viewer with the point.',
    settleBefore: 1200,
  },
];
