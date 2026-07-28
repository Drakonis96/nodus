import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ThreadPartySide, WorldBeat, WorldThread } from '@shared/types';
import {
  BEAT_MARK_LABEL,
  PARTY_SIDE_LABEL,
  THREAD_SCOPE_LABEL,
  THREAD_STATUS_LABEL,
  findCrossedLoyalties,
  findStakeGaps,
  suggestThreadScenes,
  threadBoard,
  type BoardCastMember,
  type StakeGap,
} from '@shared/worldThreads';
import type { View } from '../navigation';
import type { WorldSectionDef } from '../components/world/WorldWorkspace';
import { WorldWorkspace } from '../components/world/WorldWorkspace';
import { AutoSavingField } from '../components/AutoSavingField';
import { Icon } from '../components/ui';
import { confirm } from '../components/feedback';
import { PERSON_DOSSIER_SECTION_CLASS } from '../components/personDossierLayout';
import { notifyDataChanged } from '../hooks';
import { t, tx } from '../i18n';

/** The three columns of a conflict, in the order a writer thinks them. */
const SIDES: ThreadPartySide[] = ['wants', 'opposes', 'caught'];

/**
 * Conflicts: who wants what, against whom, and what it costs.
 *
 * OPENS ON A BOARD, not a list. Cast × conflicts is the one thing a writer cannot hold in
 * their head past fifteen characters; the CRUD around it is infrastructure. And the
 * primary way a conflict gets CREATED is not here at all — it is the strip on the scene
 * sheet, because that is where eighty per cent of them are born.
 */
