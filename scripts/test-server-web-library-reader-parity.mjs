import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const app = variants(fs.readFileSync(`${root}/src/serverWeb/App.tsx`, "utf8"));
const view = variants(fs.readFileSync(
  `${root}/src/serverWeb/LibraryServerView.tsx`,
  "utf8",
));
const docs = fs.readFileSync(
  `${root}/docs/server-web-academic-parity.md`,
  "utf8",
);

test("App routes the published library and reloadable reader through the dedicated parity surface", () => {
  assert.match(app, /LibraryDetail as ServerLibraryDetail/);
  assert.match(app, /PublishedLibraryView as ServerPublishedLibraryView/);
  assert.match(app, /<ServerLibraryDetail[^>]+csrfToken=\{me\.csrfToken\}/);
  assert.match(app, /<ServerPublishedLibraryView/);
});

test("library catalogue preserves Desktop table affordances and tab-safe opening", () => {
  for (const marker of [
    "library-search",
    "library-collection-filter",
    "library-refresh",
    "library-document-row",
    "Página anterior",
    "Página siguiente",
  ]) {
    assert.match(view, new RegExp(marker));
  }
  assert.match(view, /target="_blank"/);
  assert.match(view, /api\.libraryCollections/);
  assert.match(view, /api\.library\(spaceId/);
});

test("reader preserves safe published reading and private overlay capabilities", () => {
  for (const marker of [
    "library-reader-outline-toggle",
    "library-reader-source-picker",
    "library-reader-document",
    "library-reader-original",
    "library-reader-download",
    "library-reader-metadata",
    "library-reader-chat",
    "library-reader-add-note",
    "library-reader-bookmark",
    "library-reader-read-state",
  ]) {
    assert.match(view, new RegExp(marker));
  }
  assert.match(view, /api\.libraryContent/);
  assert.match(view, /api\.libraryOriginalUrl/);
  assert.match(view, /api\.addAnnotation/);
  assert.match(view, /api\.runAI[\s\S]{0,160}"content-query"/);
  assert.doesNotMatch(view, /window\.nodus/);
});

test("reader persists read state in the account-scoped annotation overlay and selects an available source", () => {
  assert.match(view, /title: "Estado de lectura"/);
  assert.match(view, /id: `reading-state-\$\{id\}`/);
  assert.match(view, /content: next \? "read" : "unread"/);
  assert.match(view, /if \(state\) setIsRead\(state\.content === ["']read["']\)/);
  assert.match(view, /const preferred =\s*preference === ["']original["'] && hasOriginal[\s\S]{0,260}: hasOriginal\s*\? ["']original["']\s*: ["']clean["']/);
  assert.match(view, /note\.kind === "note" && note\.title === "Estado de lectura"/);
  assert.match(view, /bookmarkFill/);
});

test("reader opens a published original first while keeping Markdown as an explicit option", () => {
  assert.match(view, /: hasOriginal\s*\n\s*\? "original"\s*\n\s*: "clean"/);
  assert.match(view, /data-testid="library-reader-original-frame"/);
  assert.match(view, /setOpeningFormatPrompt\(false\)/);
});

test("parity matrix records the safe Server boundary", () => {
  assert.match(docs, /LibraryServerView\.tsx/);
  assert.match(docs, /OCR/);
  assert.match(docs, /pipeline Zotero/);
});
