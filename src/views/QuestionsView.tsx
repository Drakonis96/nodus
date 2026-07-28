import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorldQuestionFeedItem, WorldQuestionOption } from '@shared/types';
import { WORLD_LINK_FIELD_LABEL } from '@shared/worldEncyclopedia';
import {
  WORLD_APPLY_MODE_LABEL,
  WORLD_PLACEHOLDER_TOKENS,
  WORLD_QUESTION_ORIGIN_LABEL,
  WORLD_QUESTION_STATUS_LABEL,
  WORLD_QUESTION_URGENCY_LABEL,
} from '@shared/worldQuestions';
import type { View } from '../navigation';
import type { WorldSectionDef } from '../components/world/WorldWorkspace';
import { WorldWorkspace } from '../components/world/WorldWorkspace';
import { Icon } from '../components/ui';
import { confirm, toast } from '../components/feedback';
import { PERSON_DOSSIER_SECTION_CLASS } from '../components/personDossierLayout';
import { notifyDataChanged } from '../hooks';
import { t, tx } from '../i18n';

/** Where an anchor's own section lives, so a decision is one click from what it is about. */
const SECTION_OF_KIND: Record<string, View> = {
  character: 'characters',
  place: 'places',
  group: 'factions',
  scene: 'scenes',
  article: 'encyclopedia',
  map: 'map',
  rule: 'rules',
  conflict: 'conflicts',
};

function fieldLabel(field: string | null): string {
  if (!field) return '';
  return t(WORLD_LINK_FIELD_LABEL[field] ?? field);
}

/**
 * Preguntas abiertas: the decisions this world has not taken yet.
 *
 * The smallest of the five sections on purpose. A question about an invented world is not a
 * to-do item — it is A WRITE THAT HAS NOT HAPPENED — so an option is never a bullet: it
 * carries a destination, the destination is inferred from where the question was captured,
 * and the button says out loud what it is about to write before it writes it.
 *
 * Two origins and no more: what the author typed, and the holes they left in their own
 * prose. Everything else that looks like an open question (a red link, an arc with a hole,
 * a contradiction) belongs to the section that owns those facts and arrives here through a
 * button there. A second list of the same problems is a dismissal that stays alive
 * somewhere else, and nobody ever finds out which of the two is the real one.
 */
/** The origin key first: a derived hole gets a row the moment it is touched, and keying on
 *  the id would make the sheet slam shut mid-edit as the item acquires a new identity. */
function questionId(item: WorldQuestionFeedItem): string {
  return item.originKey ?? item.questionId ?? item.question;
}

