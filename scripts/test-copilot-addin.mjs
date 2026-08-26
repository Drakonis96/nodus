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
  const taskpaneCss = fs.readFileSync(path.join(repoRoot, 'word-addin/taskpane.css'), 'utf8');
  assert.match(taskpaneHtml, /<html lang="en">/);
  assert.match(taskpaneHtml, />Analyze paragraph</);
  assert.doesNotMatch(taskpaneHtml, /Conectando|Buscar ideas|Analizar párrafo|Selección|Insertar en|Nota al pie|Pasajes/);
  assert.match(taskpaneJs, /table\[key\] !== undefined \? table\[key\] : STR\.en\[key\]/);
  assert.match(taskpaneHtml, /<img class="mark" src="\/addin\/assets\/icon-32\.png"/, 'the pane must use the stylized Nodus mark');
  assert.doesNotMatch(taskpaneHtml, /<div class="mark">N<\/div>/, 'a generic letter N must not be used as the brand');
  assert.match(taskpaneHtml, /data-mode="references"/);
  assert.match(taskpaneHtml, /data-mode="prompts"/);
  assert.equal((taskpaneHtml.match(/class="seg-icon"/g) || []).length, 4, 'every pane tab must have an icon');
  for (const id of ['promptControls', 'promptStyle', 'promptModel', 'promptSelection', 'applyPrompt', 'promptOutput', 'copyPromptOutput', 'pastePromptOutput']) {
    assert.match(taskpaneHtml, new RegExp(`id="${id}"`), `Prompt UI must contain ${id}`);
  }
  assert.equal((taskpaneHtml.match(/class="prompt-typing-dot"/g) || []).length, 3, 'prompt generation must use the Nodi-style three-dot indicator');
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
  assert.match(taskpaneJs, /insertAtCursor\(promptOutputText, \{ replace: true \}\)/, 'pasting a proposal replaces the unchanged Word selection');
  assert.match(taskpaneCss, /\.seg-label\s*\{[^}]*display:\s*none/);
  assert.match(taskpaneCss, /\.seg:not\(\.active\) \.seg-label\s*\{[^}]*display:\s*none !important;[^}]*inline-size:\s*0/);
  assert.match(taskpaneCss, /\.seg\.active \.seg-label\s*\{[^}]*display:\s*inline-block/);
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
  assert.match(serverSource, /urlPath === '\/api\/prompts'/);
  assert.match(serverSource, /urlPath === '\/api\/prompts\/apply'/);
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
