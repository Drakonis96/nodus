import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { WorldFinding } from '@shared/types';
import { countBySeverity, findingsFor } from '@shared/worldFindings';
import { Icon } from '../ui';
import { useDataRefresh } from '../../hooks';
import { t, tx } from '../../i18n';

/**
 * The continuity findings, loaded once and shared by every sheet on screen.
 *
 * The badge is deliberately built BEFORE the section in the menu: it is the same pure
 * function over the same array, it is half the value, and it puts the contradiction where
 * the writer already is instead of behind a door they have to remember to open.
 *
 * A context rather than a fetch per badge, because five sheets asking for the same
 * ten-query snapshot is five snapshots — and the badge would then be the most expensive
 * thing on a character sheet.
 */
const FindingsContext = createContext<{ findings: WorldFinding[]; reload: () => Promise<void> } | null>(null);

/**
 * The views that can actually show a finding.
 *
 * Recomputing anywhere else is main-process work nobody will look at — and on the map,
 * which drives a live Leaflet canvas, ten queries arriving mid-gesture is work competing
 * with the thing the writer is doing.
 */
export const CONTINUITY_VIEWS = new Set(['continuity', 'conflicts', 'rules', 'characters', 'places', 'factions', 'cultures', 'scenes', 'encyclopedia']);

export function ContinuityProvider({
  children,
  enabled,
  revision,
}: {
  children: React.ReactNode;
  /** Only a worldbuilding vault has any of this. Elsewhere the provider is a pass-through
   *  and, crucially, never runs the ten queries. */
  enabled: boolean;
  /**
   * Anything whose change should re-run the checks — in practice the current view.
   *
   * Without it the snapshot is taken once when the app mounts and never again: a writer
   * would edit scenes, walk to a character sheet, and be shown a badge computed before
   * their edits. The section-level edits do not go through `notifyDataChanged`, so the
   * navigation IS the signal, and it costs ten queries only in a worldbuilding vault.
   */
  revision?: string;
}) {
  const [findings, setFindings] = useState<WorldFinding[]>([]);

  const reload = useCallback(async () => {
    setFindings(enabled ? await window.nodus.runWorldContinuity() : []);
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload, revision]);
  useDataRefresh(reload);

  const value = useMemo(() => ({ findings, reload }), [findings, reload]);
  return <FindingsContext.Provider value={value}>{children}</FindingsContext.Provider>;
}

export function useContinuity(): { findings: WorldFinding[]; reload: () => Promise<void> } {
  return useContext(FindingsContext) ?? { findings: [], reload: async () => {} };
}

/** Resolve a finding's text. The key/vars split is what keeps it out of Spanish-only. */
export function findingText(text: { key: string; vars?: Record<string, string> } | null): string {
  if (!text) return '';
  return text.vars ? tx(text.key, text.vars) : t(text.key);
}

/**
 * What is wrong with this entity, on its own sheet.
 *
 * Silent when there is nothing — a badge that says "0 contradicciones" trains the eye to
 * stop reading the place where the real ones will appear.
 */
export function ContinuityBadge({
  entity,
  onOpen,
}: {
  entity: { kind: string; id: string };
  onOpen?: (findings: WorldFinding[]) => void;
}) {
  const { findings } = useContinuity();
  const mine = useMemo(() => findingsFor(entity, findings), [entity, findings]);
  const [open, setOpen] = useState(false);
  if (mine.length === 0) return null;

  const counts = countBySeverity(mine);
  const serious = counts.contradiction > 0;

  return (
    <div data-testid="continuity-badge" className="rounded-lg border border-amber-800/60 bg-amber-950/10 p-2">
      <button
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => {
          setOpen((current) => !current);
          onOpen?.(mine);
        }}
      >
        <Icon name={serious ? 'alert' : 'info'} size={13} className={serious ? 'text-red-400' : 'text-amber-400'} />
        <span className={`text-xs ${serious ? 'text-red-300' : 'text-amber-300'}`}>
          {counts.contradiction > 0
            ? tx('{count} contradicciones', { count: String(counts.contradiction) })
            : tx('{count} avisos de continuidad', { count: String(counts.warning + counts.gap) })}
        </span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="ml-auto text-neutral-500" />
      </button>
      {open && (
        <ul className="mt-1 space-y-1">
          {mine.map((finding) => (
            <li key={finding.fingerprint} className="text-[11px] leading-4 text-neutral-300">
              · {findingText(finding.headline)}
              {finding.detail && (
                <span className="block pl-2 text-[10px] text-neutral-500">{findingText(finding.detail)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
