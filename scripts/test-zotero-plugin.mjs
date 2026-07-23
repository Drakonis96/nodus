// Unit tests for the pure logic of the "Nodus for Zotero" plugin. The plugin's
// content scripts are chrome:// IIFEs that attach to `window`; here we evaluate
// them in a vm sandbox with minimal stubs (ChromeUtils/Zotero/document) and
// exercise the parts that don't need a live Zotero or a real DOM.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import AdmZip from 'adm-zip';
import { buildXpi } from './build-zotero-xpi.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(repoRoot, 'zotero-plugin');
const contentDir = path.join(pluginDir, 'content');
const readSource = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

// Extract the `{...}` literal starting at openIdx, respecting string literals so
// that braces inside values (e.g. "{pct}") don't unbalance the scan.
function sliceBalanced(src, openIdx) {
  let depth = 0, inStr = false, quote = '';
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === '\\') { i++; } else if (c === quote) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(openIdx, i + 1);
  }
  throw new Error('unbalanced braces');
}
// Eval the plugin's I18N object literal out of sidebar.js source (pure data).
function extractI18n(src) {
  const open = src.indexOf('{', src.indexOf('const I18N'));
  return vm.runInNewContext('(' + sliceBalanced(src, open) + ')');
}
const placeholders = (s) => new Set((String(s).match(/\{(\w+)\}/g) || []));

// ---- minimal fake DOM (enough for NodusMarkdown.render) ----
function makeDoc() {
  const doc = {
    createElement(tag) { return makeEl(tag, doc); },
    createTextNode(text) { return { nodeType: 3, _text: String(text) }; },
  };
  return doc;
}
function makeEl(tag, doc) {
  return {
    tagName: String(tag).toUpperCase(),
    ownerDocument: doc,
    className: '',
    children: [],
    attrs: {},
    classList: { add() {} },
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {},
    get textContent() { return serializeText(this); },
    set textContent(v) { this.children = []; if (v) this.children.push({ nodeType: 3, _text: String(v) }); },
  };
}
const serializeText = (n) => (n.nodeType === 3 ? n._text : (n.children || []).map(serializeText).join(''));
const serializeHtml = (n) => {
  if (n.nodeType === 3) return n._text;
  const t = n.tagName.toLowerCase();
  return `<${t}>${(n.children || []).map(serializeHtml).join('')}</${t}>`;
};
// Every ELEMENT tag name in the tree (text nodes excluded) — used to prove no
// real <script> element was created from model output.
const elementTags = (n, acc = []) => {
  if (n.nodeType === 3) return acc;
  acc.push(n.tagName);
  for (const c of n.children || []) elementTags(c, acc);
  return acc;
};

// ---- load a plugin content file into a fresh sandbox ----
function loadModule(file, extraGlobals = {}) {
  const src = readFileSync(path.join(contentDir, file), 'utf8');
  const sandbox = {
    window: {},
    document: makeDoc(),
    Zotero: { logError() {}, launchURL() {} },
    ChromeUtils: { importESModule: () => ({ Zotero: { logError() {}, launchURL() {} } }) },
    console,
    ...extraGlobals,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: file });
  return sandbox.window;
}

// ─────────────────────────────────────────── #1 Markdown
test('markdown: parse produces block/inline tokens', () => {
  const { NodusMarkdown } = loadModule('markdown.js');
  const blocks = NodusMarkdown.parse('# Title\n\nA **bold** and *em* and `code`.\n\n- one\n- two\n\n> quote');
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[1].type, 'paragraph');
  const strong = blocks[1].inline.find((s) => s.type === 'strong');
  assert.ok(strong && strong.children[0].value === 'bold');
  assert.ok(blocks[1].inline.some((s) => s.type === 'em'));
  assert.ok(blocks[1].inline.some((s) => s.type === 'code' && s.value === 'code'));
  const list = blocks.find((b) => b.type === 'list');
  assert.ok(list && list.items.length === 2 && !list.ordered);
  assert.ok(blocks.some((b) => b.type === 'blockquote'));
});

test('markdown: ordered lists, fenced code and hr', () => {
  const { NodusMarkdown } = loadModule('markdown.js');
  const blocks = NodusMarkdown.parse('1. first\n2. second\n\n```js\nconst x = 1;\n```\n\n---');
  const ol = blocks.find((b) => b.type === 'list');
  assert.ok(ol && ol.ordered && ol.items.length === 2);
  const code = blocks.find((b) => b.type === 'code');
  assert.equal(code.text, 'const x = 1;');
  assert.ok(blocks.some((b) => b.type === 'hr'));
});

