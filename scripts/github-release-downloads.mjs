import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'Drakonis96/nodus';
const DEFAULT_OUTPUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../docs/data/github-release-downloads.json',
);

export function classifyReleaseAsset(name) {
  if (typeof name !== 'string') return null;
  const lower = name.toLowerCase();

  if (/^latest.*\.ya?ml$/i.test(name) || lower.endsWith('.blockmap')) return null;
  if (lower.endsWith('.deb') || lower.endsWith('.appimage')) return 'linux';
  if (lower.endsWith('.dmg') || lower.endsWith('.zip')) return 'macos';
  if (lower.endsWith('.exe')) return 'windows';
  return null;
}

export function sumReleaseDownloads(releases) {
  const counts = { linux: 0, macos: 0, windows: 0, total: 0 };

  for (const release of Array.isArray(releases) ? releases : []) {
    if (!release || release.draft) continue;
    // GitHub's automatic source archives are links outside `assets`, so they
    // never enter this loop. Only explicitly uploaded release packages do.
    for (const asset of Array.isArray(release.assets) ? release.assets : []) {
      const platform = classifyReleaseAsset(asset?.name);
      const downloads = Number(asset?.download_count);
      if (!platform || !Number.isFinite(downloads) || downloads < 0) continue;
      counts[platform] += downloads;
      counts.total += downloads;
    }
  }

  return counts;
}

function hasNextPage(linkHeader) {
  return typeof linkHeader === 'string'
    && linkHeader.split(',').some((part) => /rel="next"/.test(part));
}

export async function fetchAllReleases({ fetchImpl = fetch, token = process.env.GITHUB_TOKEN } = {}) {
  const releases = [];

  for (let page = 1; page <= 1000; page += 1) {
    const url = new URL(`https://api.github.com/repos/${REPOSITORY}/releases`);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));

    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nodus-release-download-counter',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetchImpl(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub Releases request failed (${response.status}) on page ${page}`);
    }

    const pageReleases = await response.json();
    if (!Array.isArray(pageReleases)) throw new Error(`Invalid GitHub response on page ${page}`);
    releases.push(...pageReleases);

    const link = response.headers?.get?.('link') || '';
    if (!hasNextPage(link) && (link || pageReleases.length < 100)) return releases;
  }

  throw new Error('GitHub Releases pagination exceeded 1000 pages');
}

function isValidStats(value) {
  return value
    && ['linux', 'macos', 'windows', 'total'].every(
      (key) => Number.isFinite(value[key]) && value[key] >= 0,
    )
    && typeof value.updatedAt === 'string';
}

async function readLastValidStats(outputPath) {
  try {
    const value = JSON.parse(await readFile(outputPath, 'utf8'));
    return isValidStats(value) ? value : null;
  } catch {
    return null;
  }
}

export async function refreshReleaseDownloadStats({
  fetchImpl = fetch,
  token = process.env.GITHUB_TOKEN,
  outputPath = DEFAULT_OUTPUT,
  now = () => new Date(),
} = {}) {
  try {
    const releases = await fetchAllReleases({ fetchImpl, token });
    const stats = { ...sumReleaseDownloads(releases), updatedAt: now().toISOString() };
    await mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, outputPath);
    return { stats, updated: true, stale: false };
  } catch (error) {
    const stats = await readLastValidStats(outputPath);
    if (!stats) throw error;
    return { stats, updated: false, stale: true, error };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await refreshReleaseDownloadStats();
  if (result.stale) {
    console.warn(`GitHub unavailable; keeping release download stats from ${result.stats.updatedAt}`);
  } else {
    console.log(`Stored ${result.stats.total} package downloads from GitHub Releases`);
  }
}
