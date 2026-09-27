// Verify the actual published release, not just a reproducible marketplace source build.
// Archive digests are checked again when prepare-capability-bootstrap downloads the bytes.
export function assertBootstrapVersion(entry, marketplaceVersion, compareSemver) {
  if (entry.version === marketplaceVersion) return;
  // A bootstrap is an offline migration fallback, not a request for the latest catalog
  // version. Marketplace releases and app changes must be able to land independently.
  // Older pins are accepted only alongside the live signature/availability checks below.
  if (!entry.releaseUrl || !entry.assets?.length || compareSemver(entry.version, marketplaceVersion) > 0) {
    throw new Error(`${entry.id}: bootstrap version is ahead of the marketplace or has no published release pin`);
  }
}

export async function verifyPublishedBootstrap(entry, { keys, verifyReleaseManifest, fetcher = fetch }) {
  if (!entry.releaseUrl) return;
  const get = async (name, limit) => {
    const url = `${entry.releaseUrl}/${name}`;
    const response = await fetcher(url, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error(`${name} exceeds its size limit`);
    return bytes;
  };
  const [manifestBytes, signature] = await Promise.all([
    get('release-manifest.json', 256 * 1024), get('release-manifest.sig', 4096),
  ]);
  const release = verifyReleaseManifest(manifestBytes, signature, keys);
  if (release.plugin !== entry.id || release.version !== entry.version) {
    throw new Error(`${entry.id}: published identity/version differs from the bootstrap pin`);
  }
  for (const asset of entry.assets) {
    const signed = release.targets.find(candidate => candidate.target === asset.target);
    if (!signed || signed.asset !== asset.asset || signed.bytes !== asset.bytes || signed.sha256 !== asset.sha256) {
      throw new Error(`${entry.id}/${asset.target}: bootstrap pin differs from the signed release`);
    }
    const url = `${entry.releaseUrl}/${asset.asset}`;
    const response = await fetcher(url, { method: 'HEAD', redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const size = response.headers.get('content-length');
    if (size === null || Number(size) !== asset.bytes) throw new Error(`${asset.asset}: published size differs from the bootstrap pin`);
  }
}
