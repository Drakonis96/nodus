import type { NodiStyle } from '@shared/types';
import { Nodi } from './Nodi';
import { NodiOrb } from './NodiOrb';
import './nodiStyle.css';

export type NodiStylePickerLabels = {
  classicTitle: string;
  classicBody: string;
  orbTitle: string;
  orbBody: string;
};

/**
 * The two Nodi side by side, each alive in its own card, for the user to pick from.
 * Shared by the three places the choice is offered: the cinematic tutorial, the
 * one-time modal for users who already saw that tutorial, and Settings.
 *
 * Labels are passed in rather than translated here: the tutorial speaks twelve
 * languages from its own tables, while Settings and the modal go through `t()`.
 */
export function NodiStylePicker({
  labels,
  value,
  orbHue,
  height = 150,
  onPick,
}: {
  labels: NodiStylePickerLabels;
  /** Marks one card as the current choice. Omit when there is no choice yet. */
  value?: NodiStyle;
  /** Preview the orb in this hue; defaults to Nodi's own blue. */
  orbHue?: number;
  height?: number;
  onPick: (style: NodiStyle) => void;
}) {
  return (
    <div className="nodi-style-grid">
      <button
        type="button"
        data-testid="nodi-style-classic"
        className={`nodi-style-option${value === 'classic' ? ' selected' : ''}`}
        aria-pressed={value === undefined ? undefined : value === 'classic'}
        onClick={() => onPick('classic')}
      >
        <span className="nodi-style-figure">
          <Nodi state="waving" height={height} />
        </span>
        <b>{labels.classicTitle}</b>
        <span className="nodi-style-body">{labels.classicBody}</span>
      </button>
      <button
        type="button"
        data-testid="nodi-style-orb"
        className={`nodi-style-option${value === 'orb' ? ' selected' : ''}`}
        aria-pressed={value === undefined ? undefined : value === 'orb'}
        onClick={() => onPick('orb')}
      >
        <span className="nodi-style-figure">
          <NodiOrb state="idle" hue={orbHue} height={height} />
        </span>
        <b>{labels.orbTitle}</b>
        <span className="nodi-style-body">{labels.orbBody}</span>
      </button>
    </div>
  );
}