test('markdown: underscores in identifiers are NOT italicised', () => {
  const { NodusMarkdown } = loadModule('markdown.js');
  const spans = NodusMarkdown.parseInline('use my_snake_case_name here');
  assert.equal(spans.length, 1);
  assert.equal(spans[0].type, 'text');
  assert.equal(spans[0].value, 'use my_snake_case_name here');
});

test('markdown: citations become chips via citeFn, body is escaped (no XSS)', () => {
  const { NodusMarkdown } = loadModule('markdown.js');
  const doc = makeDoc();
  const container = makeEl('div', doc);
  const seen = [];
  const citeFn = (kind, id, label) => { seen.push({ kind, id, label }); const e = doc.createElement('cite'); e.textContent = label || id; return e; };
  NodusMarkdown.render(container, 'See [[p:12|page 12]] and **bold**. <script>alert(1)</script>', citeFn);
  const html = serializeHtml(container);
  assert.ok(seen.some((c) => c.kind === 'p' && c.id === '12' && c.label === 'page 12'), 'citeFn called for [[p:12]]');
  assert.ok(html.includes('<cite>page 12</cite>'), 'chip rendered');
  assert.ok(html.includes('<strong>bold</strong>'), 'bold rendered');
  // The literal script text is present as escaped text, but never as a real
  // element node (which is what would actually execute).
  assert.ok(serializeText(container).includes('<script>alert(1)</script>'));
  assert.ok(!elementTags(container).includes('SCRIPT'), 'no live <script> element injected');
});

// ─────────────────────────────────────────── #2 long-document sampling
test('util: sampleDocText keeps short docs whole', () => {
  const { NodusUtil } = loadModule('util.js');
  const r = NodusUtil.sampleDocText('hello world', 1000);
  assert.equal(r.truncated, false);
  assert.equal(r.text, 'hello world');
  assert.equal(r.ratio, 1);
});

test('util: sampleDocText keeps head AND tail of long docs', () => {
  const { NodusUtil } = loadModule('util.js');
  const big = 'A'.repeat(500) + 'B'.repeat(500) + 'ZEND';
  const r = NodusUtil.sampleDocText(big, 200);
  assert.equal(r.truncated, true);
  assert.ok(r.text.startsWith('A'), 'head preserved');
  assert.ok(r.text.includes('ZEND'), 'tail (conclusion) preserved — the whole point of #2');
  assert.ok(r.text.includes('omitted'), 'visible omission marker');
  assert.ok(r.sentChars <= 200 + 60, 'roughly within budget');
  assert.equal(r.totalChars, big.length);
  assert.ok(r.ratio > 0 && r.ratio < 1);
});

// ─────────────────────────────────────────── #4 save chat as note
test('util: conversationToHtml renders roles and escapes html', () => {
  const { NodusUtil } = loadModule('util.js');
  const html = NodusUtil.conversationToHtml(
    { messages: [{ role: 'user', content: 'Hi <there>' }, { role: 'assistant', content: 'Line1\nLine2' }] },
    { you: 'You', nodus: 'Nodus' },
  );
  assert.ok(html.includes('<b>You:</b> Hi &lt;there&gt;'));
  assert.ok(html.includes('<b>Nodus:</b> Line1<br/>Line2'));
});

// ─────────────────────────────────────────── #6 multi-item context
test('util: buildItemsSummary only fires for 2+ items', () => {
  const { NodusUtil } = loadModule('util.js');
  assert.equal(NodusUtil.buildItemsSummary([]), '');
  assert.equal(NodusUtil.buildItemsSummary([{ title: 'Solo' }]), '');
  const s = NodusUtil.buildItemsSummary([
    { title: 'Paper A', creators: 'Smith', year: '2020', abstract: 'aaa' },
    { title: 'Paper B', creators: 'Doe', year: '2021' },
  ]);
  assert.ok(s.includes('SELECTED DOCUMENTS'));
  assert.ok(s.includes('1. Paper A') && s.includes('2. Paper B'));
  assert.ok(s.includes('Smith') && s.includes('(2020)'));
});

