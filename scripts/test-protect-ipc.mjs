import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-protect-ipc-test')) {
  execFileSync(path.join(root, 'node_modules/.bin/electron'), [path.join(root, 'scripts/test-protect-ipc.mjs'), '--electron-protect-ipc-test'], {
    cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-protect-ipc-'));
installRuntimeHooks(temp);
try {
  const service = require(path.join(root, 'electron/protect/protectService.ts'));
  const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const selectedPath = path.join(temp, 'selected.png');
  const arbitraryPath = path.join(temp, 'arbitrary.png');
  const mismatchedPath = path.join(temp, 'fake.pdf');
  fs.writeFileSync(selectedPath, pngHeader);
  fs.writeFileSync(arbitraryPath, pngHeader);
  fs.writeFileSync(mismatchedPath, pngHeader);

  const selected = service.registerProtectDiskSources([selectedPath]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].mimeType, 'image/png');
  const payload = await service.readProtectSource(selected[0].ref);
  assert.equal(payload.name, 'selected.png');
  assert.deepEqual(payload.bytes, pngHeader);

  await assert.rejects(
    service.readProtectSource({ kind: 'disk', path: arbitraryPath }),
    /Vuelve a seleccionar/,
    'an arbitrary renderer path is rejected until the native picker/preload registers it',
  );
  await assert.rejects(service.readProtectSource({ kind: 'invented', vaultId: 'x' }), /Tipo de fuente no válido/);
  assert.throws(() => service.registerProtectDiskSources([mismatchedPath]), /extensión y el contenido real/);

  const validArtifact = service.validateProtectArtifact({
    fileName: '../../resultado.png', mimeType: 'image/png', format: 'png', pageCount: 1, bytes: pngHeader,
  });
  assert.equal(validArtifact.fileName, 'resultado.png', 'renderer-controlled paths are reduced to a basename');
  assert.throws(() => service.validateProtectArtifact({ ...validArtifact, mimeType: 'application/pdf' }), /formato, MIME y extensión/);
  assert.throws(() => service.validateProtectArtifact({ ...validArtifact, bytes: new Uint8Array([1, 2, 3]) }), /PNG válido/);
  assert.throws(() => service.validateProtectArtifact({ ...validArtifact, pageCount: 0 }), /páginas no válido/);
  assert.doesNotThrow(() => service.validateProtectArtifact({ fileName: 'registro.csv', mimeType: 'text/csv', format: 'csv', pageCount: 0, bytes: new TextEncoder().encode('copyId,label\n') }));

  const target = path.join(temp, 'atomic.png');
  service.writeArtifactAtomically(target, validArtifact.bytes);
  assert.deepEqual(new Uint8Array(fs.readFileSync(target)), pngHeader);
  const replacement = new Uint8Array([...pngHeader, 1, 2, 3]);
  service.writeArtifactAtomically(target, replacement);
  assert.deepEqual(new Uint8Array(fs.readFileSync(target)), replacement, 'an accepted overwrite replaces the complete artifact');
  assert.equal(fs.readdirSync(temp).some((name) => name.includes('.nodus-') && /\.(?:tmp|bak)$/.test(name)), false);

  const reusable = service.saveProtectCopy({ ...validArtifact, fileName: 'reutilizable.png' });
  service.saveProtectCopy({ fileName: 'paginas.zip', mimeType: 'application/zip', format: 'zip', pageCount: 2, bytes: new Uint8Array([0x50, 0x4b, 3, 4]) });
  const vaultSources = await service.listProtectVaultSources();
  const reusableSource = vaultSources.find((item) => item.ref.kind === 'protect-copy' && item.ref.copyId === reusable.id);
  const zipSource = vaultSources.find((item) => item.name === 'paginas.zip');
  assert.equal(reusableSource?.available, true, 'compatible protected copies can be reused as a source');
  assert.equal(zipSource?.available, false, 'a ZIP stays downloadable but is not misrepresented as an accepted input document');
  assert.match(zipSource?.unavailableReason ?? '', /puede descargarse/);
  assert.equal((await service.readProtectSource(reusableSource.ref)).name, 'reutilizable.png');
  service.invalidateProtectVaultReferences();
  await assert.rejects(service.readProtectSource(reusableSource.ref), /Vuelve a seleccionar/, 'vault switching revokes previously issued source capabilities');

  const processingSources = [
    fs.readFileSync(path.join(root, 'src/lib/protect/engine.ts'), 'utf8'),
    fs.readFileSync(path.join(root, 'src/lib/protect/editor.ts'), 'utf8'),
    fs.readFileSync(path.join(root, 'src/lib/protect/stego.ts'), 'utf8'),
    fs.readFileSync(path.join(root, 'src/lib/protect/watermark.ts'), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(processingSources, /\b(?:fetch|XMLHttpRequest|axios|net\.request)\s*\(/, 'the Protect processing engine has no network call surface');

  console.log('Nodus Protect IPC and boundary security test passed');
} finally {
  try { require(path.join(root, 'electron/db/database.ts')).closeDb(); } catch { /* database was never opened */ }
  await rm(temp, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(root, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return {
      app: { getPath: () => userDataPath, getVersion: () => 'test', getAppPath: () => root, isPackaged: false },
      safeStorage: { isEncryptionAvailable: () => false },
      ShareMenu: class ShareMenu {},
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true,
    } }).outputText, filename);
  };
}
