import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-release-notes-'));
const bundlePath = path.join(tempDir, 'releaseNotes.mjs');

try {
  execFileSync(
    path.join(root, 'node_modules/esbuild/bin/esbuild'),
    [
      path.join(root, 'shared/releaseNotes.ts'),
      '--bundle',
      '--platform=node',
      '--format=esm',
      `--outfile=${bundlePath}`,
    ],
    { cwd: root, stdio: 'pipe' },
  );

  const { RELEASE_NOTES, releaseNotesForMajor, compareVersions } = await import(pathToFileURL(bundlePath).href);
  // 5.1.4 stands alone like 5.1.3 before it: whoever installed 5.1.3 already read its
  // two entries. The scope order below is also the rendered order, because the modal
  // puts the largest scope cluster first and `ai` carries four of the eight.
  const currentRelease = RELEASE_NOTES[0];
  assert.equal(currentRelease?.version, '5.1.4');
  assert.equal(currentRelease?.date, '2026-09-02');
  assert.equal(currentRelease?.highlights.length, 8);
  assert.deepEqual(currentRelease?.highlights.map((highlight) => highlight.scope), [
    'ai', 'ai', 'ai', 'ai', 'academic', 'academic', 'library', 'zotero',
  ]);
  for (const phrase of [
    /written natively in all eight interface languages/,
    /no longer comes out in Spanish/,
    /separates the context window from the output budget/,
    /can no longer leave you with nothing/,
    /hypotheses and findings as fields of their own/,
    /nine calm steps along a single path/,
    /sortable columns/,
    /stops piling up memory/,
  ]) assert.ok(currentRelease?.highlights.some((highlight) => phrase.test(highlight.en)));

  // 5.1.3 keeps the focused two-item modal it shipped with. Apple notarization leads
  // it so the trust change stayed the first thing macOS users saw.
  const notarizationRelease = RELEASE_NOTES.find((note) => note.version === '5.1.3');
  assert.equal(notarizationRelease?.date, '2026-08-31');
  assert.equal(notarizationRelease?.highlights.length, 2);
  assert.deepEqual(notarizationRelease?.highlights.map((highlight) => highlight.scope), [
    'apple', 'academic',
  ]);
  for (const phrase of [
    /Developer ID signature and Apple notarization/,
    /Gatekeeper verifies its signature and ticket/,
    /only the permissions it needs/,
    /different works and authors/,
    /semantic and lexical search/,
    /does not cover enough sources or authors/,
  ]) assert.ok(notarizationRelease?.highlights.some((highlight) => phrase.test(highlight.en)));

  // 5.1.2 remains intact immediately below the new focused patch.
  const release512 = RELEASE_NOTES.find((note) => note.version === '5.1.2');
  assert.equal(release512?.date, '2026-08-31');
  assert.equal(release512?.highlights.length, 13);
  assert.deepEqual(release512?.highlights.map((highlight) => highlight.scope), [
    'ai', 'ai', 'zotero', 'server', 'library', 'databases', 'word', 'connector', 'zotero',
    'word', 'ai', 'zotero', 'general',
  ]);
  for (const phrase of [
    /more than twice as fast/,
    /LM Studio, Ollama, and Nodus/,
    /complete personal and group libraries/,
    /web interface now matches the desktop app/,
    /Documentary Index/,
    /same clear library, composer, queue, and reading flow/,
    /Word ribbon adds shortcuts/,
    /Nodus Research Connector/,
    /without starting or queuing analysis/,
    /entire library appear to have changed at once/,
    /replaces Synonyms with Alternatives/,
    /without failing above 512 tokens/,
    /saves and shows the reason/,
    /appear as clean text/,
    /at least eight characters/,
  ]) assert.ok(release512?.highlights.some((highlight) => phrase.test(highlight.en)));

  const previousPatchRelease = RELEASE_NOTES.find((note) => note.version === '5.1.1');
  assert.equal(previousPatchRelease?.date, '2026-08-31');
  assert.equal(previousPatchRelease?.highlights.length, 9);
  assert.deepEqual(release512?.highlights.slice(0, 9), previousPatchRelease?.highlights);

  const minorRelease = RELEASE_NOTES.find((note) => note.version === '5.1.0');
  assert.equal(minorRelease?.date, '2026-08-30');
  assert.equal(minorRelease?.highlights.length, 8);
  assert.deepEqual(previousPatchRelease?.highlights.slice(0, 8), minorRelease?.highlights);

  // 5.0.6 remains intact beneath the new hotfix and minor release.
  const previousStableRelease = RELEASE_NOTES.find((note) => note.version === '5.0.6');
  assert.equal(previousStableRelease?.date, '2026-08-28');
  assert.equal(previousStableRelease?.highlights.length, 7);

  // 5.0.5 keeps the single copilot-pane highlight it shipped with.
  const copilotRelease = RELEASE_NOTES.find((note) => note.version === '5.0.5');
  assert.equal(copilotRelease?.date, '2026-08-27');
  assert.equal(copilotRelease?.highlights.length, 1);
  assert.deepEqual(copilotRelease?.highlights.map((highlight) => highlight.scope), ['plugin']);
  assert.match(copilotRelease?.highlights[0]?.en ?? '', /Nodus Copilot for Word and LibreOffice/);

  // 5.0.4 keeps the seven highlights it shipped with underneath 5.0.6.
  const serverWebRelease = RELEASE_NOTES.find((note) => note.version === '5.0.4');
  assert.equal(serverWebRelease?.date, '2026-08-27');
  assert.equal(serverWebRelease?.highlights.length, 7);
  assert.deepEqual(serverWebRelease?.highlights.map((highlight) => highlight.scope), [
    'general', 'general', 'general', 'estudio', 'estudio', 'general', 'general',
  ]);
  for (const phrase of [
    /responsive web interface/,
    /own AI providers/,
    /enforces ownership and permissions/,
    /fourth tab/,
    /own result isolated/,
    /two most recent verified snapshots/,
    /download counter is current again/,
  ]) assert.ok(serverWebRelease?.highlights.some((highlight) => phrase.test(highlight.en)));

  // 5.0.3 keeps the eight highlights it shipped with underneath 5.0.5.
  const previousPatch = RELEASE_NOTES.find((note) => note.version === '5.0.3');
  assert.equal(previousPatch?.date, '2026-08-26');
  assert.equal(previousPatch?.highlights.length, 8);

  // 5.0.2 keeps the six highlights it shipped with underneath 5.0.4.
  const compassRelease = RELEASE_NOTES.find((note) => note.version === '5.0.2');
  assert.equal(compassRelease?.date, '2026-08-26');
  assert.equal(compassRelease?.highlights.length, 6);

  // 5.0.1 keeps the seven repair highlights it shipped with underneath 5.0.4.
  const previousMajorPatchRelease = RELEASE_NOTES.find((note) => note.version === '5.0.1');
  assert.equal(previousMajorPatchRelease?.date, '2026-08-25');
  assert.equal(previousMajorPatchRelease?.highlights.length, 7);

  // 5.0.0 keeps the eight highlights it shipped with underneath this repair release.
  const majorRelease = RELEASE_NOTES.find((note) => note.version === '5.0.0');
  assert.equal(majorRelease?.date, '2026-08-25');
  assert.equal(majorRelease?.highlights.length, 8);
  for (const phrase of [
    /gains a Dictionary/,
    /understands each document in layers/,
    /Deep Research v2/,
    /local file is once again the source of truth/,
    /control custom players and web audio/,
    /can no longer block startup/,
    /classic Nodus Server/,
    /public documentation now matches/,
  ]) assert.ok(majorRelease?.highlights.some((highlight) => phrase.test(highlight.en)));

  // 4.2.5 keeps the highlight it shipped with. It remains available in history.
  const updaterCleanupRelease = RELEASE_NOTES.find((note) => note.version === '4.2.5');
  assert.equal(updaterCleanupRelease?.date, '2026-08-23');
  assert.equal(updaterCleanupRelease?.highlights.length, 1);
  assert.match(updaterCleanupRelease?.highlights[0]?.en ?? '', /stops installing itself twice on macOS/);
  assert.match(updaterCleanupRelease?.highlights[0]?.en ?? '', /two Nodus icons in the Dock/);

  // 4.2.4 keeps the four highlights it shipped with. They are published history.
  const browserFixesRelease = RELEASE_NOTES.find((note) => note.version === '4.2.4');
  assert.equal(browserFixesRelease?.date, '2026-08-23');
  assert.equal(browserFixesRelease?.highlights.length, 4);
  assert.deepEqual(browserFixesRelease?.highlights.map((highlight) => highlight.scope), ['browser', 'browser', 'browser', 'browser']);
  for (const phrase of [
    /media button tells the truth again/,
    /no longer makes the website vanish/,
    /Cut, Copy and Paste in text fields, in that order/,
    /opens a new tab, including while you are reading a page/,
  ]) assert.ok(browserFixesRelease?.highlights.some((highlight) => phrase.test(highlight.en)));

  const mediaHighlight = browserFixesRelease?.highlights.find((highlight) =>
    /media button tells the truth again/.test(highlight.en));
  assert.match(mediaHighlight?.en ?? '', /spare player/);
  assert.match(mediaHighlight?.en ?? '', /the track you are actually listening to/);

  const addressBarHighlight = browserFixesRelease?.highlights.find((highlight) =>
    /Cut, Copy and Paste/.test(highlight.en));
  assert.match(addressBarHighlight?.en ?? '', /address bar/);

  // 4.2.3 keeps the five highlights it shipped with. They are published history.
  const deepResearchReadingRelease = RELEASE_NOTES.find((note) => note.version === '4.2.3');
  assert.equal(deepResearchReadingRelease?.date, '2026-08-22');
  assert.equal(deepResearchReadingRelease?.highlights.length, 5);
  assert.deepEqual(deepResearchReadingRelease?.highlights.map((highlight) => highlight.scope), ['academic', 'academic', 'academic', 'browser', 'general']);
  for (const phrase of [
    /full-screen reading view/,
    /checked against the corpus/,
    /Authors and editors are no longer confused/,
    /Google sign-in more clearly/,
    /integrated wiki/,
  ]) assert.ok(deepResearchReadingRelease?.highlights.some((highlight) => phrase.test(highlight.en)));

  const googleSignInHighlight = deepResearchReadingRelease?.highlights.find((highlight) =>
    /Google sign-in more clearly/.test(highlight.en));
  assert.match(googleSignInHighlight?.en ?? '', /system browser/);
  assert.match(googleSignInHighlight?.en ?? '', /restores the previous page/);

  // 4.2.2 keeps the four highlights it shipped with. They are published history.
  const browserSearchRelease = RELEASE_NOTES.find((note) => note.version === '4.2.2');
  assert.equal(browserSearchRelease?.date, '2026-08-21');
  assert.equal(browserSearchRelease?.highlights.length, 4);
  assert.ok(browserSearchRelease?.highlights.some((highlight) => /searches inside the page/.test(highlight.en)));

  // 4.1.6 keeps the five highlights it shipped with. They are published history.
  const zoteroImportRelease = RELEASE_NOTES.find((note) => note.version === '4.1.6');
  assert.equal(zoteroImportRelease?.date, '2026-08-18');
  assert.equal(zoteroImportRelease?.highlights.length, 5);
  assert.ok(zoteroImportRelease?.highlights.some((highlight) => /copies attachments again/.test(highlight.en)));
  assert.ok(zoteroImportRelease?.highlights.some((highlight) => /second Zotero sync no longer aborts/.test(highlight.en)));
  assert.ok(zoteroImportRelease?.highlights.some((highlight) => /galleries remember how you left them/.test(highlight.en)));
  assert.ok(zoteroImportRelease?.highlights.some((highlight) => /no longer goes through the gallery/.test(highlight.en)));
  assert.ok(zoteroImportRelease?.highlights.some((highlight) => /organisation view is now translated/.test(highlight.en)));

  // 4.1.5 keeps the four it shipped with. They are published history.
  const selectionRibbonRelease = RELEASE_NOTES.find((note) => note.version === '4.1.5');
  assert.equal(selectionRibbonRelease?.date, '2026-08-17');
  assert.equal(selectionRibbonRelease?.highlights.length, 4);
  assert.ok(selectionRibbonRelease?.highlights.some((highlight) => /where you released the pointer/.test(highlight.en)));
  assert.ok(selectionRibbonRelease?.highlights.some((highlight) => /reopens the whole ribbon/.test(highlight.en)));
  assert.ok(selectionRibbonRelease?.highlights.some((highlight) => /no longer freezes the window/.test(highlight.en)));
  assert.ok(selectionRibbonRelease?.highlights.some((highlight) => /MCP client no longer block the Nodus window/.test(highlight.en)));

  // 4.1.4 keeps the four it shipped with. They are published history.
  const newHomeRelease = RELEASE_NOTES.find((note) => note.version === '4.1.4');
  assert.equal(newHomeRelease?.date, '2026-08-16');
  assert.equal(newHomeRelease?.highlights.length, 4);
  assert.ok(newHomeRelease?.highlights.some((highlight) => /new home at nodusresearch\.com/.test(highlight.en)));
  assert.ok(newHomeRelease?.highlights.some((highlight) => /no longer block the app/.test(highlight.en)));
  assert.ok(newHomeRelease?.highlights.some((highlight) => /first administrator account/.test(highlight.en)));
  assert.ok(newHomeRelease?.highlights.some((highlight) => /notification centre now gives a clear answer/.test(highlight.en)));

  // 4.1.3 keeps the two it shipped with. They are published history.
  const readingPositionRelease = RELEASE_NOTES.find((note) => note.version === '4.1.3');
  assert.equal(readingPositionRelease?.date, '2026-08-15');
  assert.equal(readingPositionRelease?.highlights.length, 2);
  assert.ok(readingPositionRelease?.highlights.some((highlight) => /the immersion or the document you had open/.test(highlight.en)));
  assert.ok(readingPositionRelease?.highlights.some((highlight) => /instead of a pixel position/.test(highlight.en)));

  // 4.1.2 keeps the four it shipped with. They are published history.
  const dossierRelease = RELEASE_NOTES.find((note) => note.version === '4.1.2');
  assert.equal(dossierRelease?.date, '2026-08-15');
  assert.equal(dossierRelease?.highlights.length, 4);
  // The dossier fix a person notices first, and the deployment wizard catching up in their language.
  assert.ok(dossierRelease?.highlights.some((highlight) => /before their ideas/.test(highlight.en)));
  assert.ok(dossierRelease?.highlights.some((highlight) => /eight interface languages/.test(highlight.en)));

  // 4.1.1 keeps the six it shipped with. They are published history.
  const cloudflareRelease = RELEASE_NOTES.find((note) => note.version === '4.1.1');
  assert.equal(cloudflareRelease?.date, '2026-08-14');
  assert.equal(cloudflareRelease?.highlights.length, 6);
  // The two things a person can go and look at: a deployment they own, and a wiki they can read.
  assert.ok(cloudflareRelease?.highlights.some((highlight) => /Cloudflare account/.test(highlight.en)));
  assert.ok(cloudflareRelease?.highlights.some((highlight) => /complete wiki/.test(highlight.en)));

  // 4.1.0 keeps the nine it shipped with. They are published history.
  const libraryViewsRelease = RELEASE_NOTES.find((note) => note.version === '4.1.0');
  assert.equal(libraryViewsRelease?.date, '2026-08-13');
  assert.equal(libraryViewsRelease?.highlights.length, 9);
  assert.ok(libraryViewsRelease?.highlights.some((highlight) => /hierarchical collections/.test(highlight.en)));
  assert.ok(libraryViewsRelease?.highlights.some((highlight) => /Chrome Web Store/.test(highlight.en)));

  const connectorRelease = RELEASE_NOTES.find((note) => note.version === '4.0.1');
  assert.equal(connectorRelease?.date, '2026-08-12');
  assert.equal(connectorRelease?.highlights.length, 2);
  assert.ok(connectorRelease?.highlights.some((highlight) => /pairs automatically/.test(highlight.en)));

  const libraryRelease = RELEASE_NOTES.find((note) => note.version === '4.0.0');
  assert.equal(libraryRelease?.date, '2026-08-12');
  assert.equal(libraryRelease?.highlights.length, 8);

  const previousCurrentRelease = RELEASE_NOTES.find((note) => note.version === '3.2.7');
  assert.equal(previousCurrentRelease?.date, '2026-08-10');
  assert.equal(previousCurrentRelease?.highlights.length, 4);

  // 3.2.6 keeps the eight it shipped with, including its MCP and Nodi improvements.
  // They are published history and stay as they were written.
  const previousRelease = RELEASE_NOTES.find((note) => note.version === '3.2.6');
  assert.equal(previousRelease?.date, '2026-08-09');
  assert.equal(previousRelease?.highlights.length, 8);
  assert.ok(previousRelease?.highlights.some((highlight) => highlight.scope === 'mcp'));
  assert.ok(previousRelease?.highlights.filter((highlight) => highlight.scope === 'nodi').length >= 2);

  // 3.2.5 keeps the four it shipped with, including the two that describe the rule this
  // release reverses. They are published history and stay as they were written.
  const perModelReasoningRelease = RELEASE_NOTES.find((note) => note.version === '3.2.5');
  assert.equal(perModelReasoningRelease?.date, '2026-08-07');
  assert.equal(perModelReasoningRelease?.highlights.length, 4);

  // 3.2.4 keeps the ten it shipped with.
  const headerRelease = RELEASE_NOTES.find((note) => note.version === '3.2.4');
  assert.equal(headerRelease?.date, '2026-08-06');
  assert.equal(headerRelease?.highlights.length, 10);

  // 3.2.3 keeps its own four highlights underneath.
  const readMarkersRelease = RELEASE_NOTES.find((note) => note.version === '3.2.3');
  assert.equal(readMarkersRelease?.date, '2026-08-05');
  assert.equal(readMarkersRelease?.highlights.length, 4);
  for (const highlight of currentRelease.highlights) {
    // Written for the person using Nodus: no module names, no internal vocabulary.
    for (const language of ['es', 'en', 'fr', 'de', 'pt', 'pt-BR']) {
      assert.ok(highlight[language]?.length > 80, `a ${language} highlight is too short to explain anything`);
    }
  }

  // 3.0.4 keeps its own three highlights underneath: Deep Research queued over MCP, the
  // retry that ignored the engine, and the argument map that drew every hub as a star.
  const mcpQueueRelease = RELEASE_NOTES.find((note) => note.version === '3.0.4');
  assert.equal(mcpQueueRelease?.date, '2026-08-01');
  assert.equal(mcpQueueRelease?.highlights.length, 3);
  assert.equal(mcpQueueRelease?.highlights[0]?.scope, 'mcp');

  // 3.0.3 keeps its own three highlights underneath.
  const bulkExportRelease = RELEASE_NOTES.find((note) => note.version === '3.0.3');
  assert.equal(bulkExportRelease?.date, '2026-07-31');
  assert.equal(bulkExportRelease?.highlights.length, 3);

  // 3.0.2 shipped after the macOS update fix merged, so that highlight stays there.
  const deepResearchRelease = RELEASE_NOTES.find((note) => note.version === '3.0.2');
  assert.equal(deepResearchRelease?.date, '2026-07-31');
  assert.equal(deepResearchRelease?.highlights.length, 6);

  // 3.0.1 stays reachable from the version picker underneath it.
  const performanceRelease = RELEASE_NOTES.find((note) => note.version === '3.0.1');
  assert.equal(performanceRelease?.date, '2026-07-30');
  assert.equal(performanceRelease?.highlights.length, 3);

  // The vault introductions live in 3.0.0 and must keep their shape as newer
  // releases land on top of them — hence looked up by version, not as `[0]`.
  const vaultsRelease = RELEASE_NOTES.find((note) => note.version === '3.0.0');
  assert.equal(vaultsRelease?.date, '2026-07-30');
  // One highlight per new vault, not one per refinement inside it — see the note
  // above RELEASE_3_0_0_HIGHLIGHTS.
  assert.equal(vaultsRelease?.highlights.length, 16);
  const newVaults = ['prosopography', 'primary_sources', 'testimonios', 'worldbuilding'];
  for (const scope of newVaults) {
    assert.equal(
      vaultsRelease.highlights.filter((h) => h.scope === scope).length,
      1,
      `${scope} must introduce itself once, not once per refinement`,
    );
  }
  // And they lead, in the order shared/vaultTypes.ts declares them.
  assert.deepEqual(vaultsRelease.highlights.slice(0, 4).map((h) => h.scope), newVaults);
  // 2.8.0 was authored and never published; its highlights live inside 3.0.0 now, so
  // no entry may claim that version or the picker would offer a release nobody ran.
  assert.ok(!RELEASE_NOTES.some((note) => note.version === '2.8.0'));
  // it/tr fall back to en when their index-matched array is short, which would pass a
  // mere length check while silently shipping English to two locales.
  assert.ok(currentRelease?.highlights.every((h) => h.it !== h.en && h.tr !== h.en));

  // From 3.1.0 on, a highlight is short plain sentences: no semicolons, no em dashes.
  // Both were how these notes grew into paragraph-long subordinate clauses, and the
  // modal is read once, in a hurry. Older releases keep the prose they shipped with.
  const LANGUAGES = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
  for (const note of RELEASE_NOTES) {
    if (compareVersions(note.version, '3.1.0') < 0) continue;
    for (const [index, highlight] of note.highlights.entries()) {
      for (const language of LANGUAGES) {
        const text = highlight[language] ?? '';
        assert.ok(
          !text.includes(';'),
          `v${note.version} highlight ${index + 1} (${language}) uses a semicolon: split it into two sentences`,
        );
        assert.ok(
          !text.includes('—'),
          `v${note.version} highlight ${index + 1} (${language}) uses an em dash: split it into two sentences`,
        );
      }
    }
  }
  const whatsNew = fs.readFileSync(path.join(root, 'src/components/WhatsNewModal.tsx'), 'utf8');
  assert.match(whatsNew, /function ZoteroReleaseIcon/);
  assert.match(whatsNew, /M16 18H48L16 46H48/);
  assert.match(whatsNew, /scope === 'zotero'/);
  assert.match(whatsNew, /function AppleReleaseIcon/);
  assert.match(whatsNew, /M24\.132 18\.851/);
  assert.match(whatsNew, /scope === 'apple'/);
  const currentMajorNotes = releaseNotesForMajor('2.3.8');

  assert.equal(currentMajorNotes[0]?.version, '2.3.8');
  assert.equal(currentMajorNotes.at(-1)?.version, '2.0.0');
  assert.ok(currentMajorNotes.every((note) => note.version.startsWith('2.')));
  assert.ok(!currentMajorNotes.some((note) => note.version === '1.8.0'));
  assert.ok(!releaseNotesForMajor('2.3.7').some((note) => note.version === '2.3.8'));

  const validScopes = new Set([
    'general',
    'ai',
    'library',
    'server',
    'word',
    'zotero',
    'connector',
    'academic',
    'estudio',
    'primary_sources',
    'genealogy',
    'prosopography',
    'databases',
    'testimonios',
    'worldbuilding',
    'docencia',
    'mcp',
    'nodi',
    'toolkit',
    'plugin',
    'languages',
    'browser',
    'radar',
    'apple',
  ]);
  for (const note of RELEASE_NOTES) {
    for (const highlight of note.highlights) {
      assert.ok(validScopes.has(highlight.scope), `Missing or invalid scope in v${note.version}`);
      assert.ok(highlight.es.length > 0 && highlight.en.length > 0, `Missing translation in v${note.version}`);
    }
  }

  console.log('Release notes major-history and scope tests passed!');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
