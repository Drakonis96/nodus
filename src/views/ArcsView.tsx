import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorldBeat, WorldThread } from '@shared/types';
import { CHARACTER_ARC_FIELDS, characterAccentHex } from '@shared/characterLabels';
import {
  BEAT_MARK_LABEL,
  PARTY_SIDE_LABEL,
  THREAD_STATUS_LABEL,
  beatDensity,
  closingOrder,
  findInertScenes,
  milestoneSheet,
  plotThreads,
  rankScenes,
  type PlottedThread,
  type SceneRank,
} from '@shared/worldThreads';
import { EMPTY_WORLD_FILTER, applyWorldFilter, type WorldFilterState } from '@shared/worldFilters';
import type { View } from '../navigation';
import { WorldFilterBar } from '../components/world/WorldFilterBar';
import { Icon } from '../components/ui';
import { toast } from '../components/feedback';
import { PERSON_DOSSIER_SECTION_CLASS } from '../components/personDossierLayout';
import { t, tx } from '../i18n';

/** Lane geometry. Fixed rather than responsive: a lane that reflows while you read it
 *  moves the milestone you were looking at. */
const LANE_HEIGHT = 26;
const LANE_LABEL = 168;
const LANE_PADDING = 12;

interface ArcData {
  threads: WorldThread[];
  beats: WorldBeat[];
  scenes: SceneRank[];
  /** A read-only mirror of what `character_profiles` already holds. */
  arcFields: Map<string, { want: string | null; need: string | null; accent: string | null }>;
}

/**
 * Arcs: what changes across the manuscript.
 *
 * A READING of data written in Escenas. Nothing here writes: the milestones are marked on
 * the scene sheet, where the author is when they know what changed. Comparing lanes on a
 * shared axis is the opposite of "a collection of interchangeable items", so this does not
 * use the collection shell for its main surface — but it reuses the same filter bar and
 * the same pure filter, verbatim, so the facets behave exactly as everywhere else.
 *
 * ONE axis: the story. There is no chronological toggle, because an arc is a shape the
 * READER experiences, and reordering it by world day would draw a line nobody reads.
 */
