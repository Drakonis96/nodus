import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'darwin') {
  console.log('macOS update-helper test skipped outside macOS');
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-update-helper-test-'));
try {
  // Keep the shell helper in electron/main.ts, but execute that exact source in
  // an isolated fixture so a future refactor cannot silently break ad-hoc macOS
  // replacement (the path used by the fallback updater).
  const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const match = mainSource.match(
    /function unsignedMacUpdateHelperScript\(\): string \{[\s\S]*?return \[([\s\S]*?)\]\.join\('\\n'\);[\s\S]*?\n\}/
  );
  assert.ok(match?.[1], 'Could not locate the macOS update helper source');
  const lines = Function(`return [${match[1]}]`)();
  assert.ok(Array.isArray(lines) && lines.length > 0, 'The update helper must produce a shell script');

  const targetApp = path.join(root, 'Nodus.app');
  const sourceApp = path.join(root, 'source', 'Nodus.app');
  const zipPath = path.join(root, 'Nodus-update.zip');
  const helperPath = path.join(root, 'helper.sh');
  const statePath = path.join(root, 'state.json');
  await mkdir(path.join(targetApp, 'Contents'), { recursive: true });
  await mkdir(path.join(sourceApp, 'Contents'), { recursive: true });
  await writeFile(path.join(targetApp, 'Contents', 'version.txt'), 'old');
  await writeFile(path.join(sourceApp, 'Contents', 'version.txt'), 'new');
  const archive = spawnSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', sourceApp, zipPath], { encoding: 'utf8' });
  assert.equal(archive.status, 0, archive.stderr || 'Could not create update ZIP fixture');
  await writeFile(helperPath, lines.join('\n'), { mode: 0o700 });

  const sleeper = spawn('/bin/sleep', ['0.2']);
  assert.ok(sleeper.pid, 'Could not start the helper wait fixture');
  const result = await new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', [helperPath, String(sleeper.pid), zipPath, targetApp, statePath]);
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
  assert.equal(result, 0, 'The update helper should finish successfully');
  assert.equal(await readFile(path.join(targetApp, 'Contents', 'version.txt'), 'utf8'), 'new');
  assert.equal(await readFile(path.join(`${targetApp}.previous`, 'Contents', 'version.txt'), 'utf8'), 'old');
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), { status: 'installed' });
  console.log('macOS update-helper replacement test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
