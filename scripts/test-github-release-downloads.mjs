import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  classifyReleaseAsset,
  fetchAllReleases,
  refreshReleaseDownloadStats,
  sumReleaseDownloads,
} from './github-release-downloads.mjs';

function response(body, { status = 200, link = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'link' ? link : null) },
    json: async () => body,
  };
}

test('classifies the supported packages by operating system', () => {
  assert.equal(classifyReleaseAsset('nodus-linux-amd64.deb'), 'linux');
  assert.equal(classifyReleaseAsset('Nodus-x86_64.AppImage'), 'linux');
  assert.equal(classifyReleaseAsset('Nodus-mac-arm64.dmg'), 'macos');
  assert.equal(classifyReleaseAsset('Nodus-mac-arm64.zip'), 'macos');
  assert.equal(classifyReleaseAsset('Nodus-win-x64.exe'), 'windows');
  assert.equal(classifyReleaseAsset('checksums.txt'), null);
});

test('excludes updater metadata and blockmaps before classifying extensions', () => {
  assert.equal(classifyReleaseAsset('latest.yml'), null);
  assert.equal(classifyReleaseAsset('latest-mac.yml'), null);
  assert.equal(classifyReleaseAsset('latest-linux.YML'), null);
  assert.equal(classifyReleaseAsset('Nodus.exe.blockmap'), null);
  assert.equal(classifyReleaseAsset('Nodus.AppImage.blockmap'), null);
});

test('sums several releases, skips drafts and keeps the platform breakdown', () => {
  const counts = sumReleaseDownloads([
    {
      draft: false,
      assets: [
        { name: 'one.deb', download_count: 10 },
        { name: 'one.AppImage', download_count: 20 },
        { name: 'one.dmg', download_count: 30 },
      ],
    },
    {
      draft: false,
      assets: [
        { name: 'two.zip', download_count: 40 },
        { name: 'two.exe', download_count: 50 },
        { name: 'latest.yml', download_count: 999 },
      ],
    },
    { draft: true, assets: [{ name: 'draft.exe', download_count: 1000 }] },
  ]);

  assert.deepEqual(counts, { linux: 30, macos: 70, windows: 50, total: 150 });
});

test('accepts releases without assets', () => {
  assert.deepEqual(sumReleaseDownloads([{ draft: false }, { draft: false, assets: [] }]), {
    linux: 0,
    macos: 0,
    windows: 0,
    total: 0,
  });
});

test('requests every GitHub Releases page with per_page=100', async () => {
  const calls = [];
  const firstPage = Array.from({ length: 100 }, (_, id) => ({ id, assets: [] }));
  const releases = await fetchAllReleases({
    token: 'server-only-test-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return response(firstPage, {
          link: '<https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="last"',
        });
      }
      return response([{ id: 101, assets: [] }]);
    },
  });

  assert.equal(releases.length, 101);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /per_page=100/);
  assert.match(calls[0].url, /page=1/);
  assert.match(calls[1].url, /page=2/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-only-test-token');
});

test('keeps the last valid value when GitHub returns an error', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nodus-release-downloads-'));
  const outputPath = path.join(directory, 'stats.json');
  const previous = {
    linux: 11,
    macos: 22,
    windows: 33,
    total: 66,
    updatedAt: '2026-07-17T03:17:00.000Z',
  };

  try {
    await writeFile(outputPath, `${JSON.stringify(previous, null, 2)}\n`, 'utf8');
    const before = await readFile(outputPath, 'utf8');
    const result = await refreshReleaseDownloadStats({
      outputPath,
      fetchImpl: async () => response({ message: 'temporary failure' }, { status: 503 }),
    });

    assert.equal(result.updated, false);
    assert.equal(result.stale, true);
    assert.deepEqual(result.stats, previous);
    assert.equal(await readFile(outputPath, 'utf8'), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