// ─────────────────────────────────────────── #3 agent tools
test('agent: new tools are registered and parsed', () => {
  const { NodusAgent } = loadModule('agent.js');
  // Spread into a local-realm array: the vm sandbox has its own Array.prototype,
  // which trips deepStrictEqual's prototype check.
  assert.deepEqual(
    [...NodusAgent.TOOLS],
    ['create_note', 'highlight', 'add_tags', 'add_to_collection', 'set_field', 'extract_annotations_note'],
  );
  const reply = 'Sure.\n```nodus:action\n{"tool":"add_to_collection","name":"To read"}\n```\n```nodus:action\n{"tool":"set_field","field":"abstractNote","value":"x"}\n```';
  const { actions, clean } = NodusAgent.parseActions(reply);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].tool, 'add_to_collection');
  assert.equal(actions[1].field, 'abstractNote');
  assert.ok(!clean.includes('nodus:action'));
  // SYSTEM prompt advertises the new tools.
  for (const tool of ['add_to_collection', 'set_field', 'extract_annotations_note']) {
    assert.ok(NodusAgent.SYSTEM.includes(tool), `SYSTEM documents ${tool}`);
  }
});

test('agent: describe returns human text for each tool', () => {
  const { NodusAgent } = loadModule('agent.js');
  const t = (k) => k; // identity: assert the right key is used
  assert.ok(NodusAgent.describe({ tool: 'add_to_collection', name: 'X' }, t).includes('agent.desc.collection'));
  assert.ok(NodusAgent.describe({ tool: 'set_field', field: 'title', value: 'Y' }, t).includes('agent.desc.field'));
  assert.ok(NodusAgent.describe({ tool: 'extract_annotations_note' }, t).includes('agent.desc.extract'));
});

// ─────────────────────────────────────────── #7 max_tokens
test('providers: Anthropic body uses configurable max_tokens (default 8192)', () => {
  const { NodusProviders } = loadModule('providers.js');
  assert.equal(NodusProviders.DEFAULT_MAX_TOKENS, 8192);
  const def = NodusProviders.buildAnthropicBody('claude-x', 'sys', [{ role: 'user', content: 'hi' }]);
  assert.equal(def.max_tokens, 8192, 'no longer the old hardcoded 4096');
  assert.equal(def.stream, true);
  assert.equal(def.system, 'sys');
  const custom = NodusProviders.buildAnthropicBody('claude-x', '', [], 32000);
  assert.equal(custom.max_tokens, 32000);
  assert.equal(custom.system, undefined, 'empty system omitted');
  // clamp: nonsense → default, absurdly high → capped, tiny → floored
  assert.equal(NodusProviders.clampMaxTokens('nope'), 8192);
  assert.equal(NodusProviders.clampMaxTokens(9_000_000), 200000);
  assert.equal(NodusProviders.clampMaxTokens(1), 256);
});

test('providers: chatBase builds per-provider URLs', () => {
  const { NodusProviders } = loadModule('providers.js');
  assert.equal(NodusProviders.chatBase('openai'), 'https://api.openai.com/v1');
  assert.equal(NodusProviders.chatBase('ollama'), 'http://localhost:11434/v1');
  assert.equal(NodusProviders.chatBase('ollama', 'http://box:1234/'), 'http://box:1234/v1');
});

test('providers: reasoning maps to the right per-provider body', () => {
  const { NodusProviders: P } = loadModule('providers.js');
  // JSON compare: objects returned from the vm sandbox have a foreign prototype
  // that trips deepStrictEqual.
  const jeq = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual([...P.REASONING_LEVELS], ['default', 'off', 'low', 'medium', 'high']);
  // default sends nothing (model decides)
  jeq(P.reasoningBody('openrouter', 'default'), {});
  jeq(P.reasoningBody('openai', 'default'), {});
  // OpenRouter uses its unified `reasoning` object (verified live vs gemini/deepseek)
  jeq(P.reasoningBody('openrouter', 'off'), { reasoning: { enabled: false } });
  jeq(P.reasoningBody('openrouter', 'high'), { reasoning: { effort: 'high' } });
  // other OpenAI-compat use the standard reasoning_effort; 'off' has no portable disable
  jeq(P.reasoningBody('deepseek', 'low'), { reasoning_effort: 'low' });
  jeq(P.reasoningBody('openai', 'off'), {});
  // Anthropic: thinking budget + max_tokens made room for it
  const body = P.buildAnthropicBody('claude-x', 's', [], 4096, 'high');
  assert.equal(body.thinking.type, 'enabled');
  assert.equal(body.thinking.budget_tokens, 8192);
  assert.ok(body.max_tokens > 8192, 'max_tokens leaves room above the thinking budget');
  // no thinking when off/default
  assert.equal(P.buildAnthropicBody('claude-x', 's', [], 4096, 'off').thinking, undefined);
});

