import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorldBodyHit, WorldEntry, WorldEntryKind } from '@shared/types';
import type { View } from '../navigation';
import type { WorldFilterState } from '@shared/worldFilters';
import {
  ARTICLE_CATEGORIES,
  ARTICLE_CATEGORY_LABEL,
  WORLD_ENTRY_KINDS,
  WORLD_ENTRY_KIND_LABEL,
  WORLD_LINK_FIELD_LABEL,
  entryKey,
  parseEntryKey,
} from '@shared/worldEncyclopedia';
import type { WorldSectionDef } from '../components/world/WorldWorkspace';
import { WorldWorkspace } from '../components/world/WorldWorkspace';
import { WorldEntryReader } from '../components/world/WorldEntryReader';
import { NewArticleModal } from '../components/world/NewArticleModal';
import { MissingEntriesPanel } from '../components/world/MissingEntriesPanel';
import { WorldBibleModal } from '../components/world/WorldBibleModal';
import { Icon } from '../components/ui';
import { notifyDataChanged } from '../hooks';
import { t, tx } from '../i18n';

/** The icon each kind wears in the index, so a line is identifiable before it is read. */
export const WORLD_ENTRY_KIND_ICON: Record<WorldEntryKind, string> = {
  article: 'book',
  character: 'users',
  place: 'map',
  group: 'network',
  scene: 'image',
  map: 'map',
  conflict: 'scale',
  rule: 'lock',
};

/**
 * The encyclopedia: one A–Z index over the whole world.
 *
 * Two kinds of entry share it. An `article` is native and editable — it exists for the
 * lore that hangs off no entity, which until now had nowhere to live but the notes field
 * of the nearest sheet. Everything else is a READ-TIME PROJECTION of a row that lives in
 * its own section, so nothing here is a second copy of anything.
 *
 * That is also why the section descriptor is so short: browsing, searching, faceting and
 * the split layout all belong to {@link WorldWorkspace}, which the other five sections
 * already use. What is genuinely about an encyclopedia is the A–Z presentation, the
 * "sin desarrollar" facet, and the full-text footer.
 */
function encyclopediaSection(onNavigate?: (view: View) => void): WorldSectionDef<WorldEntry> {
  return {
    id: 'encyclopedia',
    icon: 'book',
    title: 'Enciclopedia',
    searchPlaceholder: 'Buscar en todo el mundo…',
    createLabel: 'Nuevo artículo',
    emptyLabel: 'Este mundo todavía está vacío.',
    noMatchLabel: 'Ninguna entrada coincide con el filtro.',
    presentation: 'index',
    load: () => window.nodus.listWorldEntries(),
    idOf: (entry) => entry.key,
    labelOf: (entry) => entry.title,
    facets: [
      {
        id: 'kind',
        label: 'Tipo de entrada',
        source: 'vocabulary',
        vocabulary: WORLD_ENTRY_KINDS.map((kind) => ({ id: kind, label: WORLD_ENTRY_KIND_LABEL[kind] })),
      },
      // The taxonomy of whatever the entry actually is: an article's category, a place's
      // kind, a character's species. Drawn from the vault rather than from a catalogue —
      // a world with three species must not be offered a list of thirty.
      { id: 'category', label: 'Clase', source: 'distinct' },
      {
        id: 'state',
        label: 'Estado',
        source: 'vocabulary',
        // The writer's real question about an encyclopedia, and the reason this facet
        // exists at all: what have I named but never written?
        vocabulary: [
          { id: 'written', label: 'Con texto' },
          { id: 'stub', label: 'Sin desarrollar' },
        ],
      },
    ],
    facetValues: (entry) => ({
      kind: entry.kind,
      category: entry.category,
      state: entry.stub ? 'stub' : 'written',
    }),
    searchText: (entry) => [entry.title, ...entry.aliases, entry.summary ?? ''],
    Card: EntryRow,
    Sheet: ({ item, onChanged, onBack, onSelect }) => (
      <WorldEntryReader
        entry={item}
        onChanged={onChanged}
        onBack={onBack}
        onSelect={onSelect}
        onNavigate={onNavigate}
      />
    ),
    Footer: FullTextFooter,
    HeaderActions: ExportAction,
  };
}

/** `onNavigate` must be referentially stable (App passes the `setView` setter): the
 *  section object is a dependency of the workspace's loader, so a new one each render
 *  would re-fetch the whole index on every keystroke. */
