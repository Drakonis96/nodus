// Publish a COPY of a real vault to a local Nodus Server, so the iOS app can be driven
// against something with actual shape to it.
//
// A fixture proves the envelope; it does not prove that a 496 MB academic corpus paginates,
// that a genealogy vault's portraits come down by hash, or that a worldbuilding vault's
// tables have no REST collection at all. Those only show up against real data.
//
// Two rules this script does not bend, both of them scars:
//
//   • The original vault is never opened. It is copied first, and everything happens on the
//     copy. Running a branch's code against a real vault is how a real vault gets corrupted.
//   • The isolated profile is never called `nodus`. A test profile with that name once
//     shadowed the real installation and took its stored API keys with it.
//
// Usage:
//   node scripts/ios-lab-publish.mjs --vault Principal
//   node scripts/ios-lab-publish.mjs --all
//   node scripts/ios-lab-publish.mjs --list
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// better-sqlite3 in this repo is built against Electron's ABI, not the system Node's, so
// reading a vault from plain `node` fails with a NODE_MODULE_VERSION mismatch.
//
// `requireElectronRuntime` in lib/tsRuntimeHooks.mjs does this re-exec too, but it passes only
// the script and its flag — which silently drops `--vault Franquismo` and turns the run into a
// bare listing. This script takes arguments, so it forwards them.
if (!process.argv.includes('--electron-lab')) {
  const { execFileSync } = require('node:child_process');
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/ios-lab-publish.mjs'), '--electron-lab', ...process.argv.slice(2)],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const ORIGIN = (flag('url', process.env.NODUS_LAB_URL || 'http://127.0.0.1:7443')).replace(/\/+$/, '');
const ADMIN_EMAIL = flag('admin-email', process.env.NODUS_LAB_ADMIN_EMAIL || 'admin@nodus.test');
const ADMIN_PASSWORD = flag('admin-password', process.env.NODUS_LAB_ADMIN_PASSWORD || 'ios-lab-password-2026-long');
const READER = { email: 'lector@nodus.test', password: 'ios-lab-reader-password-2026' };
const WRITER = { email: 'escritor@nodus.test', password: 'ios-lab-writer-password-2026' };

// Where the desktop keeps its registry. Read only, and only to find the paths.
const USER_DATA = process.env.NODUS_LAB_USERDATA
  || path.join(os.homedir(), 'Library', 'Application Support', 'nodus');
const REGISTRY = path.join(USER_DATA, 'vaults.json');

function readRegistry() {
  if (!fs.existsSync(REGISTRY)) {
    throw new Error(`No vault registry at ${REGISTRY}. Set NODUS_LAB_USERDATA.`);
  }
  const parsed = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  return (parsed.vaults ?? []).filter((vault) => fs.existsSync(vault.path));
}

// ── The isolated profile ─────────────────────────────────────────────────────
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ios-lab-'));
installRuntimeHooks(PROFILE);

const { buildServerSnapshot } = require(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'));
const { buildVectorSet, describeVectorSet } = require(path.join(repoRoot, 'electron/serverSync/serverVectors.ts'));
const Database = require('better-sqlite3');

// ── The web admin, driven through its real forms ─────────────────────────────
let adminCookie = null;

async function postForm(pathname, fields, cookie = adminCookie) {
  const body = new URLSearchParams(fields).toString();
  return fetch(`${ORIGIN}${pathname}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
    },
    body,
  });
}

async function signInAsAdmin() {
  const response = await postForm('/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, next: '/' }, null);
  if (response.status !== 303) {
    throw new Error(`Admin sign-in failed (${response.status}). Check --admin-email/--admin-password.`);
  }
  const raw = response.headers.get('set-cookie') ?? '';
  adminCookie = raw.split(';')[0];
  return adminCookie;
}

async function dashboard() {
  const response = await fetch(`${ORIGIN}/`, { headers: { cookie: adminCookie } });
  if (response.status !== 200) throw new Error(`Dashboard unavailable (${response.status})`);
  return response.text();
}

async function csrf() {
  const html = await dashboard();
  const match = html.match(/name="csrf"\s+value="([^"]+)"/);
  if (!match) throw new Error('No CSRF token on the dashboard');
  return match[1];
}

async function spaceIds() {
  return [...(await dashboard()).matchAll(/<code>([0-9a-f-]{36})<\/code>/g)].map((match) => match[1]);
}

async function createSpace(name) {
  const before = new Set(await spaceIds());
  const response = await postForm('/admin/spaces', { csrf: await csrf(), name });
  if (response.status !== 303) throw new Error(`Space "${name}" was not created (${response.status})`);
  const created = (await spaceIds()).find((id) => !before.has(id));
  if (!created) throw new Error(`Space "${name}" was not created`);
  return created;
}

/** The user table, so an account created on an earlier run can be found again. */
async function findUserId(email) {
  const html = await dashboard();
  const row = html.match(new RegExp(`<strong>${email.replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&')}</strong>[\\s\\S]*?name="userId" value="([^"]+)"`));
  return row ? row[1] : null;
}

/**
 * Create the account once, then grant it one space at a time.
 *
 * `POST /admin/users` sets the memberships it is given, so re-posting the same account for each
 * new space *replaced* its access instead of adding to it: after publishing eight vaults the
 * reader could reach exactly one of them. Grants have their own endpoint, and it accumulates.
 */
async function ensureUser({ email, password }, grants) {
  let userId = await findUserId(email);

  if (!userId) {
    const fields = { csrf: await csrf(), email, password };
    for (const grant of grants) {
      fields[`space:${grant.spaceId}`] = 'on';
      fields[`role:${grant.spaceId}`] = grant.role;
    }
    const response = await postForm('/admin/users', fields);
    if (response.status !== 303) {
      console.warn(`  ! could not create ${email} (${response.status})`);
      return;
    }
    userId = await findUserId(email);
    return;
  }

  for (const grant of grants) {
    const response = await postForm('/admin/access/grant', {
      csrf: await csrf(),
      userId,
      spaceId: grant.spaceId,
      role: grant.role,
    });
    if (response.status !== 303) {
      console.warn(`  ! could not grant ${email} ${grant.role} on ${grant.spaceId} (${response.status})`);
    }
  }
}

async function deviceToken(email, password, spaceId, deviceName) {
  const login = await fetch(`${ORIGIN}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (login.status !== 200) throw new Error(`API login failed for ${email} (${login.status})`);
  const session = await login.json();
  const device = await fetch(`${ORIGIN}/api/v1/auth/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket: session.ticket, spaceId, deviceName }),
  });
  if (device.status !== 200) throw new Error(`Device token refused for ${email} (${device.status})`);
  return (await device.json()).deviceToken;
}

// ── Copy, build, publish ─────────────────────────────────────────────────────

/** Copy the vault and its WAL sidecars. The original is never opened. */
function copyVault(vault) {
  const target = path.join(PROFILE, 'vaults', vault.id);
  fs.mkdirSync(target, { recursive: true });
  const destination = path.join(target, 'nodus.sqlite');
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${vault.path}${suffix}`;
    if (fs.existsSync(source)) fs.copyFileSync(source, `${destination}${suffix}`);
  }
  return destination;
}

async function publishVault(vault, spaceName) {
  const label = `${vault.name} (${vault.type})`;
  console.log(`\n▸ ${label}`);

  const copy = copyVault(vault);
  const bytes = fs.statSync(copy).size;
  console.log(`  copied ${(bytes / 1024 / 1024).toFixed(1)} MB to the lab profile`);

  const db = new Database(copy);
  let snapshot;
  let vectors = [];
  try {
    snapshot = buildServerSnapshot(
      { id: vault.id, name: vault.name, type: vault.type },
      // Both switches on: the point of the lab is to exercise everything the app can read,
      // including notes and passages, which are what the writing and semantic screens live on.
      { nodusServerIncludeUserContent: true, nodusServerIncludePassages: true },
      db,
    );
    for (const kind of ['ideas', 'passages']) {
      const summary = describeVectorSet(db, kind);
      if (!summary) continue;
      const built = buildVectorSet(db, kind);
      if (built) vectors.push({ kind, ...built });
    }
  } finally {
    db.close();
  }

  const populated = Object.entries(snapshot.counts).filter(([, count]) => count > 0);
  console.log(`  snapshot ${(snapshot.buffer.length / 1024 / 1024).toFixed(1)} MB · ${populated.length} tables · ${snapshot.assets.length} images`);

  const spaceId = await createSpace(spaceName ?? vault.name);
  const ownerToken = await deviceToken(ADMIN_EMAIL, ADMIN_PASSWORD, spaceId, 'iOS lab owner');

  const gzipped = gzipSync(snapshot.buffer);
  const published = await fetch(`${ORIGIN}/api/v1/spaces/${spaceId}/snapshot`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${ownerToken}`,
      'content-type': 'application/vnd.nodus.snapshot+json',
      'content-encoding': 'gzip',
      'x-nodus-revision': snapshot.revision,
    },
    body: gzipped,
  });
  const result = await published.json();
  if (published.status !== 200) {
    throw new Error(`Publish refused (${published.status}): ${JSON.stringify(result)}`);
  }
  console.log(`  published ${(gzipped.length / 1024 / 1024).toFixed(1)} MB gzipped → space ${spaceId}`);

  // Images: negotiate first so a re-run uploads nothing.
  if (snapshot.assets.length) {
    const negotiated = await fetch(`${ORIGIN}/api/v1/spaces/${spaceId}/assets/negotiate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ assets: snapshot.assets.map((asset) => ({ hash: asset.hash, bytes: asset.bytes })) }),
    });
    const missing = new Set((await negotiated.json()).missing ?? []);
    let uploaded = 0;
    for (const asset of snapshot.assets) {
      if (!missing.has(asset.hash)) continue;
      const response = await fetch(`${ORIGIN}/api/v1/spaces/${spaceId}/assets/${asset.hash}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/octet-stream' },
        body: asset.data,
      });
      if (response.status === 200) uploaded += 1;
      else console.warn(`  ! image ${asset.hash.slice(0, 8)} refused (${response.status})`);
    }
    console.log(`  images: ${uploaded} uploaded, ${snapshot.assets.length - uploaded} already present`);
  }

  for (const set of vectors) {
    const response = await fetch(`${ORIGIN}/api/v1/spaces/${spaceId}/vectors?kind=${set.kind}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/vnd.nodus.vectors',
        'content-encoding': 'gzip',
      },
      body: gzipSync(set.buffer),
    });
    const body = await response.json();
    if (response.status === 200) {
      console.log(`  vectors[${set.kind}]: ${body.count} × ${body.dim} · ${body.provider}/${body.model}`);
    } else {
      console.warn(`  ! vectors[${set.kind}] refused (${response.status}): ${JSON.stringify(body)}`);
    }
  }
  if (!vectors.length) {
    console.log('  vectors: none published — semantic search will fall back to lexical, which is itself worth testing');
  }

  await ensureUser(READER, [{ spaceId, role: 'reader' }]);
  await ensureUser(WRITER, [{ spaceId, role: 'writer' }]);

  return {
    space: spaceId,
    name: spaceName ?? vault.name,
    vault: vault.type,
    tables: populated.length,
    rows: populated.reduce((total, [, count]) => total + count, 0),
    assets: snapshot.assets.length,
    vectors: vectors.map((set) => set.kind),
  };
}

// ── Entry ────────────────────────────────────────────────────────────────────
async function main() {
  const registry = readRegistry();

  if (has('list') || (!has('all') && !flag('vault'))) {
    console.log(`Vaults in ${REGISTRY}:\n`);
    for (const vault of registry) {
      const size = (fs.statSync(vault.path).size / 1024 / 1024).toFixed(1);
      console.log(`  ${vault.type.padEnd(16)} ${vault.name.padEnd(28)} ${size.padStart(8)} MB`);
    }
    console.log('\nPublish one:  node scripts/ios-lab-publish.mjs --vault "Principal"');
    console.log('Publish all:  node scripts/ios-lab-publish.mjs --all');
    return;
  }

  const wanted = has('all')
    ? registry
    : registry.filter((vault) => vault.name === flag('vault') || vault.id === flag('vault'));
  if (!wanted.length) throw new Error(`No vault named "${flag('vault')}". Run with --list.`);

  await signInAsAdmin();
  console.log(`Signed in to ${ORIGIN} as ${ADMIN_EMAIL}`);

  const published = [];
  for (const vault of wanted) {
    try {
      published.push(await publishVault(vault, flag('space-name')));
    } catch (error) {
      console.error(`  ✗ ${vault.name}: ${error.message}`);
    }
  }

  console.log('\n── Published ──');
  for (const entry of published) {
    console.log(`  ${entry.space}  ${entry.name} (${entry.vault})  ${entry.rows} rows in ${entry.tables} tables`);
  }
  console.log('\nAccounts');
  console.log(`  owner   ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  writer  ${WRITER.email} / ${WRITER.password}`);
  console.log(`  reader  ${READER.email} / ${READER.password}`);
  console.log(`\nLab profile (delete when done): ${PROFILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