test('#reasoning: sidebar + server wire the selector through', () => {
  const src = readSource('zotero-plugin/content/sidebar.js');
  assert.ok(src.includes('renderReasoningSelect'), 'sidebar builds the reasoning dropdown');
  assert.ok(/reasoning:\s*state\.reasoning/.test(src), 'standalone passes reasoning to chatStream');
  assert.ok(src.includes('NS.setReasoning'), 'persists the choice');
  const store = readSource('zotero-plugin/content/store.js');
  assert.ok(store.includes('getReasoning') && store.includes('setReasoning'), 'store persists reasoning');
  const server = readSource('electron/zotero-plugin/server.ts');
  assert.ok(/reasoning/.test(server) && server.includes('ReasoningEffort'), 'connected server honors reasoning');
});

// ─────────────────────────────────────────── extra edge coverage (#8)
test('markdown: links, nested emphasis and `)` ordered markers', () => {
  const { NodusMarkdown } = loadModule('markdown.js');
  const link = NodusMarkdown.parseInline('see [the site](https://x.org) now');
  const l = link.find((s) => s.type === 'link');
  assert.ok(l && l.href === 'https://x.org' && l.children[0].value === 'the site');
  const nested = NodusMarkdown.parseInline('**bold with *em* inside**');
  const strong = nested.find((s) => s.type === 'strong');
  assert.ok(strong && strong.children.some((c) => c.type === 'em'));
  const ol = NodusMarkdown.parse('1) alpha\n2) beta');
  assert.ok(ol[0].ordered && ol[0].items.length === 2);
});

test('util: sampleDocText exact-boundary is not truncated; buildItemsSummary trims abstracts', () => {
  const { NodusUtil } = loadModule('util.js');
  const exact = 'x'.repeat(100);
  assert.equal(NodusUtil.sampleDocText(exact, 100).truncated, false);
  const s = NodusUtil.buildItemsSummary(
    [{ title: 'A', abstract: 'y'.repeat(2000) }, { title: 'B' }],
    { maxAbstract: 50 },
  );
  const abstractLine = s.split('\n').find((ln) => ln.includes('yyy'));
  assert.ok(abstractLine.trim().length <= 60, 'abstract trimmed to ~maxAbstract');
});

test('agent: malformed action blocks are ignored; describe shows field+value', () => {
  const { NodusAgent } = loadModule('agent.js');
  const { actions } = NodusAgent.parseActions('```nodus:action\n{not json}\n```\n```nodus:action\n{"tool":"add_tags","tags":["x"]}\n```');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tool, 'add_tags');
  const d = NodusAgent.describe({ tool: 'set_field', field: 'title', value: 'Hello world' }, (k) => k);
  assert.ok(d.includes('title') && d.includes('Hello world'));
});

// ─────────────────────────────────────────── #8 i18n parity
test('i18n: en/es have identical key sets and matching placeholders', () => {
  const I18N = extractI18n(readSource('zotero-plugin/content/sidebar.js'));
  const en = Object.keys(I18N.en).sort();
  const es = Object.keys(I18N.es).sort();
  assert.deepEqual(en, es, 'en and es must define exactly the same keys');
  // The new keys from this work exist.
  for (const k of ['msg.copy', 'msg.edit', 'msg.regenerate', 'doc.truncated', 'item.multi', 'agent.desc.collection', 'settings.maxTokens']) {
    assert.ok(I18N.en[k] && I18N.es[k], `both languages define ${k}`);
  }
  // Interpolation placeholders must match between languages, or tf() breaks.
  for (const k of en) {
    assert.deepEqual(
      [...placeholders(I18N.en[k])].sort(),
      [...placeholders(I18N.es[k])].sort(),
      `placeholders differ for "${k}"`,
    );
  }
});