export function EncyclopediaView({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const section = useMemo(() => encyclopediaSection(onNavigate), [onNavigate]);
  return (
    <WorldWorkspace
      section={section}
      createModal={(close, created) => (
        <NewArticleModal
          onClose={close}
          // The workspace selects by whatever `idOf` returns, and for the encyclopedia
          // that is the kind-qualified KEY, not the article id. Handing it the bare id
          // leaves the newly created entry unselected and the reading pane blank — which
          // is exactly what a writer would call "it didn't save".
          onCreated={(articleId) => created(entryKey({ kind: 'article', id: articleId }))}
        />
      )}
    />
  );
}

/** The world bible lives here rather than in Settings: it is the encyclopedia leaving the
 *  app, and this is the only screen where the whole world is on display. */
function ExportAction() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="btn btn-ghost h-9 gap-1.5 border border-neutral-700 px-2 text-xs"
        data-testid="export-world-bible"
        onClick={() => setOpen(true)}
      >
        <Icon name="download" size={14} /> {t('Biblia del mundo')}
      </button>
      {open && <WorldBibleModal onClose={() => setOpen(false)} />}
    </>
  );
}

function EntryRow({ item, compact, onOpen }: { item: WorldEntry; compact: boolean; onOpen: () => void }) {
  return (
    <button
      data-testid="encyclopedia-entry"
      data-entry-kind={item.kind}
      onClick={onOpen}
      title={item.title}
      className="flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-indigo-700/60 hover:bg-indigo-950/20"
    >
      <Icon name={WORLD_ENTRY_KIND_ICON[item.kind]} size={14} className="mt-0.5 shrink-0 text-neutral-600" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-sm text-neutral-100">{item.title}</span>
          {item.stub && (
            <span className="shrink-0 rounded bg-neutral-800 px-1 text-[9px] uppercase tracking-wide text-neutral-500">
              {t('Sin desarrollar')}
            </span>
          )}
        </span>
        {!compact && item.summary && (
          <span className="mt-0.5 line-clamp-1 block text-[11px] text-neutral-500">{item.summary}</span>
        )}
        {!compact && !item.summary && item.aliases.length > 0 && (
          <span className="mt-0.5 line-clamp-1 block text-[11px] text-neutral-600">{item.aliases.join(' · ')}</span>
        )}
      </span>
    </button>
  );
}

/**
 * The second tier of the search.
 *
 * The box above narrows the index instantly, in the renderer, over titles and summaries.
 * That is the right default — it is free and it is what an index is for — but it cannot
 * find a word that appears only in the middle of a character's backstory. This offers
 * that search explicitly, on demand, so the fast path stays fast.
 */
function FullTextFooter({ filter, onOpen }: { filter: WorldFilterState; onOpen: (id: string) => void }) {
  return (
    <>
      <FullTextSearch filter={filter} onOpen={onOpen} />
      {/* The index answers "what is in this world"; this answers "what is missing from
          it", which is the question a writer actually has once the index exists. */}
      <MissingEntriesPanel onChanged={async () => notifyDataChanged()} />
    </>
  );
}

function FullTextSearch({ filter, onOpen }: { filter: WorldFilterState; onOpen: (id: string) => void }) {
  const query = filter.search.trim();
  const [hits, setHits] = useState<WorldBodyHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  // A new query invalidates the previous answer: leaving it on screen under a different
  // search term is the kind of stale result somebody acts on.
  useEffect(() => {
    setHits(null);
  }, [query]);

  const run = useCallback(async () => {
    setSearching(true);
    try {
      setHits(await window.nodus.searchWorldBodies(query));
    } finally {
      setSearching(false);
    }
  }, [query]);

  if (query.length < 2) return null;

  return (
    <div className="mt-2 border-t border-neutral-800 pt-2" data-testid="encyclopedia-fulltext">
      {hits === null ? (
        <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => void run()} disabled={searching}>
          {searching ? t('Buscando…') : tx('Buscar «{query}» en el texto completo', { query })}
        </button>
      ) : hits.length === 0 ? (
        <p className="text-xs text-neutral-600">{tx('«{query}» no aparece en ningún texto del mundo.', { query })}</p>
      ) : (
        <>
          <p className="mb-1 text-[11px] uppercase tracking-wider text-neutral-600">
            {tx('{count} en el texto completo', { count: String(hits.length) })}
          </p>
          <ul className="space-y-1">
            {hits.map((hit) => (
              <li key={`${hit.key}:${hit.field}`}>
                <button
                  onClick={() => onOpen(hit.key)}
                  className="w-full rounded border border-neutral-800 px-2 py-1 text-left hover:border-indigo-700/60"
                >
                  <span className="block truncate text-xs text-neutral-200">
                    {hit.title}
                    <span className="ml-1 text-[10px] text-neutral-600">
                      {t(WORLD_LINK_FIELD_LABEL[hit.field] ?? hit.field)}
                    </span>
                  </span>
                  <span className="line-clamp-2 block text-[11px] leading-4 text-neutral-500">{hit.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Shared by the reader and the create modal, so a category chip reads the same in both. */
export const ARTICLE_CATEGORY_OPTIONS = ARTICLE_CATEGORIES.map((id) => ({ id, label: ARTICLE_CATEGORY_LABEL[id] }));

export { entryKey, parseEntryKey };
