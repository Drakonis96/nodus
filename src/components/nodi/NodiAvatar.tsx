import { useEffect, useState, type CSSProperties } from 'react';
import type { AppSettings, VaultType } from '@shared/types';
import { orbHue } from '@shared/nodiOrb';
import { Nodi, type NodiRole, type NodiState } from './Nodi';
import { NodiOrb } from './NodiOrb';

/**
 * Nodi, in whichever shape the user chose: the classic character or the orb. Every
 * surface that draws Nodi renders THIS rather than either one directly, so the choice
 * holds everywhere — companion, tutorial, update and what's-new modals.
 *
 * Props mirror `Nodi`'s, so this is a drop-in replacement. `role` (the per-vault
 * costume) only reaches the classic Nodi: the orb wears its vault as a colour instead.
 */
export function NodiAvatar({
  settings,
  state = 'idle',
  role = 'none',
  height = 200,
  draggable = false,
  raiseArm = false,
  className,
  style,
}: {
  /**
   * The app's settings when the caller already holds them (the app tree prop-drills
   * them from App.tsx). Pass `null` while they load. Omit entirely — as the standalone
   * always-on-top overlay window must, living outside that tree — to self-subscribe.
   */
  settings?: AppSettings | null;
  state?: NodiState;
  role?: NodiRole;
  height?: number;
  draggable?: boolean;
  raiseArm?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const selfFetch = settings === undefined;
  const [fetched, setFetched] = useState<AppSettings | null>(null);
  useEffect(() => {
    if (!selfFetch) return;
    window.nodus.getSettings().then(setFetched).catch(() => {});
    return window.nodus.onSettingsChanged(setFetched);
  }, [selfFetch]);
  const resolved = selfFetch ? fetched : settings;

  // The orb's colour can follow the active vault, so it has to know which one is open
  // even on surfaces that otherwise don't care.
  const [vaultType, setVaultType] = useState<VaultType | null>(null);
  useEffect(() => {
    window.nodus.getActiveVault().then((vault) => setVaultType(vault?.type ?? null)).catch(() => {});
    return window.nodus.onVaultChanged((vault) => setVaultType(vault?.type ?? null));
  }, []);

  // Until the settings land we can't know which Nodi to draw. Hold the space rather
  // than guessing: drawing the classic one first would flash and swap for orb users.
  if (!resolved) return <span aria-hidden="true" style={{ display: 'block', height, width: height * 0.9 }} />;

  if (resolved.mascotStyle === 'orb') {
    return (
      <NodiOrb
        state={state}
        hue={orbHue(resolved, vaultType)}
        height={height}
        draggable={draggable}
        raiseArm={raiseArm}
        className={className}
        style={style}
      />
    );
  }
  return <Nodi state={state} role={role} height={height} draggable={draggable} raiseArm={raiseArm} className={className} style={style} />;
}
