/** Channels understood by electron-builder's generated update manifests. */
export type NodusUpdateChannel = 'latest' | 'beta';

type ChannelAwareUpdater = {
  channel: string | null;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
};

/** A SemVer prerelease always has a hyphen between the patch and its identifier. */
export function isPrereleaseVersion(version: string | null | undefined): boolean {
  return typeof version === 'string' && /^\d+\.\d+\.\d+-[0-9A-Za-z]/.test(version.trim());
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
