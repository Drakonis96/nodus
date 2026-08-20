import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(repoRoot, 'release');

const expectedByPlatform = {
  mac: ['Nodus-mac-arm64.dmg', 'Nodus-mac-arm64.zip'],
  win: ['Nodus-win-x64.exe'],
  linux: ['Nodus-linux-amd64.deb', 'Nodus-linux-x86_64.AppImage'],
};

const manifestByPlatform = {
  mac: (channel) => `${channel}-mac.yml`,
  win: (channel) => `${channel}.yml`,
  linux: (channel) => `${channel}-linux.yml`,
};

export function selectReleaseAssets(platform, channel, entries) {
  const expected = expectedByPlatform[platform];
  if (!expected) throw new Error(`Unsupported release platform: ${platform}`);
  if (channel !== 'latest' && channel !== 'beta') {
    throw new Error(`Unsupported release channel: ${channel}`);
  }

  const manifest = manifestByPlatform[platform](channel);
  for (const filename of [...expected, manifest]) {
    if (!entries.includes(filename)) throw new Error(`Missing ${platform} release asset: ${filename}`);
  }

  const selected = entries
    .filter((filename) => filename.startsWith('Nodus-') || filename === manifest)
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
