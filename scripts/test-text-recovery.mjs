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

if (!process.argv.includes('--electron-text-recovery-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-text-recovery.mjs'), '--electron-text-recovery-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-text-recovery-test-'));
installRuntimeHooks(root);

try {
  const AdmZip = require('adm-zip');
  const { extractFromPath, isTextAttachment } = require(path.join(repoRoot, 'electron/extraction/textExtractor.ts'));
  const { shouldQueueDeepAfterSync } = require(path.join(repoRoot, 'electron/sync/syncService.ts'));

  const epubPath = path.join(root, 'sample.epub');
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
  );
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest>
    <item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chap2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap1"/>
    <itemref idref="chap2"/>
  </spine>
</package>`)
  );
  zip.addFile(
    'OEBPS/chapter1.xhtml',
    Buffer.from('<html><body><h1>Capitulo uno</h1><p>Espana &amp; turismo tienen texto real.</p></body></html>')
  );
  zip.addFile(
    'OEBPS/chapter2.xhtml',
    Buffer.from('<html><body><p>Segundo bloque con memoria, fotografia y viajes.</p></body></html>')
  );
  zip.writeZip(epubPath);

  const doc = await extractFromPath(epubPath);
  assert.equal(doc.sourceType, 'epub');
  assert.match(doc.text, /Capitulo uno/);
  assert.match(doc.text, /Espana & turismo/);
  assert.match(doc.text, /Segundo bloque/);

  assert.equal(isTextAttachment({ key: 'A', contentType: 'application/epub+zip', linkMode: 'imported_file', filename: 'book.epub' }), true);
  assert.equal(isTextAttachment({ key: 'B', contentType: 'text/html', linkMode: 'imported_url', filename: 'snapshot.html' }), false);

  assert.equal(
    shouldQueueDeepAfterSync({
      autoDeepScanOnReadTag: false,
      hasReadTag: false,
      manualDeep: true,
      isNew: false,
      didChange: false,
      deepStatus: 'skipped_no_text',
      recoverableText: true,
    }),
    true,
    'manual skipped works should recover when text is now available'
  );
  assert.equal(
    shouldQueueDeepAfterSync({
      autoDeepScanOnReadTag: false,
      hasReadTag: false,
      manualDeep: true,
      isNew: false,
      didChange: false,
      deepStatus: 'skipped_no_text',
      recoverableText: false,
    }),
    false,
    'manual skipped works without available text should not loop'
  );
  assert.equal(
    shouldQueueDeepAfterSync({
      autoDeepScanOnReadTag: false,
      hasReadTag: true,
      manualDeep: false,
      isNew: false,
      didChange: false,
      deepStatus: 'none',
      recoverableText: true,
    }),
    false,
    'read-tag automation remains opt-in'
  );
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
        return '0.0.0-test';
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