export function ConflictsView({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const [tab, setTab] = useState<'board' | 'list'>('board');
  const section = useMemo(() => conflictsSection(onNavigate), [onNavigate]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 px-4 pt-3">
        {(['board', 'list'] as const).map((entry) => (
          <button
            key={entry}
            data-testid={`conflicts-tab-${entry}`}
            onClick={() => setTab(entry)}
            className={`rounded-t-lg px-3 py-1.5 text-sm ${
              tab === entry ? 'bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100' : 'text-neutral-600 dark:text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300'
            }`}
          >
            {t(entry === 'board' ? 'Tablero' : 'Lista')}
          </button>
        ))}
      </div>
      {tab === 'board' ? <ConflictBoard onNavigate={onNavigate} /> : <WorldWorkspace section={section} />}
    </div>
  );
}

function conflictsSection(onNavigate?: (view: View) => void): WorldSectionDef<WorldThread> {
  return {
    id: 'conflicts',
    icon: 'scale',
    title: 'Conflictos',
    searchPlaceholder: 'Buscar conflictos…',
    createLabel: 'Nuevo conflicto',
    emptyLabel: 'Todavía no hay conflictos. Se crean desde la escena que los enciende.',
    noMatchLabel: 'Ningún conflicto coincide con el filtro.',
    presentation: 'list',
    load: async () => (await window.nodus.listWorldThreads('conflict')),
    idOf: (thread) => thread.threadId,
    // Only a conflict is an entry of the world: an arc is spoiler by nature and is not
    // indexed, so a question captured on one would have nowhere to point.
    anchorOf: (thread) =>
      thread.kind === 'conflict' ? { kind: 'conflict', id: thread.threadId, title: thread.title } : null,
    labelOf: (thread) => thread.title,
    facets: [
      {
        id: 'status',
        label: 'Estado',
        source: 'vocabulary',
        vocabulary: (['open', 'resolved', 'archived'] as const).map((status) => ({
          id: status,
          label: THREAD_STATUS_LABEL[status],
        })),
      },
      // Multi-valued: a war has three sides, and "everything Kestra is caught up in" is
      // the question a writer actually asks.
      { id: 'party', label: 'Parte', source: 'distinct', multiValue: true },
    ],
    facetValues: (thread) => ({
      status: thread.status,
      party: thread.parties.map((party) => party.partyName),
    }),
    searchText: (thread) => [thread.title, thread.pitch ?? '', ...thread.parties.map((party) => party.partyName)],
    Card: ConflictRow,
    Sheet: ({ item, onChanged, onBack }) => (
      <ConflictSheet thread={item} onChanged={onChanged} onBack={onBack} onNavigate={onNavigate} />
    ),
  };
}

function ConflictRow({ item, compact, onOpen }: { item: WorldThread; compact: boolean; onOpen: () => void }) {
  return (
    <button
      data-testid="conflict-row"
      onClick={onOpen}
      className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-left transition-colors hover:border-indigo-400 dark:hover:border-violet-700/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/20"
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-900 dark:text-neutral-100">{item.title}</span>
        <span className="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-600">{t(THREAD_STATUS_LABEL[item.status])}</span>
      </span>
      {!compact && item.parties.length > 0 && (
        <span className="mt-0.5 block truncate text-[11px] text-neutral-600 dark:text-neutral-500">
          {item.parties.map((party) => `${party.partyName} (${t(PARTY_SIDE_LABEL[party.side])})`).join(' · ')}
        </span>
      )}
      {!compact && item.pitch && (
        <span className="mt-0.5 line-clamp-1 block text-[11px] text-neutral-500 dark:text-neutral-600">{item.pitch}</span>
      )}
    </button>
  );
}

/**
 * The board.
 *
 * A local component, not a shell presentation: comparing a cast against a set of columns
 * is the opposite of "a collection of interchangeable items", and generalising it into
 * `WorldWorkspace` for one consumer would be a contract with one caller.
 */
function ConflictBoard({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const [data, setData] = useState<{
    cast: BoardCastMember[];
    threads: WorldThread[];
    affiliations: { personId: string; personName: string; groupId: string; groupName: string }[];
  } | null>(null);

  const load = useCallback(async () => {
    setData(await window.nodus.threadBoardData());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const board = useMemo(() => (data ? threadBoard({ cast: data.cast, threads: data.threads }) : null), [data]);
  const gaps = useMemo(() => (data ? findStakeGaps({ cast: data.cast, threads: data.threads }) : []), [data]);
  const crossed = useMemo(
    () => (data ? findCrossedLoyalties(data.threads, data.affiliations) : []),
    [data]
  );

  if (!board) return <p className="p-6 text-sm text-neutral-600 dark:text-neutral-500">{t('Cargando…')}</p>;

  if (board.columns.length === 0) {
    return (
      <div className="p-6" data-testid="conflicts-board">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('Todavía no hay conflictos.')}</p>
        <p className="mt-1 max-w-xl text-xs leading-5 text-neutral-500 dark:text-neutral-600">
          {t('Se crean desde la ficha de la escena que los enciende, con las partes ya puestas a partir del reparto. Aquí verás el tablero de quién tiene algo en juego y quién no.')}
        </p>
        <button className="btn btn-ghost mt-3 border border-neutral-300 dark:border-neutral-700 text-xs" onClick={() => onNavigate?.('scenes')}>
          {t('Ir a Escenas')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="conflicts-board">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white dark:bg-neutral-950 p-2 text-left text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-600">
              {t('Reparto')}
            </th>
            {board.columns.map((thread) => (
              <th key={thread.threadId} className="p-2 text-left align-bottom">
                <span className="block max-w-28 truncate text-[11px] font-normal text-neutral-700 dark:text-neutral-300" title={thread.title}>
                  {thread.title}
                </span>
              </th>
            ))}
            {/* Read-only mirror of `character_profiles`: shown so "wants nothing here and
                wants nothing on their sheet either" is one glance, never copied. */}
            <th className="p-2 text-left text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-600">{t('Quiere')}</th>
          </tr>
        </thead>
        <tbody>
          {board.rows.map((row) => (
            <tr key={row.person.personId} data-testid="conflicts-board-row" data-stakes={row.stakes}>
              <th className="sticky left-0 z-10 bg-white dark:bg-neutral-950 p-2 text-left font-normal">
                <span className="block max-w-40 truncate text-neutral-800 dark:text-neutral-200">{row.person.displayName}</span>
                <span className="block text-[10px] text-neutral-500 dark:text-neutral-600">
                  {tx('{count} escenas', { count: String(row.person.sceneCount) })}
                </span>
              </th>
              {row.cells.map((side, index) => (
                <td key={board.columns[index].threadId} className="border-t border-neutral-200 dark:border-neutral-900 p-1 text-center">
                  {side ? (
                    <span
                      className={`inline-block rounded px-1 py-0.5 text-[10px] ${
                        side === 'opposes'
                          ? 'bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-300'
                          : side === 'caught'
                            ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                            : 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                      }`}
                    >
                      {t(PARTY_SIDE_LABEL[side])}
                    </span>
                  ) : (
                    <span className="text-neutral-300 dark:text-neutral-800">·</span>
                  )}
                </td>
              ))}
              <td className="max-w-48 border-t border-neutral-200 dark:border-neutral-900 p-2 text-[11px] text-neutral-600 dark:text-neutral-500">
                <span className="line-clamp-1">{row.person.arcWant ?? '—'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {gaps.length > 0 && <StakeGaps gaps={gaps} onNavigate={onNavigate} />}
      {crossed.length > 0 && (
        <section className="mt-4 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3" data-testid="conflicts-crossed">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">
            {t('Lealtades cruzadas')}
          </h3>
          <p className="mb-2 text-[10px] text-neutral-500 dark:text-neutral-600">
            {t('Están en una facción que pelea en el bando contrario al suyo.')}
          </p>
          <ul className="space-y-0.5">
            {crossed.map((entry) => (
              <li key={`${entry.threadId}:${entry.personId}:${entry.groupId}`} className="text-[11px] text-neutral-600 dark:text-neutral-400">
                · {tx('{person} ({side}) milita en {group}, que {groupSide} en «{thread}»', {
                  person: entry.personName,
                  side: t(PARTY_SIDE_LABEL[entry.personSide]).toLowerCase(),
                  group: entry.groupName,
                  groupSide: t(PARTY_SIDE_LABEL[entry.groupSide]).toLowerCase(),
                  thread: entry.threadTitle,
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The diagnosis the board exists for, spelled out under it. */
function StakeGaps({ gaps, onNavigate }: { gaps: StakeGap[]; onNavigate?: (view: View) => void }) {
  const silent = gaps.filter((gap) => gap.kind === 'silent');
  return (
    <section className="mt-4 rounded-lg border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/10 p-3" data-testid="conflicts-gaps">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        {t('Salen en escena y no quieren nada')}
      </h3>
      <ul className="space-y-0.5">
        {gaps.slice(0, 10).map((gap) => (
          <li key={gap.personId} className="text-[11px] text-neutral-700 dark:text-neutral-300">
            · {gap.displayName}
            <span className="ml-1 text-neutral-500 dark:text-neutral-600">
              {tx('{count} escenas', { count: String(gap.sceneCount) })}
              {gap.kind === 'silent'
                ? ` · ${t('ni conflicto ni objetivo')}`
                : ` · ${t('le falta una de las dos cosas')}`}
            </span>
          </li>
        ))}
      </ul>
      {silent.length > 0 && (
        <button
          className="btn btn-ghost mt-2 border border-neutral-300 dark:border-neutral-700 px-2 text-[11px]"
          onClick={() => onNavigate?.('scenes')}
        >
          {t('Crear un conflicto desde una escena')}
        </button>
      )}
    </section>
  );
}

function ConflictSheet({
  thread,
  onChanged,
  onBack,
  onNavigate,
}: {
  thread: WorldThread;
  onChanged: () => Promise<void>;
  onBack: () => void;
  onNavigate?: (view: View) => void;
}) {
  const [beats, setBeats] = useState<WorldBeat[]>([]);
  const [suggestions, setSuggestions] = useState<{ sceneId: string; title: string; present: string[] }[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [allBeats, context] = await Promise.all([
        window.nodus.listWorldBeats(),
        window.nodus.threadSceneContext(),
      ]);
      if (!active) return;
      setBeats(allBeats.filter((beat) => beat.threadId === thread.threadId));
      setSuggestions(suggestThreadScenes({ thread, beats: allBeats, ...context }).slice(0, 6));
    })();
    return () => {
      active = false;
    };
  }, [thread, thread.updatedAt]);

  const save = async (patch: Parameters<typeof window.nodus.updateWorldThread>[1]) => {
    await window.nodus.updateWorldThread(thread.threadId, patch);
    await onChanged();
    notifyDataChanged();
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Eliminar el conflicto'),
      message: t('Los personajes y las escenas no se borran: solo dejan de estar en este conflicto.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteWorldThread(thread.threadId);
    onBack();
    await onChanged();
    notifyDataChanged();
  };

  return (
    <div className="space-y-5 p-6" data-testid="conflict-sheet">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button className="mb-2 flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200" onClick={onBack}>
            <Icon name="chevronLeft" size={13} /> {t('Volver')}
          </button>
          <h2 className="text-xl font-semibold">{thread.title}</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {[t(THREAD_STATUS_LABEL[thread.status]), t(THREAD_SCOPE_LABEL[thread.scope])].join(' · ')}
          </p>
        </div>
        <button
          className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-red-600 dark:text-red-300 hover:text-red-700 dark:hover:text-red-200"
          title={t('Eliminar')}
          onClick={() => void remove()}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="conflict-parties">
        <div className="grid gap-3 sm:grid-cols-3">
          {SIDES.map((side) => (
            <div key={side}>
              <h3 className="mb-1 text-[10px] uppercase tracking-wide text-neutral-600 dark:text-neutral-500">{t(PARTY_SIDE_LABEL[side])}</h3>
              <ul className="space-y-0.5">
                {thread.parties.filter((party) => party.side === side).map((party) => (
                  <li key={`${party.partyKind}:${party.partyId}`} className="truncate text-xs text-neutral-800 dark:text-neutral-200">
                    {party.partyName}
                  </li>
                ))}
                {thread.parties.every((party) => party.side !== side) && (
                  <li className="text-[11px] text-neutral-400 dark:text-neutral-700">{t('Nadie')}</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className={PERSON_DOSSIER_SECTION_CLASS}>
        <AutoSavingField
          label={t('De qué va')}
          hint={t('Quién quiere qué contra quién. Puedes enlazar con [[dobles corchetes]].')}
          value={thread.pitch}
          placeholder={t('El paso del vado, y quién cobra por cruzarlo…')}
          field="pitch"
          onSave={(value) => save({ pitch: value })}
          rows={3}
        />
        <AutoSavingField
          label={t('Qué se pierde')}
          hint={t('Lo que está en juego si esto se pierde.')}
          value={thread.stakes}
          placeholder={t('Si cae el vado, el norte queda aislado…')}
          field="stakes"
          onSave={(value) => save({ stakes: value })}
          rows={2}
        />
        <label className="mt-2 block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-600 dark:text-neutral-500">{t('Estado')}</span>
          <select
            className="input h-9 w-full text-sm"
            value={thread.status}
            onChange={(event) => void save({ status: event.target.value as WorldThread['status'] })}
          >
            {(['open', 'resolved', 'archived'] as const).map((status) => (
              <option key={status} value={status}>
                {t(THREAD_STATUS_LABEL[status])}
              </option>
            ))}
          </select>
        </label>
        {/* Shown only once it is resolved: a permanently grey field is a permanent reproach. */}
        {thread.status === 'resolved' && (
          <AutoSavingField
            label={t('Cómo acaba')}
            value={thread.outcome}
            placeholder={t('En tus palabras…')}
            field="outcome"
            onSave={(value) => save({ outcome: value })}
            rows={2}
          />
        )}
      </section>

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="conflict-beats">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">{t('Cómo se mueve')}</h3>
        {beats.length === 0 ? (
          <p className="text-[11px] leading-4 text-neutral-500 dark:text-neutral-600">
            {t('Ninguna escena lo mueve todavía. Se marca desde la ficha de la escena, no desde aquí.')}
          </p>
        ) : (
          <ul className="space-y-1">
            {[...beats]
              .sort((a, b) => a.narrativeOrder - b.narrativeOrder)
              .map((beat) => (
                <li key={beat.sceneId} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0 rounded bg-neutral-200 dark:bg-neutral-800 px-1 text-[10px] text-neutral-600 dark:text-neutral-400">
                    {t(BEAT_MARK_LABEL[beat.mark])}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{beat.sceneTitle}</span>
                  {beat.subjectName && <span className="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-600">{beat.subjectName}</span>}
                </li>
              ))}
          </ul>
        )}
      </section>

      {suggestions.length > 0 && (
        <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="conflict-suggestions">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">{t('Podría pasar en')}</h3>
          <p className="mb-2 text-[10px] text-neutral-500 dark:text-neutral-600">
            {t('Escenas donde estaban los dos bandos y no has dicho que pasara nada.')}
          </p>
          <ul className="space-y-0.5">
            {suggestions.map((suggestion) => (
              <li key={suggestion.sceneId} className="truncate text-[11px] text-neutral-600 dark:text-neutral-400">
                · {suggestion.title}
                <span className="ml-1 text-neutral-500 dark:text-neutral-600">{suggestion.present.join(', ')}</span>
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
      )}
    </div>
  );
}

/**
 * What this character has at stake, on their own sheet.
 *
 * Exported for the character dossier, the same way `CharacterAppearancesSection` comes out
 * of ScenesView. The empty state is the point: "no tiene nada en juego con nadie" is the
 * single most useful sentence this section can put in front of a writer.
 */
export function CharacterThreadsSection({ personId }: { personId: string }) {
  const [threads, setThreads] = useState<WorldThread[]>([]);

  useEffect(() => {
    let active = true;
    void window.nodus.threadsForParty('character', personId).then((next) => {
      if (active) setThreads(next);
    });
    return () => {
      active = false;
    };
  }, [personId]);

  const conflicts = threads.filter((thread) => thread.kind === 'conflict');
  if (conflicts.length === 0) {
    return (
      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-threads">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">{t('Qué tiene en juego')}</h3>
        <p className="text-[11px] leading-4 text-neutral-500 dark:text-neutral-600">{t('No tiene nada en juego con nadie.')}</p>
      </section>
    );
  }

  return (
    <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="character-threads">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">{t('Qué tiene en juego')}</h3>
      <ul className="space-y-1">
        {conflicts.map((thread) => {
          const side = thread.parties.find(
            (party) => party.partyKind === 'character' && party.partyId === personId
          );
          return (
            <li key={thread.threadId} className="flex items-baseline gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{thread.title}</span>
              {side && <span className="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-600">{t(PARTY_SIDE_LABEL[side.side])}</span>}
              <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-700">{t(THREAD_STATUS_LABEL[thread.status])}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