function questionsSection(
  settled: boolean,
  onToggleSettled: () => void,
  /** What has been answered while this screen has been open. */
  kept: React.MutableRefObject<Set<string>>,
  onNavigate?: (view: View) => void
): WorldSectionDef<WorldQuestionFeedItem> {
  return {
    id: 'questions',
    icon: 'help',
    title: 'Preguntas abiertas',
    searchPlaceholder: 'Buscar entre las decisiones…',
    createLabel: 'Nueva pregunta',
    // A LITERAL, never a ternary: the i18n collector reads what follows `emptyLabel:`, so
    // a conditional here would ship both strings in Spanish in the other six languages.
    // The other reading says its own thing through EmptyState, which calls t() directly.
    emptyLabel: 'No queda nada por decidir: ni preguntas tuyas, ni huecos (???, TBD, XXX, […]) en tu prosa.',
    noMatchLabel: 'Ninguna decisión coincide con el filtro.',
    presentation: 'list',
    // Already ranked by the repo: what blocks you, then what the story reaches soonest,
    // then what the most of your world hangs off.
    //
    // Plus whatever was answered WHILE THIS SCREEN HAS BEEN OPEN. Without that a decision
    // vanishes the instant it is taken — no confirmation of what was written, and no undo
    // to reach for, which is exactly the moment somebody wants one. It leaves on the next
    // visit, not on the click.
    load: async () => {
      const open = await window.nodus.questionFeed(settled);
      if (settled || kept.current.size === 0) return open;
      const shown = new Set(open.map(questionId));
      const all = await window.nodus.questionFeed(true);
      return [...open, ...all.filter((item) => kept.current.has(questionId(item)) && !shown.has(questionId(item)))];
    },
    idOf: questionId,
    labelOf: (item) => item.question,
    facets: [
      { id: 'anchor', label: 'Sobre', source: 'distinct' },
      // A switch, not a priority scale. A scale is a field the author sets once, never
      // revisits, and then cannot trust.
      {
        id: 'blocking',
        label: 'Me bloquea',
        source: 'vocabulary',
        vocabulary: [{ id: 'yes', label: WORLD_QUESTION_URGENCY_LABEL.blocking }],
      },
    ],
    facetValues: (item) => ({
      anchor: item.anchor?.title ?? null,
      blocking: item.blocking ? 'yes' : null,
    }),
    searchText: (item) => [item.question, item.evidence ?? '', item.anchor?.title ?? ''],
    Card: QuestionRow,
    Sheet: ({ item, onChanged, onBack }) => (
      <QuestionSheet
        item={item}
        onChanged={onChanged}
        onBack={onBack}
        onAnswered={() => kept.current.add(questionId(item))}
        onNavigate={onNavigate}
      />
    ),
    EmptyState: settled ? NothingDecided : undefined,
    HeaderActions: () => (
      <button
        className="btn btn-ghost h-9 gap-1.5 border border-neutral-300 dark:border-neutral-700 px-2 text-xs"
        data-testid="questions-settled-toggle"
        onClick={onToggleSettled}
      >
        <Icon name={settled ? 'help' : 'check'} size={14} />
        {t(settled ? 'Volver a lo que falta' : 'Decisiones tomadas')}
      </button>
    ),
  };
}

