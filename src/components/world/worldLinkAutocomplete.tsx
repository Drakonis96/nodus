import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { WorldEntry } from '@shared/types';
import { formatWorldLink, rankEntryCandidates } from '@shared/worldEncyclopedia';
import { Icon } from '../ui';
import { WORLD_ENTRY_KIND_ICON } from '../../views/EncyclopediaView';

/**
 * Typing `[[` offers everything in the world — extracted so the encyclopedia's editor and
 * the manuscript's share one implementation.
 *
 * It was worth extracting rather than copying for a reason beyond tidiness: the tricky part
 * is not the popover, it is that the trigger is found by SCANNING BACKWARDS from the caret
 * instead of reacting to the keystroke, which is what keeps it correct when the author
 * clicks back into a half-written link or pastes over one. A second copy of that would
 * drift, and the drift would only show up in the editor nobody was testing that week.
 *
 * The autocomplete runs entirely against the index the view already loaded, so there is no
 * IPC round-trip per keystroke.
 */
export function useWorldLinkAutocomplete({
  entries,
  value,
  onChange,
  areaRef,
  replaceCandidate,
}: {
  entries: WorldEntry[];
  value: string;
  onChange: (next: string) => void;
  areaRef: RefObject<HTMLTextAreaElement>;
  replaceCandidate?: (entry: WorldEntry, range: { start: number; end: number }) => number;
}) {
  /** Where the open `[[` starts, and what has been typed after it. */
  const [trigger, setTrigger] = useState<{ at: number; fragment: string } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const candidates = useMemo(
    () => (trigger ? rankEntryCandidates(entries, trigger.fragment, 8) : []),
    [entries, trigger]
  );

  useEffect(() => {
    setHighlight(0);
  }, [trigger?.fragment]);

  const sync = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const open = before.lastIndexOf('[[');
    if (open < 0) return setTrigger(null);
    const fragment = before.slice(open + 2);
    // A newline or a closing bracket means the link is over; an unbroken run of prose
    // after `[[` is still being typed.
    if (/[\]\n]/.test(fragment)) return setTrigger(null);
    setTrigger({ at: open, fragment });
  };

  const choose = (entry: WorldEntry) => {
    if (!trigger) return;
    const area = areaRef.current;
    const caret = area?.selectionStart ?? value.length;
    let position: number;
    if (replaceCandidate) {
      position = replaceCandidate(entry, { start: trigger.at, end: caret });
    } else {
      const link = formatWorldLink({ kind: entry.kind, id: entry.id }, entry.title);
      onChange(`${value.slice(0, trigger.at)}${link}${value.slice(caret)}`);
      position = trigger.at + link.length;
    }
    setTrigger(null);
    // The caret has to land after the link or the next word is typed inside it.
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(position, position);
    });
  };

  /** Returns true when the key was consumed, so the caller can stop there. */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!trigger || candidates.length === 0) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (current + 1) % candidates.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => (current - 1 + candidates.length) % candidates.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      choose(candidates[highlight]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setTrigger(null);
    } else {
      return false;
    }
    return true;
  };

  return { trigger, candidates, highlight, sync, choose, handleKeyDown, close: () => setTrigger(null) };
}

export function WorldLinkCandidates({
  candidates,
  highlight,
  onChoose,
  className,
}: {
  candidates: WorldEntry[];
  highlight: number;
  onChoose: (entry: WorldEntry) => void;
  className?: string;
}) {
  if (candidates.length === 0) return null;
  return (
    <ul
      data-testid="entry-link-autocomplete"
      className={`absolute z-20 max-h-64 w-72 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl ${className ?? 'left-2 top-2'}`}
    >
      {candidates.map((entry, index) => (
        <li key={entry.key}>
          <button
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
              index === highlight ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'
            }`}
            // The textarea would lose the caret before the click landed.
            onMouseDown={(event) => {
              event.preventDefault();
              onChoose(entry);
            }}
          >
            <Icon name={WORLD_ENTRY_KIND_ICON[entry.kind]} size={12} className="shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{entry.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
