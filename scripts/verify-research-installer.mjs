/** Native installer lifecycle. Never runs against a developer's installed app. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { _electron } from 'playwright-core';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('Installer tests require a disposable GitHub-hosted runner');
}
const release = fs.realpathSync(process.argv[2] ?? 'release');
const root = createResearchTestRoot();
const profile = path.join(root, 'profile');
const installation = path.join(root, 'installation');
const foreign = path.join(root, 'foreign-installation');
fs.mkdirSync(installation); fs.mkdirSync(foreign);
fs.writeFileSync(path.join(foreign, 'keep.txt'), 'owned by an unrelated fixture');
fs.writeFileSync(path.join(profile, 'retained.txt'), 'user data must survive removal');
const policy = process.platform === 'darwin' ? macResearchSandbox(root) : null;
const proof = policy ? verifyResearchSandbox(root, policy) : { environment: 'disposable-hosted-ci', osWriteBoundaryVerified: false };
const environment = { ...researchTestEnvironment(root), HOME: root };
const report = { root, platform: process.platform, arch: process.arch, proof, passed: false,
  updateKind: 'same-version-native-reinstallation', futureVersionUpgradeTest: false, launches: [] };
const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 600000, ...options });
  if (result.status !== 0) throw new Error(`${path.basename(file)} failed (${result.status}): ${result.stderr ?? ''}\n${result.stdout ?? ''}`);
  return result.stdout?.trim();
};
const suffix = process.platform === 'darwin' ? '.dmg' : process.platform === 'win32' ? '.exe' : '.deb';
const artifacts = fs.readdirSync(release).filter(name => name.startsWith('Nodus-') && name.endsWith(suffix));
assert.equal(artifacts.length, 1, 'exactly one native installer must match this runner');
const artifact = path.join(release, artifacts[0]);
report.artifact = { name: artifacts[0], sha256: createHash('sha256').update(fs.readFileSync(artifact)).digest('hex') };
let installed = false, executable, resources, linuxPackage;
async function install() {
  if (process.platform === 'darwin') {
    const mount = path.join(root, 'mount'); fs.mkdirSync(mount, { recursive: true });
    run('/usr/bin/hdiutil', ['attach', artifact, '-readonly', '-nobrowse', '-mountpoint', mount]);
    try {
      const apps = fs.readdirSync(mount).filter(name => name.endsWith('.app'));
      assert.equal(apps.length, 1);
      const app = path.join(installation, apps[0]);
      // Standard DMG installation/replacement copies the application bundle.
      fs.rmSync(app, { recursive: true, force: true });
      run('/usr/bin/ditto', [path.join(mount, apps[0]), app]);
      executable = path.join(app, 'Contents/MacOS/Nodus');
      resources = path.join(app, 'Contents/Resources');
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
      run('/usr/bin/xcrun', ['stapler', 'validate', app]);
    } finally { run('/usr/bin/hdiutil', ['detach', mount]); }
  } else if (process.platform === 'win32') {
    // NSIS requires /D to be the final argument. No --force-run flag is passed.
    run(artifact, ['/S', `/D=${installation}`]);
    executable = path.join(installation, 'Nodus.exe');
    resources = path.join(installation, 'resources');
  } else if (process.platform === 'linux') {
    linuxPackage = run('dpkg-deb', ['-f', artifact, 'Package']);
    assert.match(linuxPackage, /^[a-z0-9][a-z0-9+.-]+$/);
    run('sudo', ['apt-get', 'install', '-y', '--reinstall', artifact]);
    executable = '/opt/Nodus/nodus'; resources = '/opt/Nodus/resources';
  } else throw new Error('Unsupported native installer platform');
  installed = true;
  assert.ok(fs.existsSync(executable), 'native installer must create the real application executable');
  const runtime = path.join(resources, 'zotero-mcp');
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'runtime.json'), 'utf8'));
  assert.equal(manifest.upstreamCommit, '62335504262f4239961c4e782e342bd3bab4d5b2');
  const python = path.join(runtime, process.platform === 'win32' ? 'python/python.exe' : 'python/bin/python3');
  const pythonArgs = ['-I', '-B', '-c', 'import sys,runpy; assert sys.version_info[:3] == (3,12,14); runpy.run_path(sys.argv[1]); print("packaged-runtime-ready")', path.join(runtime, 'serve.py')];
  const output = policy ? run('/usr/bin/sandbox-exec', ['-p', policy, python, ...pythonArgs], { env: environment }) : run(python, pythonArgs, { env: environment });
  assert.match(output, /packaged-runtime-ready/);
}
async function launch() {
  let launchExecutable = executable;
  if (policy) {
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const policyFile = path.join(root, 'isolation.sb'); fs.writeFileSync(policyFile, policy);
    launchExecutable = path.join(root, 'launch-installed');
    fs.writeFileSync(launchExecutable, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(policyFile)} ${quote(executable)} "$@"\n`, { mode: 0o700 });
  }
  const app = await _electron.launch({ executablePath: launchExecutable,
    args: ['--no-sandbox', '--disable-gpu'], cwd: root, env: environment, timeout: 60000 });
  const pid = app.process().pid;
  const diagnostics = { stdout: '', stderr: '' };
  for (const stream of ['stdout', 'stderr']) app.process()[stream]?.on('data', data => { diagnostics[stream] = (diagnostics[stream] + data.toString()).slice(-64000); });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.nodus && document.getElementById('root')?.children.length), { timeout: 60000 });
    const actual = await app.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, userData: app.getPath('userData'),
      resources: process.resourcesPath, title: BrowserWindow.getAllWindows()[0].getTitle() }));
    assert.equal(actual.packaged, true); assert.equal(actual.userData, profile);
    assert.equal(fs.realpathSync(actual.resources), fs.realpathSync(resources));
    assert.equal(actual.title, 'Nodus Research · Desarrollo');
    const notebooks = await page.evaluate(async () => {
      const before = await window.nodus.listResearchNotebooks();
      if (!before.length) await window.nodus.saveResearchNotebook({ name: 'Native installer retained notebook', mode: 'fixed', sources: [], exclusions: [] });
      return window.nodus.listResearchNotebooks();
    });
    assert.ok(notebooks.some(notebook => notebook.name === 'Native installer retained notebook'));
    let corpusNotebook = notebooks.find(notebook => notebook.name === 'Packaged PDF extraction');
    if (!corpusNotebook) {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      pdf.addPage().drawText('PACKAGED73 records a synthetic measurement of 73 units.', { x: 40, y: 700, size: 12, font });
      const filename = path.join(root, 'fixtures/packaged.pdf');
      fs.writeFileSync(filename, await pdf.save());
      await app.evaluate(({ dialog }, filename) => { globalThis.installerOpenDialog = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, filename);
      try {
        corpusNotebook = await page.evaluate(async root => {
          await window.nodus.updateSettings({ autoBackupFolder: `${root}/library` });
          const item = await window.nodus.createGlobalLibraryItem({ title: 'Packaged synthetic PDF', itemType: 'report', creators: [] }, []);
          await window.nodus.addGlobalLibraryAttachments(item.id);
          const notebook = await window.nodus.saveResearchNotebook({ name: 'Packaged PDF extraction', mode: 'fixed', sources: [{ kind: 'library-item', id: item.id }], exclusions: [] });
          await window.nodus.prepareResearchDocuments([item.id]);
          return notebook;
        }, root);
      } finally { await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.installerOpenDialog; delete globalThis.installerOpenDialog; }); }
    }
    const deadline = Date.now() + 150000;
    let evidence;
    do {
      evidence = (await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'PACKAGED73'), corpusNotebook.id)).evidence;
      if (evidence.some(item => item.provenance === 'source' && item.text.includes('PACKAGED73'))) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    assert.ok(evidence.some(item => item.provenance === 'source' && item.locator.pageNumber === 1 && item.text.includes('PACKAGED73')), 'packaged extraction and retrieval return original PDF evidence');
    report.launches.push({ ...actual, pid, retainedNotebook: true, packagedPdfEvidence: true });
  } catch (error) {
    report.bootFailure = { error: String(error), ...diagnostics,
      state: await app.evaluate(({ app, BrowserWindow }) => ({ ready: app.isReady(), windows: BrowserWindow.getAllWindows().length, userData: app.getPath('userData') })).catch(() => null) };
    throw error;
  } finally { await app.close(); }
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH', 'installed application exits before replacement/removal');
}
async function remove() {
  if (!installed) return;
  if (process.platform === 'win32') {
    const uninstallers = fs.readdirSync(installation).filter(name => /^Uninstall.*\.exe$/i.test(name));
    assert.equal(uninstallers.length, 1);
    run(path.join(installation, uninstallers[0]), ['/S', `_?=${installation}`]);
  } else if (process.platform === 'linux') run('sudo', ['apt-get', 'remove', '-y', linuxPackage]);
  else fs.rmSync(path.join(installation, 'Nodus.app'), { recursive: true });
  assert.equal(fs.existsSync(executable), false, 'native removal must remove the application');
  installed = false;
}
try {
  await install(); await launch();
  await install(); await launch();
  await remove();
  assert.equal(fs.readFileSync(path.join(profile, 'retained.txt'), 'utf8'), 'user data must survive removal');
  assert.equal(fs.readFileSync(path.join(foreign, 'keep.txt'), 'utf8'), 'owned by an unrelated fixture');
  report.passed = true; report.profilePreserved = true; report.foreignResourcesPreserved = true;
} finally {
  try { await remove(); } finally {
    fs.writeFileSync('research-installer-evidence.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
