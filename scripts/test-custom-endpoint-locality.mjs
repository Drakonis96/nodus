// Where a custom endpoint runs is what its address says.
//
// The completion budget is decided by locality: a cloud provider that has said nothing for
// three minutes is stuck, while a model on the user's own hardware may be mid-chunk with
// nothing wrong. A custom endpoint is the one provider whose locality cannot be read off its
// id, so it is read off the URL the user typed — and this predicate is the whole decision.
//
// Both directions cost something, which is why the list is tested rather than assumed:
// answering "local" for a public address only lengthens a request that would fail anyway,
// while answering "cloud" for the user's own machine is what made a llama.cpp server on the
// same laptop die at 180 seconds on every long extraction chunk (issue #802).
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-custom-locality-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function load(file) {
  const bundle = path.join(dir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(bundle);
}

const { isLocalEndpointAddress } = load('shared/providers.ts');

const LOCAL = [
  // Loopback, in every spelling the URL parser accepts.
  'http://localhost:11434',
  'localhost:8080/v1',
  '  http://localhost:1234/v1  ',
  'http://127.0.0.1:8080/v1',
  'http://127.1:8080',
  'http://2130706433:8080',
  'http://[::1]:8080/v1',
  'http://[0:0:0:0:0:0:0:1]:8080',
  'http://[::ffff:127.0.0.1]:8080',
  // The unspecified address: a server bound to every interface of this machine.
  'http://0.0.0.0:8000/v1',
  'http://[::]:8080',
  // RFC 1918 and link-local.
  'http://10.0.0.7:8317/v1',
  'http://10.1:80',
  'http://172.16.4.9:5000',
  'http://172.31.255.254:5000',
  'http://192.168.1.50:1234/v1',
  'http://0300.0250.0.1:80',
  'http://169.254.10.1:5000',
  // The CGNAT range Tailscale and friends hand out: reachable only on the user's own net.
  'http://100.101.102.103:8080/v1',
  // IPv6 unique-local and link-local.
  'http://[fd00::1]:8080',
  'http://[fe80::1]:8080',
  // Private-network names: mDNS, the IANA private TLDs and MagicDNS.
  'http://llama.local:8080/v1',
  'http://studio.localdomain:1234',
  'http://box.lan:8080',
  'http://gpu.internal:8080',
  'http://nas.home:8080',
  'http://mac.home.arpa:8080',
  'http://srv.ts.net:8080/v1',
  'http://hosting.localhost:8080',
  // Docker Desktop's aliases for the host.
  'http://host.docker.internal:1234/v1',
  'http://gateway.docker.internal:1234',
  'http://host.containers.internal:1234',
];

const REMOTE = [
  'https://api.openai.com/v1',
  'https://openrouter.ai/api/v1',
  'https://api.example.com:443/v1',
  'http://203.0.113.10:8080/v1',
  'http://8.8.8.8:80',
  // One octet outside each private block, and the neighbours of the CGNAT range.
  'http://11.0.0.1:8080',
  'http://172.15.255.255:8080',
  'http://172.32.0.1:8080',
  'http://192.169.0.1:8080',
  'http://100.63.255.255:8080',
  'http://100.128.0.0:8080',
  'http://[2001:db8::1]:8080',
  // A public host is not made local by a word in its name.
  'http://localhost.evil.com:8080',
  'http://notlocalhost:8080',
  'http://evil.com/localhost',
  'http://mybox.local.evil.com:8080',
  'http://host.docker.internal.evil.com:8080',
];

test('every shape of a local address is read as local', () => {
  for (const url of LOCAL) {
    assert.equal(isLocalEndpointAddress(url), true, `${url} runs on the user's own machine or network`);
  }
});

test('a public address is not read as local', () => {
  for (const url of REMOTE) {
    assert.equal(isLocalEndpointAddress(url), false, `${url} is reached over the internet`);
  }
});

test('an address that cannot be read at all falls back to the cloud budget', () => {
  // Guessing "local" here would hold a scan slot open for a request that never had a
  // working address; the request itself fails with its own actionable message.
  for (const value of ['', '   ', null, undefined, 'not a url', 'http://192.168.0.300:80', 'https://[not-ipv6]:8080']) {
    assert.equal(isLocalEndpointAddress(value), false, `${JSON.stringify(value)} names no local host`);
  }
});