export function ArcsView({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const [data, setData] = useState<ArcData | null>(null);
  const [filter, setFilter] = useState<WorldFilterState>(EMPTY_WORLD_FILTER);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [threads, beats, context, board] = await Promise.all([
      window.nodus.listWorldThreads('arc'),
      window.nodus.listWorldBeats(),
      window.nodus.threadSceneContext(),
      window.nodus.threadBoardData(),
    ]);
    const scenes = await window.nodus.listScenes('narrative');
    setData({
      threads,
      beats: beats.filter((beat) => beat.threadKind === 'arc'),
      scenes: context.scenes.map((scene) => ({
        ...scene,
        status: scenes.find((entry) => entry.sceneId === scene.sceneId)?.status ?? 'draft',
      })),
      arcFields: new Map(
        board.cast.map((person) => [
          person.personId,
          { want: person.arcWant, need: person.arcNeed, accent: person.accent },
        ])
      ),
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      data
        ? applyWorldFilter(data.threads, filter, {
            facets: (thread) => ({
              status: thread.status,
              subject: thread.parties.map((party) => party.partyName),
            }),
            searchText: (thread) => [thread.title, ...thread.parties.map((party) => party.partyName)],
          })
        : [],
    [data, filter]
  );

  const plotted = useMemo(
    () => (data ? plotThreads(visible, data.beats, data.scenes) : []),
    [data, visible]
  );
  const sceneCount = data?.scenes.length ?? 0;
  const density = useMemo(() => beatDensity(plotted, sceneCount), [plotted, sceneCount]);
  const inert = useMemo(() => (data ? findInertScenes(data.scenes, data.beats) : []), [data]);
  const closing = useMemo(() => closingOrder(plotted), [plotted]);

  if (!data) return <p className="p-6 text-sm text-neutral-600 dark:text-neutral-500">{t('Cargando…')}</p>;

  const open = plotted.find((entry) => entry.thread.threadId === selected) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-neutral-200 dark:border-neutral-800 p-4">
        <div className="flex items-center gap-2">
          <Icon name="route" size={20} className="text-indigo-700 dark:text-indigo-300" />
          <h1 className="text-lg font-semibold">{t('Arcos narrativos')}</h1>
          <span className="text-xs text-neutral-600 dark:text-neutral-500">{plotted.length}</span>
          <button
            className="btn btn-ghost ml-auto h-9 gap-1.5 border border-neutral-300 dark:border-neutral-700 px-2 text-xs"
            data-testid="arcs-copy-sheet"
            onClick={async () => {
              await navigator.clipboard.writeText(milestoneSheet(plotted, sceneCount));
              toast(t('Hoja de hitos copiada.'));
            }}
          >
            <Icon name="copy" size={14} /> {t('Copiar hoja de hitos')}
          </button>
        </div>
        <WorldFilterBar
          facets={[
            {
              id: 'status',
              label: 'Estado',
              source: 'vocabulary',
              vocabulary: (['open', 'resolved', 'archived'] as const).map((status) => ({
                id: status,
                label: THREAD_STATUS_LABEL[status],
              })),
            },
            { id: 'subject', label: 'Sujeto', source: 'distinct', multiValue: true },
          ]}
          state={filter}
          onChange={setFilter}
          items={data.threads.map((thread) => ({
            status: thread.status,
            subject: thread.parties.map((party) => party.partyName),
          }))}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="arcs-lanes">
        {plotted.length === 0 ? (
          <EmptyArcs onNavigate={onNavigate} hasThreads={data.threads.length > 0} />
        ) : (
          <>
            <Lanes
              plotted={plotted}
              sceneCount={sceneCount}
              selected={selected}
              onSelect={setSelected}
              accents={data.arcFields}
            />
            <Density bars={density} sceneCount={sceneCount} />
            {open && <ArcSheet plotted={open} arcFields={data.arcFields} sceneCount={sceneCount} />}
            <InertScenes runs={inert} sceneCount={sceneCount} onNavigate={onNavigate} />
            <ClosingOrder closing={closing} sceneCount={sceneCount} />
          </>
        )}
      </div>
    </div>
  );
}

function EmptyArcs({ hasThreads, onNavigate }: { hasThreads: boolean; onNavigate?: (view: View) => void }) {
  return (
    <div className="py-12 text-center">
      <Icon name="route" size={32} className="mx-auto mb-3 text-neutral-400 dark:text-neutral-700" />
      <p className="text-sm text-neutral-600 dark:text-neutral-500">
        {hasThreads ? t('Ningún arco coincide con el filtro.') : t('Todavía no hay arcos.')}
      </p>
      {!hasThreads && (
        <>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-neutral-500 dark:text-neutral-600">
            {t('Un arco se crea desde la escena en la que algo cambia, y sus hitos se marcan ahí mismo. Aquí verás cómo se reparten por el relato.')}
          </p>
          <button className="btn btn-ghost mt-3 border border-neutral-300 dark:border-neutral-700 text-xs" onClick={() => onNavigate?.('scenes')}>
            {t('Ir a Escenas')}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The lanes.
 *
 * Read-only, and drawn in native SVG rather than with a chart library: three shapes and a
 * line is not a chart, and a dependency here would bring a theme, a tooltip layer and an
 * animation nobody asked for.
 *
 * A filled dot is a written scene, a hollow one a draft, a dashed outline an outline —
 * so the lane also says how much of this arc actually exists on the page.
 */
function Lanes({
  plotted,
  sceneCount,
  selected,
  onSelect,
  accents,
}: {
  plotted: PlottedThread[];
  sceneCount: number;
  selected: string | null;
  onSelect: (threadId: string | null) => void;
  accents: ArcData['arcFields'];
}) {
  const width = 720;
  const axis = width - LANE_LABEL - LANE_PADDING;
  const x = (position: number) =>
    LANE_LABEL + (sceneCount <= 1 ? axis / 2 : (position / (sceneCount - 1)) * axis);

  return (
    <svg
      viewBox={`0 0 ${width} ${plotted.length * LANE_HEIGHT + 18}`}
      className="w-full"
      role="img"
      aria-label={t('Arcos narrativos')}
    >
      {plotted.map((entry, index) => {
        const y = index * LANE_HEIGHT + LANE_HEIGHT / 2;
        // The subject's own accent, resolved from the TOKEN on their sheet. Passing the
        // person id here would always miss and silently paint every lane the same.
        const subject = entry.thread.parties.find((party) => party.side === 'subject');
        const accent =
          (subject?.partyKind === 'character' ? characterAccentHex(accents.get(subject.partyId)?.accent) : null) ??
          '#818cf8';
        const isSelected = entry.thread.threadId === selected;
        return (
          <g
            key={entry.thread.threadId}
            data-testid="arc-lane"
            onClick={() => onSelect(isSelected ? null : entry.thread.threadId)}
            style={{ cursor: 'pointer' }}
          >
            <rect x={0} y={y - LANE_HEIGHT / 2} width={width} height={LANE_HEIGHT} fill={isSelected ? '#1e1b4b' : 'transparent'} />
            <text x={4} y={y + 4} fill="#d4d4d4" fontSize={11}>
              {entry.thread.title.length > 26 ? `${entry.thread.title.slice(0, 25)}…` : entry.thread.title}
            </text>
            <line x1={LANE_LABEL} y1={y} x2={width - LANE_PADDING} y2={y} stroke="#262626" strokeWidth={1} />
            {entry.first !== null && entry.last !== null && (
              <line x1={x(entry.first)} y1={y} x2={x(entry.last)} y2={y} stroke={accent} strokeWidth={2} opacity={0.5} />
            )}
            {entry.beats.map((beat) =>
              beat.mark === 'turn' ? (
                <rect
                  key={beat.sceneId}
                  x={x(beat.position) - 4}
                  y={y - 4}
                  width={8}
                  height={8}
                  transform={`rotate(45 ${x(beat.position)} ${y})`}
                  fill={accent}
                >
                  <title>{`${beat.sceneTitle} · ${beat.text ?? ''}`}</title>
                </rect>
              ) : (
                <circle
                  key={beat.sceneId}
                  cx={x(beat.position)}
                  cy={y}
                  r={4}
                  fill={beat.status === 'written' ? accent : 'none'}
                  stroke={accent}
                  strokeWidth={1.5}
                  strokeDasharray={beat.status === 'outline' ? '2 2' : undefined}
                >
                  <title>{beat.sceneTitle}</title>
                </circle>
              )
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Where the book is dense and where it goes quiet. */
function Density({ bars, sceneCount }: { bars: number[]; sceneCount: number }) {
  const peak = Math.max(1, ...bars);
  return (
    <section className="mt-3" data-testid="arcs-density">
      <h3 className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-600">{t('Dónde se concentra')}</h3>
      <div className="flex h-10 items-end gap-0.5">
        {bars.map((value, index) => (
          <span
            key={index}
            className="flex-1 rounded-sm bg-indigo-500 dark:bg-indigo-800/70"
            style={{ height: `${Math.max(2, (value / peak) * 100)}%` }}
            title={tx('{count} hitos', { count: String(value) })}
          />
        ))}
      </div>
      <p className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-600">
        {tx('A lo largo de {count} escenas, en orden de relato.', { count: String(sceneCount) })}
      </p>
    </section>
  );
}

/**
 * The arc sheet.
 *
 * The want/need/flaw fields are a READ-ONLY mirror of `character_profiles`: they belong to
 * the character, and copying them here would give a writer two places to change one
 * sentence and no way to tell which one the app believes.
 */
function ArcSheet({
  plotted,
  arcFields,
  sceneCount,
}: {
  plotted: PlottedThread;
  arcFields: ArcData['arcFields'];
  sceneCount: number;
}) {
  const subject = plotted.thread.parties.find((party) => party.side === 'subject') ?? plotted.thread.parties[0];
  const fields = subject?.partyKind === 'character' ? arcFields.get(subject.partyId) : undefined;

  return (
    <section className={`${PERSON_DOSSIER_SECTION_CLASS} mt-4`} data-testid="arc-sheet">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{plotted.thread.title}</h3>
        {subject && (
          <span className="text-[11px] text-neutral-600 dark:text-neutral-500">
            {subject.partyName} · {t(PARTY_SIDE_LABEL[subject.side])}
          </span>
        )}
        <span className="ml-auto text-[11px] text-neutral-500 dark:text-neutral-600">
          {plotted.last !== null
            ? tx('cierra en la escena {scene} de {total}', {
                scene: String(plotted.last + 1),
                total: String(sceneCount),
              })
            : t('sin cerrar')}
        </span>
      </div>

      {fields && (fields.want || fields.need) && (
        <dl className="mb-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[11px]">
          {(['want', 'need'] as const).map((id) => (
            <div key={id} className="contents">
              <dt className="text-neutral-500 dark:text-neutral-600">
                {t(CHARACTER_ARC_FIELDS.find((field) => field.id === id)?.label ?? id)}
              </dt>
              <dd className="text-neutral-700 dark:text-neutral-300">{fields[id] ?? '—'}</dd>
            </div>
          ))}
        </dl>
      )}

      <ul className="space-y-0.5">
        {plotted.beats.map((beat) => (
          <li key={beat.sceneId} className="flex items-baseline gap-2 text-[11px]">
            <span className="w-12 shrink-0 text-neutral-500 dark:text-neutral-600">{beat.position + 1}</span>
            <span className="shrink-0 rounded bg-neutral-200 dark:bg-neutral-800 px-1 text-[10px] text-neutral-600 dark:text-neutral-400">
              {t(BEAT_MARK_LABEL[beat.mark])}
            </span>
            <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">
              {beat.text ?? beat.sceneTitle}
            </span>
          </li>
        ))}
        {plotted.beats.length === 0 && (
          <li className="text-[11px] text-neutral-500 dark:text-neutral-600">{t('Ninguna escena lo mueve todavía.')}</li>
        )}
      </ul>
    </section>
  );
}

/** Where the book sags. Reported as runs, because one quiet scene is breathing. */
function InertScenes({
  runs,
  sceneCount,
  onNavigate,
}: {
  runs: ReturnType<typeof findInertScenes>;
  sceneCount: number;
  onNavigate?: (view: View) => void;
}) {
  const worst = runs.filter((run) => run.scenes.length >= 2).slice(0, 4);
  if (worst.length === 0) return null;
  return (
    <section className="mt-4 rounded-lg border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/10 p-3" data-testid="arcs-inert">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        {t('Tramos que no mueven nada')}
      </h3>
      <ul className="space-y-0.5">
        {worst.map((run) => (
          <li key={run.from} className="text-[11px] text-neutral-700 dark:text-neutral-300">
            ·{' '}
            {tx('{count} escenas seguidas, de la {from} a la {to} de {total}', {
              count: String(run.scenes.length),
              from: String(run.from + 1),
              to: String(run.to + 1),
              total: String(sceneCount),
            })}
            <span className="ml-1 text-neutral-500 dark:text-neutral-600">{run.scenes.map((scene) => scene.title).join(' · ')}</span>
          </li>
        ))}
      </ul>
      <button
        className="btn btn-ghost mt-2 border border-neutral-300 dark:border-neutral-700 px-2 text-[11px]"
        onClick={() => onNavigate?.('scenes')}
      >
        {t('Ir a Escenas')}
      </button>
    </section>
  );
}

/** The shape of the ending, in one list. */
function ClosingOrder({
  closing,
  sceneCount,
}: {
  closing: { thread: WorldThread; last: number | null }[];
  sceneCount: number;
}) {
  if (closing.length < 2) return null;
  return (
    <section className={`${PERSON_DOSSIER_SECTION_CLASS} mt-4`} data-testid="arcs-closing">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">
        {t('El orden en que cierran')}
      </h3>
      <ol className="space-y-0.5">
        {closing.map((entry) => (
          <li key={entry.thread.threadId} className="flex items-baseline gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">{entry.thread.title}</span>
            <span className="shrink-0 text-neutral-500 dark:text-neutral-600">
              {entry.last === null
                ? t('sin cerrar')
                : tx('escena {scene} de {total}', { scene: String(entry.last + 1), total: String(sceneCount) })}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export { rankScenes };
