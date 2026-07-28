import { createContext, useCallback, useContext } from 'react';
import { questionOriginKey } from '@shared/worldQuestions';
import { notifyDataChanged } from '../../hooks';
import { toast } from '../feedback';
import { tx } from '../../i18n';

/**
 * Turning a sentence you are writing into a decision you have not taken.
 *
 * This is the thing that makes the whole section usable, and the reason is worth stating:
 * a writer notices what they have not decided WHILE writing, mid-paragraph, and any design
 * that asks them to leave the sheet, open another section and re-type the sentence loses
 * the thought. So the capture happens where the thought is — select the words, one button
 * (or Alt+Q) — and the anchor and the field come from where the caret already was.
 *
 * The anchor rides a context rather than a prop chain because the field that captures is
 * `AutoSavingField`, which is shared by every sheet in the vault: threading an anchor down
 * to two dozen call sites would be the same information written twenty-four times, and the
 * one place it would be forgotten is the sheet added next year.
 */
export interface WorldAnchor {
  kind: string;
  id: string;
  title: string;
}

const WorldAnchorContext = createContext<WorldAnchor | null>(null);

export function WorldAnchorProvider({ anchor, children }: { anchor: WorldAnchor | null; children: React.ReactNode }) {
  return <WorldAnchorContext.Provider value={anchor}>{children}</WorldAnchorContext.Provider>;
}

/** The sheet this field belongs to, or null outside a worldbuilding sheet. */
export function useWorldAnchor(): WorldAnchor | null {
  return useContext(WorldAnchorContext);
}

export function useQuestionCapture(): {
  anchor: WorldAnchor | null;
  capture: (text: string, field?: string) => Promise<void>;
} {
  const anchor = useWorldAnchor();

  const capture = useCallback(
    async (text: string, field?: string) => {
      const question = text.trim();
      if (!question || !anchor) return;
      await window.nodus.ensureQuestion({
        question,
        origin: 'author',
        // Derived from the selection so that capturing the same sentence twice — a
        // double-click, a second thought, the same paragraph re-read a week later — is one
        // decision rather than two rows saying the same thing.
        originKey: questionOriginKey('author', anchor.kind, anchor.id, field ?? '', question.slice(0, 80)),
        anchorKind: anchor.kind,
        anchorId: anchor.id,
        anchorField: field ?? null,
      });
      notifyDataChanged();
      toast(tx('Pregunta abierta guardada sobre {title}.', { title: anchor.title }));
    },
    [anchor]
  );

  return { anchor, capture };
}
