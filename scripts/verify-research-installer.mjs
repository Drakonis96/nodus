/** Native installer lifecycle. Never runs against a developer's installed app. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { _electron } from 'playwright-core';
import { verifyResearchPdf } from './verify-research-pdf.mjs';
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
const baseDirectory = process.argv.find(value => value.startsWith('--upgrade-base='))?.slice('--upgrade-base='.length);
const base = baseDirectory ? JSON.parse(fs.readFileSync(path.join(baseDirectory, 'upgrade-base.json'), 'utf8')) : null;
if (base) {
  assert.equal(base.version, '5.6.0');
  assert.match(process.env.NODUS_RESEARCH_CANDIDATE_VERSION ?? '', /^5\.6\.1-research\.\d+$/);
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(baseDirectory, base.name))).digest('hex'), base.sha256);
  report.base = base;
  report.updateKind = 'v5.6.0-to-private-higher-version';
}
let installed = false, executable, resources, linuxPackage;
async function install(installer = artifact, legacy = false) {
  if (process.platform === 'darwin') {
    const mount = path.join(root, 'mount'); fs.mkdirSync(mount, { recursive: true });
    run('/usr/bin/hdiutil', ['attach', installer, '-readonly', '-nobrowse', '-mountpoint', mount]);
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
    run(installer, ['/S', `/D=${installation}`]);
    executable = path.join(installation, 'Nodus.exe');
    resources = path.join(installation, 'resources');
  } else if (process.platform === 'linux') {
    linuxPackage = run('dpkg-deb', ['-f', installer, 'Package']);
    assert.match(linuxPackage, /^[a-z0-9][a-z0-9+.-]+$/);
    run('sudo', ['apt-get', 'install', '-y', '--reinstall', path.resolve(installer)]);
    executable = '/opt/Nodus/nodus'; resources = '/opt/Nodus/resources';
  } else throw new Error('Unsupported native installer platform');
  installed = true;
  assert.ok(fs.existsSync(executable), 'native installer must create the real application executable');
  if (legacy) return;
  const runtime = path.join(resources, 'zotero-mcp');
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'runtime.json'), 'utf8'));
  assert.equal(manifest.upstreamCommit, '62335504262f4239961c4e782e342bd3bab4d5b2');
  const python = path.join(runtime, process.platform === 'win32' ? 'python/python.exe' : 'python/bin/python3');
  const pythonArgs = ['-I', '-B', '-c', 'import sys,runpy; assert sys.version_info[:3] == (3,12,14); runpy.run_path(sys.argv[1]); print("packaged-runtime-ready")', path.join(runtime, 'serve.py')];
  const output = policy ? run('/usr/bin/sandbox-exec', ['-p', policy, python, ...pythonArgs], { env: environment }) : run(python, pythonArgs, { env: environment });
  assert.match(output, /packaged-runtime-ready/);
}
async function launch(legacy = false) {
  // The released app predates the isolation bootstrap. Its sole allowed host is
  // this disposable VM; no inference from the new bootstrap is made about it.
  // macOS additionally denies outbound network at the OS boundary.
  const launchPolicy = legacy && policy ? '(version 1)\n(allow default)\n(deny network-outbound)\n' : policy;
  const launchEnvironment = { ...environment };
  if (legacy) delete launchEnvironment.NODUS_ISOLATED_ROOT;
  let launchExecutable = executable;
  if (launchPolicy) {
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const policyFile = path.join(root, 'isolation.sb'); fs.writeFileSync(policyFile, launchPolicy);
    launchExecutable = path.join(root, 'launch-installed');
    fs.writeFileSync(launchExecutable, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(policyFile)} ${quote(executable)} "$@"\n`, { mode: 0o700 });
  }
  const app = await _electron.launch({ executablePath: launchExecutable,
    args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`], cwd: root, env: launchEnvironment, timeout: 60000 });
  const pid = app.process().pid;
  const diagnostics = { stdout: '', stderr: '' };
  for (const stream of ['stdout', 'stderr']) app.process()[stream]?.on('data', data => { diagnostics[stream] = (diagnostics[stream] + data.toString()).slice(-64000); });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.nodus && document.getElementById('root')?.children.length), { timeout: 60000 });
    const actual = await app.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, userData: app.getPath('userData'),
      resources: process.resourcesPath, version: app.getVersion(), title: BrowserWindow.getAllWindows()[0].getTitle() }));
    assert.equal(actual.packaged, true); assert.equal(actual.userData, profile);
    assert.equal(fs.realpathSync(actual.resources), fs.realpathSync(resources));
    if (legacy) {
      assert.equal(actual.version, '5.6.0');
      const note = await page.evaluate(async () => {
        await window.nodus.updateSettings({ onboardingComplete: true, autoLightScan: false, autoDeepScanOnReadTag: false,
          autoSummaryAfterDeep: false, autoResumeQueue: false, syncMode: 'manual' });
        return window.nodus.createNote({ title: 'Native upgrade retained note', content: 'Synthetic v5.6.0 migration sentinel.', kind: 'markdown' });
      });
      report.legacyNoteId = note.id;
      report.launches.push({ ...actual, pid, legacy: true, isolation: 'disposable-hosted-VM; no new bootstrap', outboundNetworkDenied: Boolean(launchPolicy) });
      return;
    }
    if (base) {
      assert.equal(actual.version, process.env.NODUS_RESEARCH_CANDIDATE_VERSION);
      const note = await page.evaluate(id => window.nodus.getNote(id), report.legacyNoteId);
      assert.equal(note.content, 'Synthetic v5.6.0 migration sentinel.');
      report.legacyNotePreserved = true;
    }
    assert.equal(actual.title, 'Nodus Research · Desarrollo');
    const notebooks = await page.evaluate(async () => {
      const before = await window.nodus.listResearchNotebooks();
      if (!before.length) await window.nodus.saveResearchNotebook({ name: 'Native installer retained notebook', mode: 'fixed', sources: [], exclusions: [] });
      return window.nodus.listResearchNotebooks();
    });
    assert.ok(notebooks.some(notebook => notebook.name === 'Native installer retained notebook'));
    await verifyResearchPdf(page, app, root);
    report.launches.push({ ...actual, pid, retainedNotebook: true, packagedPdfEvidence: true });
  } catch (error) {
    report.bootFailure = { error: String(error), ...diagnostics,
      appLog: fs.existsSync(path.join(profile, 'nodus-logs.json')) ? fs.readFileSync(path.join(profile, 'nodus-logs.json'), 'utf8').slice(-32000) : null,
      state: await app.evaluate(({ app, BrowserWindow }) => ({ ready: app.isReady(), windows: BrowserWindow.getAllWindows().length, userData: app.getPath('userData') })).catch(() => null) };
    throw error;
  } finally {
    await app.close();
    assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH', 'installed application exits before replacement/removal');
  }
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
  if (base) { await install(path.join(baseDirectory, base.name), true); await launch(true); }
  await install(); await launch();
  await install(); await launch();
  await remove();
  assert.equal(fs.readFileSync(path.join(profile, 'retained.txt'), 'utf8'), 'user data must survive removal');
  assert.equal(fs.readFileSync(path.join(foreign, 'keep.txt'), 'utf8'), 'owned by an unrelated fixture');
  report.passed = true; report.profilePreserved = true; report.foreignResourcesPreserved = true;
  report.futureVersionUpgradeTest = Boolean(base && report.legacyNotePreserved);
} finally {
  try { await remove(); } finally {
    fs.writeFileSync('research-installer-evidence.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
