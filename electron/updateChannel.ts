/** Channels understood by electron-builder's generated update manifests. */
export type NodusUpdateChannel = 'latest' | 'beta';

type ChannelAwareUpdater = {
  channel: string | null;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
};

type UpdateCheckLike = {
  isUpdateAvailable?: boolean;
  updateInfo?: { version?: unknown };
} | null | undefined;

/** A SemVer prerelease always has a hyphen between the patch and its identifier. */
export function isPrereleaseVersion(version: string | null | undefined): boolean {
  return typeof version === 'string' && /^\d+\.\d+\.\d+-[0-9A-Za-z]/.test(version.trim());
}

/**
 * Only surface candidates that electron-updater has already accepted as newer.
 * Its result still contains updateInfo when a feed version was rejected (for
 * example stable 5.1.2 while running 5.1.3-beta.4), so comparing strings alone
 * would turn a correctly rejected downgrade into a false update prompt.
 */
export function availableUpdateVersion(result: UpdateCheckLike, currentVersion: string): string | null {
  if (result?.isUpdateAvailable !== true) return null;
  const version = result.updateInfo?.version;
  if (typeof version !== 'string' || version.trim() === '' || version === currentVersion) return null;
  return version;
}

/**
 * Apply the user's update preference without inheriting electron-updater's
 * implicit downgrade behaviour. Setting either `channel` or `allowPrerelease`
 * can turn `allowDowngrade` on, so the explicit false assignment must be last.
 */
export function applyUpdateChannel(updater: ChannelAwareUpdater, betaUpdates: boolean): NodusUpdateChannel {
  const channel: NodusUpdateChannel = betaUpdates ? 'beta' : 'latest';
  updater.channel = channel;
  updater.allowPrerelease = betaUpdates;
  updater.allowDowngrade = false;
  return channel;
}
