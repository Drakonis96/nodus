import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-copilot-addin-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-copilot-addin.mjs'), '--electron-copilot-addin-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-copilot-addin-test-'));
installRuntimeHooks(root);

try {
  const { updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  updateSettings({ uiLanguage: 'en' });
  const installModule = require(path.join(repoRoot, 'electron/copilot/install.ts'));
  const { renderManifest, installCopilotAddin } = installModule;
  const template = fs.readFileSync(path.join(repoRoot, 'word-addin/manifest.xml'), 'utf8');
  const rendered = renderManifest(template, 4455, '0.7.20-beta.1');

  assert.match(rendered, /<Version>0\.7\.20\.1<\/Version>/);
  assert.match(rendered, /https:\/\/localhost:4455\/addin\/taskpane\.html/);
  assert.match(rendered, /<CustomTab id="Nodus\.Tab">/);
  assert.match(rendered, /<Label resid="Nodus\.Tab\.Label" \/>/);
  assert.doesNotMatch(rendered, /<OfficeTab id="TabHome">/);
  for (const control of ['Nodus.CitationButton', 'Nodus.BibliographyButton', 'Nodus.RefreshButton', 'Nodus.PreferencesButton', 'Nodus.UnlinkButton']) {
    assert.match(rendered, new RegExp(`<Control xsi:type="Button" id="${control}">`), `${control} must stay on the persistent Nodus tab`);
  }
  const actionIcons = {
    Taskpane: 'Copilot', Citation: 'Citation', Bibliography: 'Bibliography',
    Refresh: 'Refresh', Preferences: 'Preferences', Unlink: 'Unlink',
  };
  for (const [control, icon] of Object.entries(actionIcons)) {
    assert.match(
      rendered,
      new RegExp(`id="Nodus\\.${control}Button"[\\s\\S]*?<Icon>[\\s\\S]*?resid="Icon\\.${icon}\\.16"[\\s\\S]*?resid="Icon\\.${icon}\\.32"[\\s\\S]*?resid="Icon\\.${icon}\\.80"[\\s\\S]*?<\\/Icon>`),
      `${control} must use its own action icon`,
    );
    for (const size of [16, 32, 80]) {
      const iconPath = path.join(repoRoot, `word-addin/assets/icon-${icon.toLowerCase()}-${size}.png`);
      assert.equal(fs.existsSync(iconPath), true, `${icon} ${size}px icon must exist`);
      const png = fs.readFileSync(iconPath);
      assert.equal(png.readUInt32BE(16), size, `${icon} icon width must be ${size}px`);
      assert.equal(png.readUInt32BE(20), size, `${icon} icon height must be ${size}px`);
    }
  }
  assert.match(rendered, /taskpane\.html#references-citation/);
  assert.match(rendered, /taskpane\.html#references-bibliography/);
  assert.match(rendered, /taskpane\.html#references-unlink/);
  assert.match(rendered, /<DefaultLocale>en-US<\/DefaultLocale>/);
  assert.match(rendered, /DefaultValue="Open the pane to see how your text relates to your library\."/);
  assert.match(rendered, /<bt:Override Locale="es-ES" Value="Abre el panel/);

  // English is also the safe pre-initialization language in the task pane. The
  // runtime switches it to Spanish when Nodus injects lang=es, but an English
  // pane must never fall back to a Spanish string when a key is missing.
  const taskpaneHtml = fs.readFileSync(path.join(repoRoot, 'word-addin/taskpane.html'), 'utf8');
  const taskpaneJs = fs.readFileSync(path.join(repoRoot, 'word-addin/taskpane.js'), 'utf8');
  const referencesJs = fs.readFileSync(path.join(repoRoot, 'word-addin/references.js'), 'utf8');
  const chatJs = fs.readFileSync(path.join(repoRoot, 'word-addin/chat.js'), 'utf8');
  const taskpaneCss = fs.readFileSync(path.join(repoRoot, 'word-addin/taskpane.css'), 'utf8');
  assert.match(taskpaneHtml, /<html lang="en">/);
  assert.match(taskpaneHtml, />Analyze paragraph</);
  assert.doesNotMatch(taskpaneHtml, /Conectando|Buscar ideas|Analizar párrafo|Selección|Insertar en|Nota al pie|Pasajes/);
  assert.match(taskpaneJs, /table\[key\] !== undefined \? table\[key\] : STR\.en\[key\]/);
  // The pane wears the desktop app's own mark, inlined: its geometry is checked
  // against src/assets/nodus-logo.svg so the two can never drift into two logos.
  const desktopLogo = fs.readFileSync(path.join(repoRoot, 'src/assets/nodus-logo.svg'), 'utf8');
  const markPath = (desktopLogo.match(/<path d="([^"]+)"/) || [])[1];
  assert.equal(typeof markPath, 'string', 'the desktop logo must declare its mark path');
  assert.match(taskpaneHtml, /<svg class="mark"/, 'the pane must use the stylized Nodus mark');
  assert.ok(taskpaneHtml.includes(`d="${markPath}"`), 'the pane mark must be the desktop mark, stroke for stroke');
  for (const node of desktopLogo.match(/<circle[^>]*\/>/g) || []) {
    assert.ok(taskpaneHtml.includes(node.trim()), `the pane mark is missing a node of the desktop logo: ${node.trim()}`);
  }
  assert.doesNotMatch(taskpaneHtml, /<div class="mark">N<\/div>/, 'a generic letter N must not be used as the brand');

  // The tab strip stays above the search box: the tabs are the pane's spine and
  // the search box only belongs to the section it filters.
  assert.ok(
    taskpaneHtml.indexOf('id="searchMode"') < taskpaneHtml.indexOf('id="searchControls"'),
    'the tab strip must come before the search box',
  );
  assert.match(taskpaneHtml, /data-mode="references"/);
  assert.match(taskpaneHtml, /data-mode="synonyms"/);
  assert.match(taskpaneHtml, /data-mode="prompts"/);
  assert.match(taskpaneHtml, /data-mode="chat"/);
  assert.match(taskpaneHtml, /data-mode="prompts"[\s\S]*?<span class="seg-label">AI Edition<\/span>/);
  assert.equal((taskpaneHtml.match(/class="seg-icon"/g) || []).length, 6, 'every pane tab must have an icon');
  for (const id of ['searchModel', 'synonymControls', 'synonymModel', 'synonymContext', 'generateSynonyms', 'synonymStale', 'synonymRounds']) {
    assert.match(taskpaneHtml, new RegExp(`id="${id}"`), `Synonyms UI must contain ${id}`);
  }
  for (const id of ['promptControls', 'promptStyle', 'promptModel', 'promptSelection', 'applyPrompt', 'promptOutput', 'promptOutputStale', 'copyPromptOutput', 'pastePromptOutput']) {
    assert.match(taskpaneHtml, new RegExp(`id="${id}"`), `Prompt UI must contain ${id}`);
  }
  for (const id of ['chatControls', 'chatModel', 'chatScopePage', 'chatScopeDocument', 'chatSelection', 'chatMessages', 'chatInput', 'chatSend', 'chatStop', 'chatHistory', 'chatHistoryList']) {
    assert.match(taskpaneHtml, new RegExp(`id="${id}"`), `Chat UI must contain ${id}`);
  }
  assert.match(taskpaneHtml, /<script src="\/addin\/chat\.js"><\/script>/);
  assert.equal((taskpaneHtml.match(/class="prompt-typing-dot"/g) || []).length, 6, 'both writing generators must use the Nodi-style three-dot indicator');
  for (const id of ['referenceStyle', 'referenceStyleSearch', 'referenceLocale', 'referencePlacement', 'selectedReferences', 'insertCitation', 'insertBibliography', 'refreshReferences', 'unlinkReferences']) {
    assert.match(taskpaneHtml, new RegExp(`id="${id}"`), `References UI must contain ${id}`);
  }
  assert.match(referencesJs, /Word\.FieldType\.addin/, 'Word citations must be live ADDIN fields');
  assert.match(referencesJs, /insertFootnote/);
  assert.match(referencesJs, /insertEndnote/);
  assert.match(referencesJs, /suppressAuthor/);
  assert.match(referencesJs, /uncitedItems/);
  assert.match(referencesJs, /refresh-references/);
  assert.match(referencesJs, /unlink-references/);
  assert.match(referencesJs, /normalizeStyleSearch/);
  assert.match(referencesJs, /tokens\.every/);
  assert.match(referencesJs, /if \(!normalized\) \{[\s\S]*refs = \[\];[\s\S]*empty\(C\.searchPrompt\);[\s\S]*return Promise\.resolve\(\);/, 'an empty reference query must render no works and make no request');
  assert.match(taskpaneHtml, /role="combobox"[\s\S]*aria-controls="referenceStyleOptions"/);
  assert.match(taskpaneHtml, /id="referenceStyleOptions"[\s\S]*role="listbox"/);
  assert.match(taskpaneHtml, /id="referenceStyleManager"/);
  assert.match(referencesJs, /\/api\/references\/styles\?fresh=/, 'installed CSL styles must bypass caches');
  assert.match(referencesJs, /setInterval[\s\S]*loadStyles/, 'the open References pane keeps its installed styles live');
  assert.match(referencesJs, /destination: 'citation-styles'/, 'the style link opens Nodus at its CSL manager');
  assert.match(taskpaneCss, /body\.dark[\s\S]*--panel: #2b2b2b/);
  assert.match(taskpaneCss, /\.reference-style-options[\s\S]*background: var\(--panel\)/);
  assert.doesNotMatch(taskpaneJs, /style\.setProperty\('--panel', panel\)/, 'Office controlBackgroundColor must not turn dark cards white');
  assert.match(taskpaneJs, /readablePassageText/);
  assert.match(taskpaneJs, /\\uFFFD\\u25A1\\u2610\\u2612/);
  assert.match(taskpaneJs, /\/api\/prompts\/apply/);
  assert.match(taskpaneJs, /\/api\/synonyms/);
  assert.match(taskpaneJs, /text: text, model: selectedModelFrom\(els\.searchModel\)/, 'Ideas sends the selected model');
  assert.match(taskpaneJs, /ideaId: ideaId,[\s\S]*?model: selectedModelFrom\(els\.searchModel\)/, 'Insert with AI uses the Ideas model selector');
  assert.match(taskpaneJs, /var selectedModel = selectedModelFrom\(els\.synonymModel\);[\s\S]*?model: selectedModel/, 'Synonyms sends the selected model');
  assert.match(taskpaneJs, /\[els\.promptModel, els\.searchModel, els\.synonymModel\]\.forEach\(fillModelSelect\)/, 'the writing surfaces share the configured model catalogue');
  assert.match(taskpaneJs, /WordApiDesktop', '1\.2'/, 'current-page chat must be capability-gated');
  assert.match(taskpaneJs, /var pages = selection\.pages;/, 'current-page chat must read the page containing the Word selection');
  assert.match(taskpaneJs, /var pageRange = page\.getRange\(\);/, 'current-page chat must send the complete page range');
  assert.match(taskpaneJs, /body\.load\('text'\)/, 'full-document chat must load the Word body text');
  assert.match(taskpaneJs, /selectionText: rawSelection\.slice\(0, CHAT_SELECTION_CHAR_LIMIT\)/, 'selected Word text must accompany either chat scope with an explicit bound');
  assert.match(taskpaneJs, /selectionTruncated: rawSelection\.length > CHAT_SELECTION_CHAR_LIMIT/, 'selection truncation must be disclosed');
  assert.match(taskpaneJs, /readWordPageChatContext\(\)\.catch[\s\S]*readWordDocumentChatContext/, 'a runtime page API failure must fall back to the full document');
  assert.match(taskpaneJs, /documentKey: resolveChatDocumentKey\(\)/, 'chat history must be scoped to the current document');
  assert.match(chatJs, /\/api\/chat\/catalogue/);
  assert.match(chatJs, /\/api\/chat\/stream/);
  assert.match(chatJs, /new AbortController\(\)/, 'chat replies must be stoppable');
  assert.match(chatJs, /event\.key === 'Enter' && !event\.altKey/, 'Enter sends and Alt+Enter inserts a newline like the Zotero chat');
  assert.match(chatJs, /regenerateFrom\(messageIndex\)/, 'assistant messages must support regeneration');
  assert.match(chatJs, /editUserMessage\(messageIndex\)/, 'user messages must support editing');
  assert.match(chatJs, /localStorage\.setItem\(storageKey/, 'Word chat history must persist locally');
  assert.match(chatJs, /STORAGE_PREFIX \+ \(safe \|\| 'session'\)/, 'each document must have an isolated history namespace');
  assert.match(chatJs, /navigator\.clipboard\.writeText\(value\)\.catch[\s\S]*legacyCopyText/, 'clipboard permission failures must use the fallback');
  assert.doesNotMatch(chatJs, /innerHTML\s*=\s*(answer|content|source)/, 'model output must never be injected as HTML');
  assert.match(taskpaneJs, /previousAlternatives: previous/, 'regeneration must exclude every earlier replacement');
  assert.match(taskpaneJs, /alternatives\.length !== 5/, 'the pane only accepts complete five-item rounds');
  assert.match(taskpaneJs, /compareLocationWith\(selection\)/, 'expanded reformulations must resolve the target containing the live selection');
  assert.match(taskpaneJs, /matched\.range\.insertText\(alternative\.replacement, Word\.InsertLocation\.replace\)/, 'choosing an expanded alternative replaces its exact contextual target');
  assert.match(taskpaneJs, /insertAtCursor\(promptOutputText, \{ replace: true \}\)/, 'pasting a proposal replaces the unchanged Word selection');

  // A proposal costs tokens, so moving the Word selection must never discard
  // it: only the next generation (or pasting it) clears the box. While the
  // selection differs from the one that produced it, the proposal stays on
  // screen but cannot be pasted over the wrong text.
  assert.doesNotMatch(
    taskpaneJs,
    /if \(text !== promptSourceText\) clearPromptOutput\(\);/,
    'changing the Word selection must not discard a generated proposal',
  );
  assert.match(
    taskpaneJs,
    /normalizedSelection\(current\) !== promptOutputSourceText/,
    'pasting must compare against the selection the proposal was generated from',
  );
  assert.match(
    taskpaneJs,
    /var stale = !!promptOutputText && promptSourceText !== promptOutputSourceText;[\s\S]*els\.pastePromptOutput\.disabled = !promptOutputText \|\| stale;/,
    'a proposal from another selection must stay visible with pasting disabled',
  );

  // Moving the Word selection while a proposal is generating must not look
  // like it redirected the generation: the box keeps showing the text that was
  // sent and only goes live again once the generation settles.
  assert.match(
    taskpaneJs,
    /if \(!promptGenerating && \(changed \|\| !promptSelectionPainted\)\) paintPromptSelection\(text\);/,
    'the selection box must freeze while a proposal is generating',
  );
  assert.match(
    taskpaneJs,
    /var settled = promptGenerating && !generating;[\s\S]*if \(settled\) paintPromptSelection\(promptSourceText\);/,
    'the selection box must go live again when the generation settles',
  );

  // A generation survives leaving its tab, so the tab has to say so.
  assert.match(
    taskpaneJs,
    /els\.promptTab\.classList\.toggle\('is-busy', generating\)/,
    'the prompts tab must be marked while a proposal is generating',
  );
  assert.match(taskpaneCss, /\.seg\.is-busy::after \{/, 'the busy tab needs its marker');
  assert.match(taskpaneCss, /\.prompt-stale\[hidden\] \{ display: none; \}/);
  assert.match(taskpaneCss, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.word-chat-message-actions \{ opacity: \.82;/, 'chat actions must stay visible on touch devices');

  // The pane and the Zotero sidebar are one product: they must not drift into
  // two different accents. Both read their violet from their own stylesheet.
  const zoteroCss = fs.readFileSync(path.join(repoRoot, 'zotero-plugin/content/sidebar.css'), 'utf8');
  const zoteroAccent = (zoteroCss.match(/--nd-accent:\s*(#[0-9a-f]{6})/i) || [])[1];
  assert.equal(typeof zoteroAccent, 'string', 'the Zotero sidebar must declare its accent');
  assert.match(
    taskpaneCss,
    new RegExp(`--primary: ${zoteroAccent}`, 'i'),
    'the Word pane must use the same accent as the Zotero sidebar',
  );

  // An explicit display on a class beats the UA [hidden] rule, which is why the
  // search box used to stay on screen in the prompts tab.
  assert.match(
    taskpaneCss,
    /\[hidden\] \{ display: none !important; \}/,
    'panels the script hides must actually disappear',
  );

  // Word does not raise DocumentSelectionChanged for every way of selecting
  // text, so the open prompts tab polls the selection instead of waiting for
  // an unrelated control to force a refresh.
  assert.match(
    taskpaneJs,
    /function startPromptSelectionPolling\(\)[\s\S]*setInterval\([\s\S]*refreshPromptSelection/,
    'the writing and chat tabs must poll the Word selection',
  );
  assert.match(taskpaneJs, /if \(synonymMode\) \{[\s\S]*startPromptSelectionPolling\(\);/, 'the synonyms tab must poll the Word selection');
  assert.match(taskpaneJs, /if \(chatMode\) \{[\s\S]*startPromptSelectionPolling\(\);[\s\S]*return;[\s\S]*\}\s*\n\s*stopPromptSelectionPolling\(\);/, 'the selection poll must remain active for Chat and stop after leaving contextual tabs');
  // The tab strip must not reflow when the selection moves: every tab owns an
  // equal slot and the active one may not grow into its neighbours' space.
  assert.match(taskpaneCss, /\.seg \{[^}]*flex: 1 1 0;/, 'every tab must take an equal slot');
  const segActiveRule = (taskpaneCss.match(/\.seg\.active \{([^}]*)\}/) || [])[1] || '';
  assert.doesNotMatch(segActiveRule, /flex:/, 'the active tab must not resize its slot');
  assert.match(taskpaneCss, /\.seg-label \{[^}]*display: block;/, 'every tab keeps its label, not just the active one');
  assert.match(taskpaneCss, /@media \(max-width: 310px\)[\s\S]*\.seg-label \{ display: none; \}/, 'a very narrow pane falls back to icons');
  assert.match(taskpaneCss, /\.results\[hidden\]\s*\{[^}]*display:\s*none !important/, 'search results must stay hidden in prompt mode');
  assert.match(taskpaneCss, /\.empty\[hidden\]\s*\{[^}]*display:\s*none !important/, 'empty search messages must stay hidden in prompt mode');
  assert.match(taskpaneCss, /@keyframes prompt-typing-dot/, 'the prompt loading dots must animate');
  assert.match(taskpaneJs, /setPromptGenerating\(true\)/);
  assert.match(taskpaneJs, /setPromptGenerating\(false\)/);
  assert.match(referencesJs, /refTab\.querySelector\('\.seg-label'\)/, 'reference localization must preserve the compact tab icon');
  assert.doesNotMatch(referencesJs, /refTab\.textContent\s*=/, 'reference localization must not replace the complete tab contents');

  // The Word bridge opens the full idea detail in Ideas, not the graph. The
  // nonce makes a second click on the same idea retrigger the selection.
  const appSource = fs.readFileSync(path.join(repoRoot, 'src/App.tsx'), 'utf8');
  const ideasSource = fs.readFileSync(path.join(repoRoot, 'src/views/IdeasView.tsx'), 'utf8');
  const serverSource = fs.readFileSync(path.join(repoRoot, 'electron/copilot/server.ts'), 'utf8');
  const copilotChatSource = fs.readFileSync(path.join(repoRoot, 'electron/ai/copilotChat.ts'), 'utf8');
  const { isAllowedCopilotOrigin } = require(path.join(repoRoot, 'electron/copilot/originPolicy.ts'));
  assert.equal(isAllowedCopilotOrigin(undefined, 4320), true, 'native clients without Origin remain supported');
  assert.equal(isAllowedCopilotOrigin('https://localhost:4320', 4320), true);
  assert.equal(isAllowedCopilotOrigin('http://127.0.0.1:4320', 4320), true);
  assert.equal(isAllowedCopilotOrigin('https://attacker.example', 4320), false, 'remote websites cannot read the token-bearing add-in page');
  assert.equal(isAllowedCopilotOrigin('https://localhost:9999', 4320), false, 'another local port is not the add-in origin');
  assert.match(serverSource, /urlPath === '\/api\/prompts'/);
  assert.match(serverSource, /urlPath === '\/api\/prompts\/apply'/);
  assert.match(serverSource, /urlPath === '\/api\/synonyms'/);
  assert.match(serverSource, /urlPath === '\/api\/chat\/catalogue'/);
  assert.match(serverSource, /urlPath === '\/api\/chat\/stream'/);
  assert.match(serverSource, /isAllowedCopilotOrigin\(origin, port\)/, 'the local API must reject non-local browser origins');
  assert.doesNotMatch(serverSource, /Access-Control-Allow-Origin', origin \?\? '\*'/, 'the bearer-token page must never enable wildcard/reflected CORS');
  assert.match(serverSource, /error instanceof CopilotRequestError \? error\.statusCode : 500/, 'malformed and oversized input must keep its 4xx status');
  assert.match(serverSource, /normalizeOfficeChatRequest\([\s\S]*sendJson\(res, 400/, 'chat validation must happen before streaming headers');
  assert.match(serverSource, /COPILOT_MODEL_PROVIDERS\.has\(provider\)/, 'unknown providers must be rejected before reaching the AI client');
  assert.match(serverSource, /streamOfficeChat\(normalizedChat/);
  assert.match(copilotChatSource, /untrustedSelectedPassage/);
  assert.match(copilotChatSource, /Solo authorizedQuestion contiene la instrucción actual autorizada/, 'only the latest question may direct the model');
  assert.match(copilotChatSource, /completeTextStreamNeutral/, 'global promptLanguage must not override the question language');
  assert.match(copilotChatSource, /No inventes contenido ausente del contexto/, 'chat must stay grounded in the selected Word context');
  assert.match(referencesJs, /fingerprint === externalStateFingerprint/, 'identical Writer polling snapshots must not rebuild the citation composer');
  assert.match(serverSource, /suggestStudySynonyms\(\{/, 'the Word endpoint must reuse the workspace synonym engine');
  assert.match(serverSource, /composeFromSelection\(\{[\s\S]*?model: modelRef\(body\.model\)/, 'selection actions must honor the Ideas/Passages model selector');
  assert.match(serverSource, /composeCopilotIdeaInsertion\(\{[\s\S]*?model: modelRef\(body\.model\)/, 'Insert with AI must honor the Ideas model selector');
  assert.match(serverSource, /suggestStudySynonyms\(\{[\s\S]*?model: modelRef\(body\.model\)/, 'synonyms must honor their model selector');
  assert.match(serverSource, /destination: 'ideas'/);
  assert.match(serverSource, /destination === 'citation-styles'[\s\S]*destination: 'library-citation-styles'/);
  assert.match(appSource, /target\.destination === 'library-citation-styles'[\s\S]*citationStyles: true[\s\S]*setView\('library'\)/);
  assert.match(
    appSource,
    /if \(target\.destination === 'ideas'\) \{\s*setIdeaTarget\(\{ ideaId: target\.ideaId, nonce: Date\.now\(\) \}\);\s*setView\('ideas'\);/s
  );
  assert.match(ideasSource, /if \(target\) showIdea\(\{ id: target\.ideaId, label: t\('Idea'\) \}\)/);

  // Office's add-in cache must survive an install untouched. Deleting individual
  // files from it is documented to make ALL add-ins stop loading, and it did:
  // it left Word unable to register any sideloaded add-in until the whole cache
  // was cleared. https://learn.microsoft.com/office/dev/add-ins/testing/clear-cache
  assert.equal(
    typeof installModule.purgeCachedCopilotAddin,
    'undefined',
    'the per-file Office cache purge must not come back'
  );

  // Only macOS and Windows have a Word sideload catalog; elsewhere install bails out early.
  if (process.platform === 'darwin' || process.platform === 'win32') {
    const fakeHome = path.join(root, 'home');
    const cache =
      process.platform === 'darwin'
        ? path.join(
            fakeHome,
            'Library/Containers/com.microsoft.Word/Data/Library/Application Support/Microsoft/Office/16.0/Wef'
          )
        : path.join(fakeHome, 'AppData/Local/Microsoft/Office/16.0/Wef');
    const manifestDir =
      process.platform === 'darwin'
        ? path.join(fakeHome, 'Library/Containers/com.microsoft.Word/Data/Documents/wef')
        : cache;
    fs.mkdirSync(path.join(cache, 'Manifests'), { recursive: true });
    fs.writeFileSync(path.join(cache, 'Manifests', 'cached-nodus'), '<Id>E4352919-FFEC-4F77-8268-975BB4217FAD</Id>');
    fs.writeFileSync(path.join(cache, 'Word.RibbonCache.es-ES'), 'Nodus Copilot\nClaude in Microsoft Office');

    // install.ts calls os.homedir() at call time, so patching the shared CJS
    // module object redirects it. The ESM namespace object is read-only.
    const osModule = require('node:os');
    const originalHomedir = osModule.homedir;
    const originalLocalAppData = process.env.LOCALAPPDATA;
    osModule.homedir = () => fakeHome;
    process.env.LOCALAPPDATA = path.join(fakeHome, 'AppData/Local');
    let result;
    try {
      result = await installCopilotAddin(repoRoot, '0.7.20');
    } finally {
      osModule.homedir = originalHomedir;
      if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = originalLocalAppData;
    }

    assert.equal(result.ok, true, result.message);
    assert.match(result.message, /installed\/updated for Word/);
    assert.equal(fs.existsSync(path.join(manifestDir, 'nodus-copilot.manifest.xml')), true);
    assert.equal(fs.existsSync(path.join(cache, 'Manifests', 'cached-nodus')), true, 'install must not touch the Office cache');
    assert.equal(
      fs.existsSync(path.join(cache, 'Word.RibbonCache.es-ES')),
      true,
      'install must not delete the shared ribbon cache'
    );
  }
  console.log('copilot add-in manifest/cache test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath() {
        return userDataPath;
      },
      getVersion() {
        return '0.7.20';
      },
      getAppPath() {
        return repoRoot;
      },
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable() {
        return false;
      },
      encryptString(value) {
        return Buffer.from(String(value), 'utf8');
      },
      decryptString(value) {
        return Buffer.from(value).toString('utf8');
      },
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
