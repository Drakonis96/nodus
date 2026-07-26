// Recorder for this deck: what is particular to this video, and nothing else.
//
//   node scripts/tutorial/engine/narrate.mjs --deck=<yourdeck>
//   node scripts/tutorial/decks/<yourdeck>/record.mjs --dry     # rehearse, free
//   node scripts/tutorial/decks/<yourdeck>/record.mjs           # the real take
//
// --dry gives every shot a fixed 4.5s and needs no narration. Use it to prove the
// clicks land BEFORE spending anything on voice.

import path from 'node:path';
import { record, repoRoot } from '../../engine/recorder.mjs';
import { SHOTS, nav } from './shots.mjs';

await record({
  name: '<yourdeck>',
  shots: SHOTS,
  nav,

  // Reuse an existing scanned corpus when the video only needs a vault to exist.
  // Omit for a video that must start from an empty vault.
  // masterProfile: path.join(repoRoot, '.tutorial-out', 'nodi', 'profile'),

  // Merged over BASE_SETTINGS (English UI, English AI output, every tour and modal
  // suppressed). Set only what this video needs.
  settings: {
    theme: 'light',        // 'light' or leave out for dark
    mascotEnabled: false,  // keep Nodi out of the frame unless it is the subject
  },

  helpers: (ctx) => {
    const { page, settle, warn, pointAndClick, searchSettings, diagnose } = ctx;
    return {
      doSomething: async () => {
        await pointAndClick('[data-tour="nav-library"]', { required: false });
        await settle(1200);
      },

      openSomething: async () => {
        await pointAndClick('button:has-text("Collections")', { required: false });
        await settle(2000);
        // Always verify. A helper that silently does nothing still lets the run
        // report success, and the failure only shows up in the finished video.
        if (!(await page.locator('[role="dialog"]').first().isVisible().catch(() => false))) {
          await diagnose('dialog-did-not-open');
        }
      },
    };
  },
});