export function QuestionsView({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const [settled, setSettled] = useState(false);
  const kept = useRef<Set<string>>(new Set());
  const section = useMemo(
    () => questionsSection(settled, () => setSettled((value) => !value), kept, onNavigate),
    [settled, onNavigate]
  );
  return (
    <WorldWorkspace
      // Remounting on the toggle is deliberate: the two readings are different lists, and
      // carrying the open sheet across would leave an answered decision selected in a list
      // that no longer contains it.
      key={settled ? 'settled' : 'open'}
      section={section}
      createModal={(close, created) => <NewQuestionModal onClose={close} onCreated={created} />}
    />
  );
}

function NothingDecided() {
  return <p className="text-sm text-neutral-600 dark:text-neutral-500">{t('Todavía no has decidido nada aquí.')}</p>;
}

const URGENCY_TONE: Record<string, string> = {
  blocking: 'text-red-600 dark:text-red-400',
  soon: 'text-amber-700 dark:text-amber-400',
  later: 'text-neutral-500 dark:text-neutral-600',
};

function QuestionRow({
  item,
  compact,
  onOpen,
}: {
  item: WorldQuestionFeedItem;
  compact: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      data-testid="question-row"
      data-urgency={item.urgency}
      data-origin={item.origin}
      onClick={onOpen}
      className="flex w-full items-start gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 px-2 py-1.5 text-left transition-colors hover:border-indigo-400 dark:hover:border-violet-700/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/20"
    >
      <Icon
        name={item.blocking ? 'alert' : item.origin === 'placeholder' ? 'edit' : 'help'}
        size={13}
        className={`mt-0.5 shrink-0 ${URGENCY_TONE[item.urgency]}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-900 dark:text-neutral-100">{item.question}</span>
        {!compact && (
          <span className="mt-0.5 block truncate text-[11px] text-neutral-500 dark:text-neutral-600">
            {[
              item.anchor ? `${item.anchor.title}${item.anchorField ? ` → ${fieldLabel(item.anchorField)}` : ''}` : null,
              item.blockedScene ? tx('bloquea «{scene}»', { scene: item.blockedScene.title }) : null,
              item.options.length > 0 ? tx('{count} opciones', { count: String(item.options.length) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </span>
      {item.status === 'answered' && <Icon name="check" size={12} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-500" />}
    </button>
  );
}

/**
 * One decision: what it is, what proves it is open, what it holds up, and the ways out.
 *
 * The order is the author's order of thought — the question, the sentence it came from, and
 * only then the options — because an option list at the top of a screen is a form, and a
 * form is the thing this section is designed not to be.
 */
function QuestionSheet({
  item,
  onChanged,
  onBack,
  onAnswered,
  onNavigate,
}: {
  item: WorldQuestionFeedItem;
  onChanged: () => Promise<void>;
  onBack: () => void;
  /** Keeps the answered decision on screen until the author leaves the section. */
  onAnswered: () => void;
  onNavigate?: (view: View) => void;
}) {
  const [draft, setDraft] = useState(item.question);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [undoable, setUndoable] = useState<Record<string, boolean>>({});
  const [holes, setHoles] = useState<{ title: string; field: string; evidence: string }[]>([]);

  useEffect(() => {
    setDraft(item.question);
  }, [item.question]);

  const chosen = item.options.find((option) => option.optionId === item.chosenOptionId) ?? null;

  // Whether the undo would still restore the old text. Asked of the main process rather
  // than guessed here: the answer depends on what the character's sheet says RIGHT NOW,
  // which the renderer has no copy of.
  const refreshUndo = useCallback(async () => {
    const applied = item.options.filter((option) => option.appliedAt);
    const answers = await Promise.all(
      applied.map(async (option) => [option.optionId, await window.nodus.canUndoQuestionOption(option.optionId)] as const)
    );
    setUndoable(Object.fromEntries(answers));
    setHoles(
      chosen?.appliedAt
        ? (await window.nodus.questionRemainingHoles(chosen.optionId)).map((hole) => ({
            title: hole.title,
            field: hole.field,
            evidence: hole.evidence,
          }))
        : []
    );
  }, [item.options, chosen]);

  useEffect(() => {
    void refreshUndo();
  }, [refreshUndo]);

  /** A derived hole has no row until it is touched. This is that touch. */
  const ensure = async (): Promise<string> => {
    if (item.questionId) return item.questionId;
    const created = await window.nodus.ensureQuestion({
      question: item.question,
      originKey: item.originKey,
      origin: item.origin,
      anchorKind: item.anchor?.kind ?? null,
      anchorId: item.anchor?.id ?? null,
      anchorField: item.anchorField,
    });
    return created.questionId;
  };

  const run = async (action: (questionId: string) => Promise<unknown>) => {
    setBusy(true);
    try {
      await action(await ensure());
      await onChanged();
      notifyDataChanged();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Three answers from the model, stored as options like the author's own.
   *
   * There is no «accept» here, and that is the design rather than an omission: an option is
   * a PENDING WRITE, so choosing one and pressing the button that names what it will write
   * is already the moment of consent. Nothing the model says reaches the world before that.
   */
  const propose = async () => {
    setProposing(true);
    try {
      const questionId = await ensure();
      const result = await window.nodus.proposeQuestionOptions(questionId);
      if (result.noMaterial) {
        toast(t('Escribe primero qué es lo que no has decidido: «???» a secas no da para responder.'));
        return;
      }
      if (result.options.length === 0) {
        toast(t('El modelo no ha devuelto ninguna respuesta que pueda usar.'));
        return;
      }
      await onChanged();
      notifyDataChanged();
    } finally {
      setProposing(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Eliminar la pregunta'),
      message: t('Se borra con sus opciones. Si venía de un hueco en tu prosa, volverá a aparecer.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok || !item.questionId) return;
    await window.nodus.deleteWorldQuestion(item.questionId);
    onBack();
    await onChanged();
  };

  return (
    <div className="space-y-5 p-6" data-testid="question-sheet">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button className="mb-2 flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200" onClick={onBack}>
            <Icon name="chevronLeft" size={13} /> {t('Volver')}
          </button>
          <textarea
            className="input w-full resize-y text-base font-medium"
            style={{ minHeight: '3.5rem' }}
            data-testid="question-text"
            value={draft}
            aria-label={t('La pregunta')}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (draft.trim() === item.question || !draft.trim()) return;
              void run((questionId) => window.nodus.updateWorldQuestion(questionId, { question: draft.trim() }));
            }}
          />
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-500">
            {[
              t(WORLD_QUESTION_ORIGIN_LABEL[item.origin]),
              item.status === 'open'
                ? t(WORLD_QUESTION_URGENCY_LABEL[item.urgency])
                : t(WORLD_QUESTION_STATUS_LABEL[item.status]),
            ].join(' · ')}
          </p>
        </div>
        {item.questionId && (
          <button
            className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-red-600 dark:text-red-300 hover:text-red-700 dark:hover:text-red-200"
            title={t('Eliminar')}
            onClick={() => void remove()}
          >
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>

      {/* The sentence it came from, verbatim. A paraphrase would make the author guess
          which of their own holes this is. */}
      {item.evidence && (
        <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="question-evidence">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">
            {t('Dónde está el hueco')}
          </h3>
          <p className="whitespace-pre-wrap text-xs leading-5 text-neutral-600 dark:text-neutral-400">{item.evidence}</p>
          {item.anchor && (
            <button
              className="mt-2 flex items-center gap-1 text-[11px] text-indigo-700 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-200"
              disabled={!SECTION_OF_KIND[item.anchor.kind]}
              onClick={() => onNavigate?.(SECTION_OF_KIND[item.anchor!.kind])}
            >
              {item.anchor.title}
              {item.anchorField ? ` → ${fieldLabel(item.anchorField)}` : ''}
              <Icon name="chevronRight" size={11} />
            </button>
          )}
        </section>
      )}

      {/* What hangs off it, and what it holds up. The only two numbers on this screen the
          author cannot work out from what is in front of them. */}
      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="question-leverage">
        <p className="text-xs leading-5 text-neutral-600 dark:text-neutral-400">
          {item.leverage > 0
            ? tx('Lo que decidas aquí toca {count} textos que ya mencionan «{title}».', {
                count: String(item.leverage),
                title: item.anchor?.title ?? '',
              })
            : t('Todavía no hay nada más en el mundo que dependa de esto.')}
        </p>
        {item.blockedScene && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400" data-testid="question-blocked-scene">
            {tx('No puedes escribir «{scene}» sin decidirlo (escena {order} del relato).', {
              scene: item.blockedScene.title,
              order: String(item.blockedScene.narrativeOrder + 1),
            })}
          </p>
        )}
        <label className="mt-2 flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
          <input
            type="checkbox"
            data-testid="question-blocking"
            checked={item.blocking}
            disabled={busy}
            onChange={(event) =>
              void run((questionId) =>
                window.nodus.updateWorldQuestion(questionId, { blocking: event.target.checked })
              )
            }
          />
          {t('No puedo seguir sin esto')}
        </label>
      </section>

      <section data-testid="question-options">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">
          {item.status === 'answered' ? t('Lo que decidiste, y lo que descartaste') : t('Las salidas')}
        </h3>
        {item.options.length === 0 ? (
          <p className="mb-2 text-[11px] leading-4 text-neutral-500 dark:text-neutral-600">
            {t('Escribe dos o tres respuestas posibles. Elegir una la escribe donde toca.')}
          </p>
        ) : (
          <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
            {item.options.map((option) => (
              <li key={option.optionId}>
                <OptionCard
                  option={option}
                  item={item}
                  chosen={option.optionId === item.chosenOptionId}
                  canUndo={undoable[option.optionId] === true}
                  busy={busy}
                  onApply={async (mode) => {
                    setBusy(true);
                    try {
                      if (mode !== option.applyMode) {
                        await window.nodus.setQuestionOption({
                          optionId: option.optionId,
                          questionId: option.questionId,
                          text: option.text,
                          implications: option.implications,
                          applyMode: mode,
                        });
                      }
                      await window.nodus.applyQuestionOption(option.optionId);
                      onAnswered();
                      await onChanged();
                      notifyDataChanged();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  onUndo={async () => {
                    setBusy(true);
                    try {
                      await window.nodus.undoQuestionOption(option.optionId);
                      await onChanged();
                      notifyDataChanged();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  onDelete={async () => {
                    setBusy(true);
                    try {
                      await window.nodus.deleteQuestionOption(option.optionId);
                      await onChanged();
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex gap-2">
          <input
            className="input h-8 flex-1 text-xs"
            data-testid="question-new-option"
            placeholder={t('Otra respuesta posible…')}
            aria-label={t('Otra respuesta posible…')}
            value={adding}
            disabled={busy}
            onChange={(event) => setAdding(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !adding.trim()) return;
              const text = adding.trim();
              setAdding('');
              void run(async (questionId) => window.nodus.setQuestionOption({ questionId, text }));
            }}
          />
          <button
            className="btn btn-primary h-8 text-xs"
            disabled={busy || !adding.trim()}
            onClick={() => {
              const text = adding.trim();
              setAdding('');
              void run(async (questionId) => window.nodus.setQuestionOption({ questionId, text }));
            }}
          >
            {t('Añadir')}
          </button>
          {item.status !== 'answered' && (
            <button
              className="btn btn-ghost h-8 shrink-0 gap-1 border border-neutral-300 dark:border-neutral-700 px-2 text-xs"
              data-testid="question-propose"
              disabled={busy || proposing}
              onClick={() => void propose()}
            >
              <Icon name="sparkles" size={13} /> {proposing ? t('Pensando…') : t('Proponer respuestas')}
            </button>
          )}
        </div>
      </section>

      {/* After the write: the same mark still sitting in other sheets. Deciding something
          once rarely fills every hole it opened. */}
      {holes.length > 0 && (
        <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="question-remaining-holes">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">
            {t('Sigue habiendo hueco en')}
          </h3>
          <ul className="space-y-0.5">
            {holes.map((hole) => (
              <li key={`${hole.title}:${hole.field}`} className="truncate text-[11px] text-neutral-600 dark:text-neutral-500">
                · {hole.title} → {fieldLabel(hole.field)}
                <span className="text-neutral-500 dark:text-neutral-600"> · {hole.evidence}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {item.status !== 'answered' && (
        <button
          className="btn btn-ghost w-full border border-neutral-300 dark:border-neutral-700 text-xs"
          data-testid="question-park"
          disabled={busy}
          onClick={() => {
            void run((questionId) => window.nodus.updateWorldQuestion(questionId, { status: 'parked' }));
            onBack();
          }}
        >
          {t('Aparcarla: no me lo vuelvas a enseñar')}
        </button>
      )}
      {item.status === 'parked' && (
        <p className="text-[10px] leading-4 text-neutral-500 dark:text-neutral-600">
          {t('Aparcada. Si venía de un hueco en tu prosa, seguirá aparcada aunque reescribas la frase.')}
        </p>
      )}
    </div>
  );
}

/**
 * One competing answer, and the single button that performs it.
 *
 * The button NAMES the write before doing it — «Se escribirá en Kaelen → Trasfondo» — and
 * turns into «Deshacer» while the field still contains what was written. It stops offering
 * the undo the moment that stops being true: restoring the old paragraph over prose written
 * afterwards would destroy work, which is exactly what an undo exists to prevent.
 */
function OptionCard({
  option,
  item,
  chosen,
  canUndo,
  busy,
  onApply,
  onUndo,
  onDelete,
}: {
  option: WorldQuestionOption;
  item: WorldQuestionFeedItem;
  chosen: boolean;
  canUndo: boolean;
  busy: boolean;
  onApply: (mode: WorldQuestionOption['applyMode']) => Promise<void>;
  onUndo: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const writes =
    option.applyMode === 'fill_field' && item.anchor && item.anchorField
      ? tx('Se escribirá en {title} → {field}', {
          title: item.anchor.title,
          field: fieldLabel(item.anchorField),
        })
      : option.applyMode === 'create_article'
        ? tx('Se creará el artículo «{title}»', { title: item.question.replace(/^[¿¡\s]+|[?!\s]+$/g, '') })
        : t(WORLD_APPLY_MODE_LABEL.none);

  return (
    <div
      data-testid="question-option"
      data-chosen={chosen ? 'true' : undefined}
      className={`flex h-full flex-col gap-2 rounded-lg border p-2 ${
        chosen ? 'border-emerald-300 dark:border-emerald-700/70 bg-emerald-50 dark:bg-emerald-950/10' : 'border-neutral-200 dark:border-neutral-800'
      }`}
    >
      <p className="min-h-0 flex-1 whitespace-pre-wrap text-xs leading-5 text-neutral-800 dark:text-neutral-200">{option.text}</p>
      {option.implications && (
        <p className="text-[10px] leading-4 text-neutral-600 dark:text-neutral-500">{option.implications}</p>
      )}
      {option.origin === 'ai' && (
        <span className="text-[9px] uppercase tracking-wide text-amber-700 dark:text-amber-500">{t('Propuesta de la IA')}</span>
      )}

      {option.appliedAt && canUndo ? (
        <button
          className="btn btn-ghost border border-neutral-300 dark:border-neutral-700 px-2 text-[11px]"
          data-testid="question-option-undo"
          disabled={busy}
          onClick={() => void onUndo()}
        >
          {t('Deshacer')}
        </button>
      ) : option.appliedAt ? (
        <span className="text-[10px] leading-4 text-neutral-500 dark:text-neutral-600">
          {t('Aplicada. El texto ha cambiado desde entonces, así que ya no se puede deshacer sola.')}
        </span>
      ) : (
        <>
          <button
            className="btn btn-primary px-2 text-[11px]"
            data-testid="question-option-apply"
            disabled={busy}
            title={writes}
            onClick={() => void onApply(option.applyMode)}
          >
            {writes}
          </button>
          {option.applyMode !== 'none' && (
            <button
              className="text-[10px] text-neutral-600 dark:text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"
              disabled={busy}
              onClick={() => void onApply('none')}
            >
              {t('Elegirla sin escribir nada')}
            </button>
          )}
          <button
            className="text-[10px] text-neutral-500 hover:text-red-600 dark:text-neutral-600 dark:hover:text-red-300"
            disabled={busy}
            onClick={() => void onDelete()}
          >
            {t('Quitar')}
          </button>
        </>
      )}
    </div>
  );
}

function NewQuestionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const [question, setQuestion] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!question.trim()) return;
    setSaving(true);
    try {
      const created = await window.nodus.ensureQuestion({ question: question.trim(), origin: 'author' });
      // Keyed by origin key first, and an author's question has none — so the workspace
      // finds it by its id, exactly as `idOf` falls back.
      await onCreated(created.questionId);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="card-modal w-full max-w-lg p-5" role="dialog" aria-modal="true" aria-labelledby="new-question-title">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="new-question-title" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {t('Nueva pregunta')}
            </h3>
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-500">
              {t('Lo que todavía no has decidido de tu mundo. Desde una ficha se captura sola, con su sitio ya puesto.')}
            </p>
          </div>
          <button className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-600 dark:text-neutral-400" aria-label={t('Cerrar')} disabled={saving} onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <textarea
          className="input w-full resize-y text-sm"
          style={{ minHeight: '4.5rem' }}
          placeholder={t('¿La magia deja marca visible?')}
          value={question}
          autoFocus
          onChange={(event) => setQuestion(event.target.value)}
        />
        <p className="mt-2 text-[10px] leading-4 text-neutral-500 dark:text-neutral-600">
          {tx('También aparecen aquí solos los huecos que dejas al escribir: {tokens}.', {
            tokens: WORLD_PLACEHOLDER_TOKENS.join('  '),
          })}
        </p>
        <div className="mt-4 flex justify-end gap-2 border-t border-neutral-200 dark:border-neutral-800 pt-3">
          <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700 px-3 text-xs" onClick={onClose} disabled={saving}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary min-w-32" disabled={saving || !question.trim()} onClick={() => void save()}>
            {saving ? t('Creando…') : t('Crear pregunta')}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
