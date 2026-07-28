import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MuteReasonCode, WorldFinding, WorldNoticeMute } from '@shared/types';
import { CONTINUITY_CHECKS } from '@shared/worldContinuity';
import { FINDING_FAMILY_LABEL, MUTE_REASON_LABEL, type FindingFamily } from '@shared/worldFindings';
import type { View } from '../navigation';
import type { WorldSectionDef } from '../components/world/WorldWorkspace';
import { WorldWorkspace } from '../components/world/WorldWorkspace';
import { findingText, useContinuity } from '../components/world/ContinuityBadge';
import { Icon } from '../components/ui';
import { toast } from '../components/feedback';
import { PERSON_DOSSIER_SECTION_CLASS } from '../components/personDossierLayout';
import { notifyDataChanged } from '../hooks';
import { t, tx } from '../i18n';

/** Where a subject's own section lives, so a contradiction is one click from its cause. */
const SECTION_OF_KIND: Record<string, View> = {
  character: 'characters',
  place: 'places',
  group: 'factions',
  scene: 'scenes',
  article: 'encyclopedia',
  map: 'map',
};

const SEVERITY_LABEL: Record<WorldFinding['severity'], string> = {
  contradiction: 'Se contradice',
  warning: 'Habría que mirarlo',
  gap: 'Falta información',
};

const MUTE_REASONS: MuteReasonCode[] = ['double', 'told', 'deliberate', 'unknown'];

/**
 * Continuity: what contradicts what.
 *
 * A READING of the world, not a collection you add to — so it has no create button and no
 * form. The findings are recomputed whole every time the screen opens; nothing here is
 * stored except what the author has decided to stop hearing about.
 *
 * The empty state is designed rather than default, and that is not decoration: "Sin
 * contradicciones" on its own is indistinguishable from "no he mirado", and a writer who
 * cannot tell the difference stops opening the tab. It says what was checked, with real
 * counts from the same snapshot.
 */
function continuitySection(onNavigate?: (view: View) => void): WorldSectionDef<WorldFinding> {
  return {
    id: 'continuity',
    icon: 'check',
    title: 'Continuidad',
    searchPlaceholder: 'Buscar en las contradicciones…',
    emptyLabel: 'Nada que revisar.',
    noMatchLabel: 'Ningún aviso coincide con el filtro.',
    presentation: 'list',
    // Already sorted by the repo: contradictions first, then warnings, then gaps. A writer
    // reads this top to bottom, so the order has to be predictable rather than clever.
    load: () => window.nodus.runWorldContinuity(),
    idOf: (finding) => finding.fingerprint,
    labelOf: (finding) => findingText(finding.headline),
    facets: [
      {
        id: 'certeza',
        label: 'Certeza',
        source: 'vocabulary',
        vocabulary: (['contradiction', 'warning', 'gap'] as const).map((severity) => ({
          id: severity,
          label: SEVERITY_LABEL[severity],
        })),
      },
      // "Everything that goes wrong with Kestra" — the question a writer actually asks,
      // and the reason this facet is multi-valued: a finding names two or three entities.
      { id: 'implica', label: 'Implica a', source: 'distinct', multiValue: true },
    ],
    facetValues: (finding) => ({
      certeza: finding.severity,
      implica: finding.subjects.map((subject) => subject.title),
    }),
    searchText: (finding) => [findingText(finding.headline), ...finding.subjects.map((subject) => subject.title)],
    Card: FindingRow,
    Sheet: ({ item, onChanged, onBack }) => (
      <FindingSheet finding={item} onChanged={onChanged} onBack={onBack} onNavigate={onNavigate} />
    ),
    Footer: BlindSpots,
    HeaderActions: ExceptionsAction,
    EmptyState: NothingWrong,
  };
}

