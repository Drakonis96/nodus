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
  const currentRelease = RELEASE_NOTES[0];
  assert.equal(currentRelease?.version, '4.2.3');
  assert.equal(currentRelease?.date, '2026-08-22');
  assert.equal(currentRelease?.highlights.length, 5);
  assert.deepEqual(currentRelease?.highlights.map((highlight) => highlight.scope), ['academic', 'academic', 'academic', 'browser', 'general']);
  for (const phrase of [
    /full-screen reading view/,
    /checked against the corpus/,
    /Authors and editors are no longer confused/,
    /Google sign-in more clearly/,
    /integrated wiki/,
  ]) assert.ok(currentRelease?.highlights.some((highlight) => phrase.test(highlight.en)));

  const googleSignInHighlight = currentRelease?.highlights.find((highlight) =>
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
  assert.match(whatsNew, /scope === 'plugin'/);
  const currentMajorNotes = releaseNotesForMajor('2.3.8');

  assert.equal(currentMajorNotes[0]?.version, '2.3.8');
  assert.equal(currentMajorNotes.at(-1)?.version, '2.0.0');
  assert.ok(currentMajorNotes.every((note) => note.version.startsWith('2.')));
  assert.ok(!currentMajorNotes.some((note) => note.version === '1.8.0'));
  assert.ok(!releaseNotesForMajor('2.3.7').some((note) => note.version === '2.3.8'));

  const validScopes = new Set([
    'general',
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