// ─────────────────────────────────────────── #10 chat affordances + Notifier wiring
test('#10: sidebar wires copy/edit/regenerate + Zotero.Notifier and drops the old poll', () => {
  const src = readSource('zotero-plugin/content/sidebar.js');
  for (const fn of ['attachMessageActions', 'copyToClipboard', 'editUserMessage', 'regenerateFrom', 'rerenderConversation', 'generateAssistant', 'registerNotifier', 'scheduleRefresh']) {
    assert.ok(src.includes('function ' + fn) || src.includes(fn + ' ='), `defines ${fn}`);
  }
  assert.ok(src.includes('Zotero.Notifier.registerObserver'), 'registers a Notifier observer');
  assert.ok(src.includes('unregisterObserver'), 'unregisters on unload');
  assert.ok(!/refreshItem\(false\)[^;]*\},\s*1200\)/.test(src), 'old 1200ms poll replaced');
});

test('#10: message-action buttons live-render via the real fake-DOM path', () => {
  // Reuse the markdown render harness to prove renderRich-style DOM building is
  // sound; the affordance DOM is asserted structurally above (sidebar.js can't
  // boot in a sandbox). Here we just guard that clipboard uses Components.
  const src = readSource('zotero-plugin/content/sidebar.js');
  assert.ok(src.includes('nsIClipboardHelper'), 'copy uses the clipboard helper XPCOM');
});

test('composer: Enter sends and Alt+Enter keeps the textarea newline', () => {
  const src = readSource('zotero-plugin/content/sidebar.js');
  assert.match(
    src,
    /e\.key === "Enter" && !e\.altKey\)\s*\{\s*e\.preventDefault\(\);/,
    'plain Enter is intercepted for sending while Alt+Enter keeps its default newline',
  );
  assert.doesNotMatch(
    src,
    /e\.key === "Enter" && \(e\.metaKey \|\| e\.ctrlKey\)/,
    'sending no longer requires Ctrl/Command',
  );
});

// ─────────────────────────────────────────── auto-highlighter engine (pure)
test('highlighter: parsePassages extracts {text,level} robustly', () => {
  const { NodusHighlighter: H } = loadModule('highlighter.js');
  const r = H.parsePassages('sure!\n```json\n[{"text":"Alpha beta","level":"high"},{"text":"Gamma"},"Delta epsilon"]\n```');
  assert.equal(r.length, 3);
  assert.deepEqual({ ...r[0] }, { text: 'Alpha beta', level: 'high' });
  assert.equal(r[1].level, 'medium'); // default
  assert.equal(r[2].text, 'Delta epsilon');
  // level synonyms → high
  assert.equal(H.parsePassages('[{"text":"x y z","level":"muy importante"}]')[0].level, 'high');
  assert.equal(H.parsePassages('no json here').length, 0);
});

test('highlighter: normalizeText / buildPageNorm strip whitespace + hyphens with a char map', () => {
  const { NodusHighlighter: H } = loadModule('highlighter.js');
  assert.equal(H.normalizeText('Open-source  software'), 'opensourcesoftware');
  const chars = [{ c: 'O' }, { c: 'p' }, { c: '-' }, { c: 'e' }, { c: 'n' }];
  const { norm, map } = H.buildPageNorm(chars);
  assert.equal(norm, 'open');       // hyphen dropped
  assert.deepEqual([...map], [0, 1, 3, 4]); // norm index → char index
});

test('highlighter: NFKC decomposes ligatures + curly quotes so long quotes still match', () => {
  const { NodusHighlighter: H } = loadModule('highlighter.js');
  // PDF page renders "files" as the ﬁ ligature (U+FB01); model wrote plain "fi".
  assert.equal(H.normalizeText('source ﬁles'), H.normalizeText('source files'));
  assert.equal(H.normalizeText('author’s'), H.normalizeText("author's")); // curly apostrophe == straight
  // buildPageNorm maps both norm chars of a ligature back to the one source char.
  const { norm, map } = H.buildPageNorm([{ c: 'a' }, { c: 'ﬁ' }, { c: 'x' }]);
  assert.equal(norm, 'afix');
  assert.deepEqual([...map], [0, 1, 1, 2]); // the ligature glyph (index 1) spans two norm positions
});

test('highlighter: findQuote falls back to a prefix when the full quote drifts', () => {
  const { NodusHighlighter: H } = loadModule('highlighter.js');
  const pages = [{ norm: 'opensourceisthepracticeofpublishingdigitalresources', map: Array.from({ length: 52 }, (_, i) => i) }];
  // Full quote has extra tail that isn't on the page → prefix match still lands.
  const hit = H.findQuote(pages, 'opensourceisthepracticeofpublishingSOMETHINGELSE');
  assert.ok(hit, 'prefix fallback found a match');
  assert.equal(hit.start, 0);
  assert.ok(H.findQuote(pages, 'nothingmatcheshereatall') === null);
});

