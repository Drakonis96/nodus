import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';

const root = createResearchTestRoot();
const outfile = path.join(root, 'paths.mjs');
await build({ entryPoints: ['electron/qa/isolatedProfile.ts'], outfile, bundle: true, platform: 'node', format: 'esm' });
const { assertIsolatedProductionSeparation, isolatedPath, validateIsolatedRoot, claimIsolatedProfile } = await import(pathToFileURL(outfile).href);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('requires a matching manifest and forbids traversal and symlinks before writes', () => {
  assert.equal(validateIsolatedRoot(root), root);
  assert.throws(() => validateIsolatedRoot('.'), /absolute/);
  assert.throws(() => validateIsolatedRoot(path.join(root, 'tmp')));
  assert.throws(() => isolatedPath(root, '../outside'), /leaves/);
  fs.symlinkSync(path.dirname(root), path.join(root, 'escape'));
  assert.throws(() => isolatedPath(root, 'escape/new'), /Symlinks/);
  assert.equal(isolatedPath(root, 'profile/nested'), path.join(root, 'profile/nested'));
});

test('Linux private XDG config is not mistaken for production, whose default and custom paths remain forbidden', () => {
  const home = path.join(root, 'os-account-home');
  const isolated = path.join(root, 'test-instance');
  assert.doesNotThrow(() => assertIsolatedProductionSeparation(isolated, path.join(isolated, 'profile/config'), home, 'linux'));
  for (const name of ['Nodus', 'nodus']) {
    const production = path.join(home, '.config', name);
    assert.throws(() => assertIsolatedProductionSeparation(production, path.join(production, 'profile/config'), home, 'linux'), /overlaps production/);
  }
  assert.throws(() => assertIsolatedProductionSeparation(home, path.join(home, 'profile/config'), home, 'linux'), /overlaps production/);
  const custom = path.join(root, 'custom-config');
  assert.throws(() => assertIsolatedProductionSeparation(path.join(custom, 'Nodus'), custom, home, 'linux'), /overlaps production/);
  assert.throws(() => assertIsolatedProductionSeparation(isolated, path.join(isolated, 'unexpected-config'), home, 'linux'), /overlaps production/);
});

test('environment does not inherit credentials or execution injection', () => {
  const original = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--require=untrusted';
  try {
    const env = researchTestEnvironment(root);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.NODUS_USERDATA, path.join(root, 'profile'));
  } finally {
    if (original === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = original;
  }
});

test('private single-instance lock rejects another owner and releases on close', () => {
  const release = claimIsolatedProfile(root);
  assert.equal(typeof release, 'function');
  assert.equal(claimIsolatedProfile(root), null);
  release();
  const next = claimIsolatedProfile(root);
  assert.equal(typeof next, 'function');
  next();
});

test('macOS denies outside writes, descendant writes and forbidden network connections', { skip: process.platform !== 'darwin' }, () => {
  assert.deepEqual(verifyResearchSandbox(root), { writeInsideAllowed: true, writeOutsideDenied: true, descendantWriteDenied: true, externalNetworkDenied: true, forbiddenLoopbackPortDenied: true });
});


test('explicit disposable endpoints are reachable while all other network destinations are denied', { skip: process.platform !== 'darwin' }, async () => {
  const servers = [net.createServer(socket => socket.destroy()), net.createServer(socket => socket.destroy())];
  try {
    for (const server of servers) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const ports = servers.map(server => server.address().port);
    const policy = macResearchSandbox(root, ports);
    assert.equal(verifyResearchSandbox(root, policy).externalNetworkDenied, true);
    const result = spawnSync('/usr/bin/sandbox-exec', ['-p', policy, process.execPath, '-e',
      `const net=require('node:net');for(const port of JSON.parse(process.argv[1])){const socket=net.createConnection({host:'127.0.0.1',port});socket.once('connect',()=>socket.destroy());socket.once('error',()=>{process.exitCode=1});socket.setTimeout(1000,()=>{socket.destroy();process.exitCode=2})}`, JSON.stringify(ports)],
    { env: researchTestEnvironment(root), encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0, result.stderr);
    assert.throws(() => macResearchSandbox(root, [23119]), /explicit disposable/);
    assert.throws(() => macResearchSandbox(root, ['49100']), /explicit disposable/);
  } finally { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); }
});
