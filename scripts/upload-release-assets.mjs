import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(repoRoot, 'release');

// macOS is built twice, once per architecture and each on a host of its own
// architecture, so it uploads under two platform keys. Every other platform is
// a single runner producing a single set of files.
const expectedByPlatform = {
  'mac-arm64': ['Nodus-mac-arm64.dmg', 'Nodus-mac-arm64.zip'],
  'mac-x64': ['Nodus-mac-x64.dmg', 'Nodus-mac-x64.zip'],
  win: ['Nodus-win-x64.exe'],
  linux: ['Nodus-linux-amd64.deb', 'Nodus-linux-x86_64.AppImage'],
};

// Only files under this prefix belong to this runner. Without it a macOS runner
// that somehow ended up holding both architectures would upload the other one's
// artifacts too, and the two jobs would race over the same release assets.
const prefixByPlatform = {
  'mac-arm64': 'Nodus-mac-arm64',
  'mac-x64': 'Nodus-mac-x64',
  win: 'Nodus-win',
  linux: 'Nodus-linux',
};

const manifestByPlatform = {
  'mac-arm64': (channel) => `${channel}-mac.yml`,
  'mac-x64': (channel) => `${channel}-mac.yml`,
  win: (channel) => `${channel}.yml`,
  linux: (channel) => `${channel}-linux.yml`,
};

// Both macOS runners write a <channel>-mac.yml that lists only their own files,
// so neither may upload it: whichever finished last would win and leave the
// other architecture either unable to update at all or quietly updating itself
// to the wrong build. They hand their manifest to the merge job instead, which
// publishes the single combined file. See merge-mac-update-manifest.mjs.
const publishesManifest = (platform) => !platform.startsWith('mac-');

export function selectReleaseAssets(platform, channel, entries) {
  const expected = expectedByPlatform[platform];
  if (!expected) throw new Error(`Unsupported release platform: ${platform}`);
  if (channel !== 'latest' && channel !== 'beta') {
    throw new Error(`Unsupported release channel: ${channel}`);
  }

  // The manifest must exist even when this job does not publish it: its absence
  // means electron-builder did not produce update metadata for this build.
  const manifest = manifestByPlatform[platform](channel);
  for (const filename of [...expected, manifest]) {
    if (!entries.includes(filename)) throw new Error(`Missing ${platform} release asset: ${filename}`);
  }

  const prefix = prefixByPlatform[platform];
  const selected = entries
    .filter((filename) => filename.startsWith(prefix) || (publishesManifest(platform) && filename === manifest))
    .sort();
  if (selected.length === 0) throw new Error(`No ${platform} release assets found`);
  return selected;
}

export function uploadReleaseAssets({ platform, channel, tag, repository }) {
  const entries = readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const assets = selectReleaseAssets(platform, channel, entries)
    .map((filename) => path.join(releaseDir, filename));

  execFileSync('gh', [
    'release', 'upload', tag,
    ...assets,
    '--repo', repository,
    '--clobber',
  ], { cwd: repoRoot, stdio: 'inherit' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  uploadReleaseAssets({
    platform: process.argv[2],
    channel: process.env.NODUS_RELEASE_CHANNEL,
    tag: process.env.RELEASE_TAG,
    repository: process.env.GITHUB_REPOSITORY,
  });
}