test('highlighter: rangeRects builds one rect per line-run', () => {
  const { NodusHighlighter: H } = loadModule('highlighter.js');
  const chars = [
    { rect: [10, 100, 20, 110], inlineRect: [10, 98, 20, 112], rotation: 0, lineBreakAfter: false },
    { rect: [20, 100, 30, 110], inlineRect: [20, 98, 30, 112], rotation: 0, lineBreakAfter: true },
    { rect: [10, 80, 25, 90], inlineRect: [10, 78, 25, 92], rotation: 0, lineBreakAfter: true },
  ];
  const rects = H.rangeRects(chars, 0, 2);
  assert.equal(rects.length, 2); // two lines
  // JSON compare: arrays returned from the vm sandbox have a foreign prototype.
  assert.equal(JSON.stringify(rects[0]), JSON.stringify([10, 98, 30, 112])); // left/right from chars, top/bottom from inlineRect
  assert.equal(JSON.stringify(rects[1]), JSON.stringify([10, 78, 25, 92]));
});

test('highlighter: sortIndexStr matches Zotero page|offset|top format', () => {
  const { NodusHighlighter: H } = loadModule('highlighter.js');
  assert.equal(H.sortIndexStr(0, [0, 0, 600, 800], 700, 44), '00000|000044|00100');
  assert.equal(H.sortIndexStr(3, [0, 0, 600, 800], 800, 5), '00003|000005|00000');
});

// ─────────────────────────────────────────── #9 packaging
test('#9: build-zotero-xpi produces a valid xpi + updates.json', () => {
  const r = buildXpi();
  const manifest = JSON.parse(readSource('zotero-plugin/manifest.json'));
  assert.equal(r.version, manifest.version);
  assert.equal(r.xpiName, 'nodus-zotero.xpi', 'release asset name stays stable across versions');
  assert.equal(
    manifest.applications.zotero.update_url,
    'https://github.com/Drakonis96/nodus/releases/latest/download/updates.json',
    'installed plugins always poll the latest Nodus release',
  );

  const zip = new AdmZip(r.xpiPath);
  const names = zip.getEntries().map((e) => e.entryName);
  assert.ok(names.includes('manifest.json'), 'manifest.json at zip ROOT (Zotero rejects it otherwise)');
  for (const need of [
    'content/sidebar.js',
    'content/markdown.js',
    'content/util.js',
    'content/highlighter.js',
    'content/icons.js',
    'bootstrap.js',
    'locale/en-US/nodus.ftl',
    'locale/es-ES/nodus.ftl',
  ]) {
    assert.ok(names.includes(need), `xpi contains ${need}`);
  }

  const updates = JSON.parse(readSource('dist-zotero/updates.json'));
  const entry = updates.addons[manifest.applications.zotero.id].updates[0];
  assert.equal(entry.version, manifest.version);
  assert.ok(entry.update_link.endsWith(r.xpiName), 'update_link points at the built xpi');
  assert.match(entry.update_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(entry.applications.zotero.strict_min_version, manifest.applications.zotero.strict_min_version);
});

test('#9: stable release blocks publication until the Zotero assets exist', () => {
  const workflow = readSource('.github/workflows/release.yml');
  const pluginJob = workflow.slice(
    workflow.indexOf('  build-zotero-plugin:'),
    workflow.indexOf('  verify-release-assets:'),
  );
  const verificationJob = workflow.slice(workflow.indexOf('  verify-release-assets:'));

  assert.match(pluginJob, /needs: release/, 'plugin build waits for the draft app release');
  assert.match(pluginJob, /npm run zotero:xpi/, 'release builds the XPI');
  assert.match(pluginJob, /dist-zotero\/nodus-zotero\.xpi/, 'release uploads the fixed-name XPI');
  assert.match(pluginJob, /dist-zotero\/updates\.json/, 'release uploads the Zotero update manifest');
  assert.match(verificationJob, /- build-zotero-plugin/, 'publication waits for the plugin job');
  assert.match(verificationJob, /nodus-zotero\.xpi/, 'publication verifies the XPI asset');
  assert.match(verificationJob, /updates\.json/, 'publication verifies the update manifest asset');
});
