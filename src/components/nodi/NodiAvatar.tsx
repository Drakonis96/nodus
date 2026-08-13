import { memo, useEffect, useState, type CSSProperties } from 'react';
import type { AppSettings, VaultType } from '@shared/types';
import { orbHue } from '@shared/nodiOrb';
import { Nodi, type NodiRole, type NodiState } from './Nodi';
import { NodiOrb } from './NodiOrb';

/** How long Nodi keeps breathing after the last thing that happened to it. */
const REST_DELAY_MS = 6_000;

/** States in which Nodi has nothing to say and may hold still. */
const QUIESCENT: ReadonlySet<NodiState> = new Set<NodiState>(['idle', 'sleeping']);

/**
 * Whether Nodi may stop animating.
 *
 * Nodi's ambient motion is drawn as SVG, and SVG subtrees do not get their own
 * compositor layer: one animating property repaints the whole figure, filters
 * (`feTurbulence`, `feGaussianBlur`) included, on every frame. Measured on an idle
 * app that costs ~50% CPU permanently — with all the animations running or with
 * only one, it barely differs. The only cheap number of animations is zero, so the
 * lever that works is *when* rather than *how many*.
 *
 * So Nodi animates while something is happening — a real state, an unread
 * notification, a pointer reaching for it — and holds its pose a few seconds after
 * the last of those. `animation-play-state: paused` freezes it mid-keyframe and
 * resumes exactly there, so nothing is lost and no animation is removed.
 */
function useAtRest(
  state: NodiState,
  raiseArm: boolean,
  hovered: boolean,
  reduceMotion: boolean,
  restAfterMs?: number,
): boolean {
  const mayRest = QUIESCENT.has(state) || restAfterMs !== undefined;
  const settled = mayRest && !raiseArm && !hovered;
  const [atRest, setAtRest] = useState(false);
  useEffect(() => {
    if (!settled) {
      setAtRest(false);
      return;
    }
    // A bounded active state starts its allowance again whenever the state changes.
    // This lets an update visibly move from checking to downloading, for example,
    // without leaving a costly SVG repaint running for the lifetime of the modal.
    setAtRest(false);
    // Someone who asked for less motion gets the still pose immediately.
    const delay = reduceMotion ? 0 : restAfterMs ?? REST_DELAY_MS;
    const timer = window.setTimeout(() => setAtRest(true), Math.max(0, delay));
    return () => window.clearTimeout(timer);
  }, [state, settled, reduceMotion, restAfterMs]);
  return atRest;
}

/**
 * Nodi, in whichever shape the user chose: the classic character or the orb. Every
 * surface that draws Nodi renders THIS rather than either one directly, so the choice
 * holds everywhere — companion, tutorial, update and what's-new modals.
 *
 * Props mirror `Nodi`'s, so this is a drop-in replacement. `role` (the per-vault
 * costume) only reaches the classic Nodi: the orb wears its vault as a colour instead.
 */
function NodiAvatarComponent({
  settings,
  state = 'idle',
  role = 'none',
  height = 200,
  draggable = false,
  raiseArm = false,
  restAfterMs,
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
  /** Pause all internal SVG motion after this many milliseconds, even in an active state. */
  restAfterMs?: number;
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

  const [hovered, setHovered] = useState(false);
  const atRest = useAtRest(state, raiseArm, hovered, resolved?.reduceMotion ?? false, restAfterMs);
  // Reaching for Nodi wakes it before the pointer arrives, so it is already moving
  // by the time it is grabbed rather than starting with a jolt.
  const wake = {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
  };
  const classes = [className, atRest ? 'nodi-at-rest' : ''].filter(Boolean).join(' ') || undefined;

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
        className={classes}
        style={style}
        {...wake}
      />
    );
  }
  return (
    <Nodi
      state={state}
      role={role}
      height={height}
      draggable={draggable}
      raiseArm={raiseArm}
      className={classes}
      style={style}
      {...wake}
    />
  );
}

/**
 * Update and release modals may refresh their surrounding copy frequently (download
 * progress is the obvious case). The mascot is a large filtered SVG, so rebuilding
 * its hundreds of nodes for an unrelated percentage change causes noticeable main
 * thread stalls on macOS. Keep it intact unless one of its own props changes.
 */
export const NodiAvatar = memo(NodiAvatarComponent);