export function ContinuityView({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const section = useMemo(() => continuitySection(onNavigate), [onNavigate]);
  return <WorldWorkspace section={section} />;
}

function FindingRow({ item, compact, onOpen }: { item: WorldFinding; compact: boolean; onOpen: () => void }) {
  const serious = item.severity === 'contradiction';
  return (
    <button
      data-testid="continuity-row"
      data-severity={item.severity}
      onClick={onOpen}
      className="flex w-full items-start gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 px-2 py-1.5 text-left transition-colors hover:border-indigo-400 dark:hover:border-violet-700/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/20"
    >
      <Icon
        name={serious ? 'alert' : item.severity === 'warning' ? 'info' : 'help'}
        size={13}
        className={`mt-0.5 shrink-0 ${serious ? 'text-red-600 dark:text-red-400' : item.severity === 'warning' ? 'text-amber-700 dark:text-amber-400' : 'text-neutral-500 dark:text-neutral-600'}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-900 dark:text-neutral-100">{findingText(item.headline)}</span>
        {!compact && (
          <span className="mt-0.5 block truncate text-[11px] text-neutral-500 dark:text-neutral-600">
            {item.subjects.map((subject) => subject.title).join(' · ')}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * One finding: the facts that clash, why the app says so, and the two ways out.
 *
 * "Por qué lo digo" is not politeness. A warning whose reasoning a writer cannot follow is
 * a warning they learn to skip, and once they skip one they skip the screen.
 */
function FindingSheet({
  finding,
  onChanged,
  onBack,
  onNavigate,
}: {
  finding: WorldFinding;
  onChanged: () => Promise<void>;
  onBack: () => void;
  onNavigate?: (view: View) => void;
}) {
  const { reload } = useContinuity();
  const [muting, setMuting] = useState(false);
  const check = CONTINUITY_CHECKS.find((entry) => entry.id === finding.checkId);

  const mute = async (reasonCode: MuteReasonCode) => {
    setMuting(true);
    try {
      await window.nodus.muteNotice({
        fingerprint: finding.fingerprint,
        checkId: finding.checkId,
        subjects: finding.subjects,
        // Stored RESOLVED, as it read when it was silenced: six months later a list of
        // fingerprints is unreadable, and re-deriving it would show today's wording.
        headline: findingText(finding.headline),
        reasonCode,
      });
      onBack();
      await onChanged();
      await reload();
    } finally {
      setMuting(false);
    }
  };

  const recompute = async () => {
    const dated = await window.nodus.recomputeSceneDays();
    toast(tx('{count} escenas re-fechadas.', { count: String(dated) }));
    notifyDataChanged();
    await onChanged();
    await reload();
  };

  return (
    <div className="space-y-5 p-6" data-testid="continuity-sheet">
      <div>
        <button className="mb-2 flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200" onClick={onBack}>
          <Icon name="chevronLeft" size={13} /> {t('Volver')}
        </button>
        <h2 className="text-lg font-semibold">{findingText(finding.headline)}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-500">
          {t(SEVERITY_LABEL[finding.severity])}
          {finding.family in FINDING_FAMILY_LABEL
            ? ` · ${t(FINDING_FAMILY_LABEL[finding.family as FindingFamily])}`
            : ''}
        </p>
        {finding.detail && <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-500">{findingText(finding.detail)}</p>}
      </div>

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="continuity-subjects">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">{t('Lo que choca')}</h3>
        <ul className="space-y-1">
          {finding.subjects.map((subject) => (
            <li key={`${subject.kind}:${subject.id}:${subject.field ?? ''}`}>
              <button
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                disabled={!SECTION_OF_KIND[subject.kind]}
                onClick={() => onNavigate?.(SECTION_OF_KIND[subject.kind])}
              >
                <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{subject.title}</span>
                {SECTION_OF_KIND[subject.kind] && <Icon name="chevronRight" size={12} className="text-neutral-500 dark:text-neutral-600" />}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {check && (
        <section className={PERSON_DOSSIER_SECTION_CLASS}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">{t('Por qué lo digo')}</h3>
          <p className="text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t(check.explains)}</p>
        </section>
      )}

      {/* The only mechanical fix in the section. Everything else is navigation: this
          screen never edits the world behind the author's back. */}
      {finding.checkId === 'coverage.undatedScenes' && (
        <button className="btn btn-ghost w-full border border-neutral-300 dark:border-neutral-700 text-xs" onClick={() => void recompute()}>
          {t('Recalcular los días desde la cadena')}
        </button>
      )}

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="continuity-mute">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">{t('Está bien así')}</h3>
        <p className="mb-2 text-[11px] leading-4 text-neutral-500 dark:text-neutral-600">
          {t('Dejaré de avisarte de esto. Puedes verlo y deshacerlo en «Excepciones aceptadas».')}
        </p>
        <div className="flex flex-wrap gap-1">
          {MUTE_REASONS.map((reason) => (
            <button
              key={reason}
              data-testid={`mute-${reason}`}
              className="btn btn-ghost border border-neutral-300 dark:border-neutral-700 px-2 text-[11px]"
              disabled={muting}
              onClick={() => void mute(reason)}
            >
              {t(MUTE_REASON_LABEL[reason])}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * The designed empty state.
 *
 * With real counts, from the same snapshot the checks ran over. An invented number here
 * would be the one lie that discredits the whole section.
 */
function NothingWrong() {
  const [summary, setSummary] = useState<{ families: number; facts: number; checks: number } | null>(null);

  useEffect(() => {
    let active = true;
    void window.nodus.continuitySummary().then((next) => {
      if (active) setSummary(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div data-testid="continuity-empty">
      <p className="text-sm text-neutral-700 dark:text-neutral-300">{t('Sin contradicciones.')}</p>
      {summary && (
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-500">
          {tx('He comprobado {checks} cosas de {families} familias sobre {facts} hechos.', {
            checks: String(summary.checks),
            families: String(summary.families),
            facts: String(summary.facts),
          })}
        </p>
      )}
    </div>
  );
}

/**
 * What the section CANNOT check yet, said plainly.
 *
 * One sentence per blind family, with no invented counters. A tool that hides its blind
 * spots is a tool whose silence means nothing.
 */
function BlindSpots() {
  const { findings } = useContinuity();
  const gaps = findings.filter((finding) => finding.severity === 'gap');
  if (gaps.length === 0) return null;
  return (
    <section className="mt-3 border-t border-neutral-200 dark:border-neutral-800 pt-2" data-testid="continuity-blindspots">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-600">
        {t('Lo que todavía no puedo comprobar')}
      </h4>
      <ul className="mt-1 space-y-0.5">
        {gaps.map((gap) => (
          <li key={gap.fingerprint} className="text-[11px] leading-4 text-neutral-600 dark:text-neutral-500">
            · {findingText(gap.headline)}
            {gap.detail && <span className="block pl-2 text-[10px] text-neutral-500 dark:text-neutral-600">{findingText(gap.detail)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExceptionsAction() {
  const [mutes, setMutes] = useState<WorldNoticeMute[]>([]);
  const [open, setOpen] = useState(false);
  const { reload } = useContinuity();

  const load = useCallback(async () => {
    setMutes(await window.nodus.listNoticeMutes());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <button
        className="btn btn-ghost h-9 gap-1.5 border border-neutral-300 dark:border-neutral-700 px-2 text-xs"
        data-testid="continuity-exceptions"
        onClick={() => {
          void load();
          setOpen(true);
        }}
      >
        <Icon name="check" size={14} /> {tx('Excepciones aceptadas ({count})', { count: String(mutes.length) })}
      </button>
      {open && (
        <ExceptionsModal
          mutes={mutes}
          onClose={() => setOpen(false)}
          onRestored={async () => {
            await load();
            await reload();
            notifyDataChanged();
          }}
        />
      )}
    </>
  );
}

function ExceptionsModal({
  mutes,
  onClose,
  onRestored,
}: {
  mutes: WorldNoticeMute[];
  onClose: () => void;
  onRestored: () => Promise<void>;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="card-modal w-full max-w-2xl p-5" role="dialog" aria-modal="true" data-testid="exceptions-modal">
        <div className="mb-3 flex items-start gap-3">
          <h3 className="min-w-0 flex-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Excepciones aceptadas')}</h3>
          <button className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-600 dark:text-neutral-400" aria-label={t('Cerrar')} onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        {mutes.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-500">{t('Todavía no has aceptado ninguna excepción.')}</p>
        ) : (
          <ul className="max-h-96 space-y-1 overflow-y-auto">
            {mutes.map((mute) => (
              <li key={mute.fingerprint} className="flex items-start gap-2 rounded border border-neutral-200 dark:border-neutral-800 p-2">
                <span className="min-w-0 flex-1">
                  {/* The headline as it READ when it was silenced. A list of fingerprints
                      six months later is unreadable. */}
                  <span className="block truncate text-xs text-neutral-800 dark:text-neutral-200">{mute.headline ?? mute.fingerprint}</span>
                  <span className="block text-[10px] text-neutral-500 dark:text-neutral-600">
                    {t(MUTE_REASON_LABEL[mute.reasonCode] ?? mute.reasonCode)}
                    {mute.subjects.length > 0 ? ` · ${mute.subjects.map((subject) => subject.title).join(', ')}` : ''}
                  </span>
                </span>
                <button
                  className="btn btn-ghost shrink-0 border border-neutral-300 dark:border-neutral-700 px-2 text-[11px]"
                  onClick={async () => {
                    await window.nodus.unmuteNotice(mute.fingerprint);
                    await onRestored();
                  }}
                >
                  {t('Volver a avisarme')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>,
    document.body
  );
}
