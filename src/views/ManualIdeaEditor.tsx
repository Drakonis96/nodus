// Structured editor for a manual idea — a user-authored idea that lives in the
// graph. It mirrors the shape of an app-generated idea note: title, summary,
// works that develop it (linked from the Zotero-backed library), anchored
// evidence (quote + page), and connections to other ideas (added by hand or by
// indexing the idea and accepting semantic suggestions). Saving persists the
// idea + its occurrences/evidence/edges and rewrites the owning note's Markdown.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  EdgeType,
  IdeaCandidate,
  ManualIdeaConnection,
  ManualIdeaEvidence,
  ManualIdeaWorkLink,
  Note,
  WorkView,
} from '@shared/types';
import { Badge, EDGE_LABELS, Icon } from '../components/ui';
import { buildIdeaNote } from '../notes';
import type { PendingGraphNavigationTarget } from '../navigation';
import { t, tx } from '../i18n';

const EDGE_TYPES: EdgeType[] = [
  'refines',
  'extends',
  'supports',
  'contradicts',
  'refutes',
  'applies_to',
  'shares_method',
  'precondition_of',
  'measures_same',
  'variant_of',
  'contains',
];

type WorkRow = ManualIdeaWorkLink & { title: string; authors: string[]; year: number | null };

export function ManualIdeaEditor({
  note,
  globalId,
  onSaved,
  onOpenGraph,
}: {
  note: Note;
  globalId: string;
  onSaved: () => void;
  onOpenGraph?: (target: PendingGraphNavigationTarget) => void;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [evidence, setEvidence] = useState<ManualIdeaEvidence[]>([]);
  const [connections, setConnections] = useState<ManualIdeaConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [indexing, setIndexing] = useState(false);
  const [indexMsg, setIndexMsg] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<IdeaCandidate[]>([]);

  // Load the idea's structured data into editable state.
  useEffect(() => {
    let on = true;
    setLoading(true);
    void Promise.all([window.nodus.getIdeaDetail(globalId), window.nodus.getIdeaEdges(globalId)]).then(
      ([detail, edges]) => {
        if (!on) return;
        if (detail) {
          setTitle(detail.idea.label);
          setSummary(detail.idea.statement);
          setWorks(
            detail.occurrences.map((o) => ({
              nodusId: o.nodus_id,
              development: o.development ?? '',
              title: o.work.title,
              authors: o.work.authors,
              year: o.work.year,
            }))
          );
          setEvidence(
            detail.evidence.map((e) => ({ nodusId: e.nodus_id || null, quote: e.quote, location: e.location }))
          );
        }
        setConnections(
          edges.map((e) => {
            const outgoing = e.edge.from_id === globalId;
            return {
              toId: outgoing ? e.edge.to_id : e.edge.from_id,
              toLabel: outgoing ? e.toLabel : e.fromLabel,
              type: e.edge.type as EdgeType,
              confidence: e.edge.confidence,
              basis: e.edge.basis,
            };
          })
        );
        setDirty(false);
        setSuggestions([]);
        setIndexMsg(null);
        setLoading(false);
      }
    );
    return () => {
      on = false;
    };
  }, [globalId]);

  const markDirty = useCallback(() => setDirty(true), []);

  const excludeIds = useMemo(
    () => [globalId, ...connections.map((c) => c.toId)],
    [globalId, connections]
  );

  const addWork = useCallback(
    (w: WorkView) => {
      setWorks((prev) =>
        prev.some((x) => x.nodusId === w.nodus_id)
          ? prev
          : [...prev, { nodusId: w.nodus_id, development: '', title: w.title, authors: w.authors, year: w.year }]
      );
      markDirty();
    },
    [markDirty]
  );

  const addConnection = useCallback(
    (cand: IdeaCandidate, basis: ManualIdeaConnection['basis']) => {
      setConnections((prev) =>
        prev.some((c) => c.toId === cand.global_id)
          ? prev
          : [
              ...prev,
              {
                toId: cand.global_id,
                toLabel: cand.label,
                type: 'refines',
                confidence: cand.similarity != null ? Number(cand.similarity.toFixed(2)) : 0.9,
                basis,
              },
            ]
      );
      setSuggestions((prev) => prev.filter((s) => s.global_id !== cand.global_id));
      markDirty();
    },
    [markDirty]
  );

  const runAutoIndex = useCallback(async () => {
    setIndexing(true);
    setIndexMsg(null);
    try {
      const res = await window.nodus.autoIndexManualIdea({
        globalId,
        title,
        summary,
        excludeIds: connections.map((c) => c.toId),
      });
      setSuggestions(res.suggestions);
      setIndexMsg(
        res.message ??
          (res.suggestions.length
            ? tx('Indexada. {n} idea(s) relacionada(s) encontrada(s).', { n: res.suggestions.length })
            : t('Indexada. No se encontraron ideas relacionadas todavía.'))
      );
    } finally {
      setIndexing(false);
    }
  }, [globalId, title, summary, connections]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await window.nodus.saveManualIdea({
        globalId,
        noteId: note.id,
        title,
        summary,
        works: works.map((w) => ({ nodusId: w.nodusId, development: w.development })),
        evidence: evidence.filter((e) => e.quote.trim()),
        connections,
      });
      // Rewrite the owning note's Markdown so the list snippet and search stay useful.
      const fresh = await window.nodus.getIdeaDetail(globalId);
      const content = fresh ? buildIdeaNote(fresh) : '';
      await window.nodus.updateNote({ id: note.id, title: title.trim() || t('Idea sin título'), content });
      setDirty(false);
      setSavedAt(Date.now());
      onSaved();
    } finally {
      setSaving(false);
    }
  }, [saving, globalId, note.id, title, summary, works, evidence, connections, onSaved]);

  if (loading) {
    return (
      <div className="flex-1 space-y-3 p-6 animate-pulse">
        <div className="h-5 w-1/3 rounded bg-neutral-800" />
        <div className="h-3 w-2/3 rounded bg-neutral-800" />
        <div className="h-3 w-full rounded bg-neutral-800" />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <Badge color="green">{t('Idea')}</Badge>
        <span className="text-xs text-neutral-500">{t('Idea manual indexable')}</span>
        <div className="flex-1" />
        {savedAt && !dirty && <span className="text-[11px] text-emerald-400">{t('Guardado')}</span>}
        <button className="btn btn-primary gap-1.5" onClick={() => void save()} disabled={!dirty || saving}>
          <Icon name={saving ? 'sync' : 'save'} className={saving ? 'animate-spin' : ''} />
          {saving ? t('Guardando…') : t('Guardar')}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-5 py-5">
          {/* Title + summary */}
          <section className="space-y-2">
            <label className="text-xs uppercase tracking-wide text-neutral-500">{t('Título')}</label>
            <input
              className="input w-full text-base font-medium"
              value={title}
              placeholder={t('Título de la idea')}
              onChange={(e) => {
                setTitle(e.target.value);
                markDirty();
              }}
            />
            <label className="text-xs uppercase tracking-wide text-neutral-500">{t('Resumen')}</label>
            <textarea
              className="input min-h-[80px] w-full resize-y leading-relaxed"
              value={summary}
              placeholder={t('Enuncia la idea en una o dos frases.')}
              onChange={(e) => {
                setSummary(e.target.value);
                markDirty();
              }}
            />
          </section>

          {/* Works that develop it */}
          <Section title={tx('Obras que la desarrollan ({n})', { n: works.length })} icon="book">
            <WorkPicker onAdd={addWork} existing={works.map((w) => w.nodusId)} />
            {works.length === 0 ? (
              <Empty text={t('Vincula obras de tu biblioteca de Zotero a esta idea.')} />
            ) : (
              <ul className="space-y-2">
                {works.map((w) => (
                  <li key={w.nodusId} className="rounded-md border border-neutral-800 p-2.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" title={w.title}>
                          {w.title}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {(w.authors[0] ?? t('Autor desconocido')) + (w.authors.length > 1 ? ' et al.' : '')}
                          {w.year ? ` (${w.year})` : ''}
                        </div>
                      </div>
                      <button
                        className="p-1 text-neutral-500 hover:text-red-400"
                        title={t('Quitar')}
                        onClick={() => {
                          setWorks((prev) => prev.filter((x) => x.nodusId !== w.nodusId));
                          markDirty();
                        }}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                    <input
                      className="input mt-2 w-full text-xs"
                      value={w.development}
                      placeholder={t('Cómo desarrolla esta obra la idea (opcional)')}
                      onChange={(e) => {
                        const v = e.target.value;
                        setWorks((prev) => prev.map((x) => (x.nodusId === w.nodusId ? { ...x, development: v } : x)));
                        markDirty();
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Anchored evidence */}
          <Section title={tx('Evidencia anclada ({n})', { n: evidence.length })} icon="quote">
            <button
              className="btn btn-ghost mb-2 gap-1.5 border border-neutral-700 text-xs"
              onClick={() => {
                setEvidence((prev) => [...prev, { nodusId: works[0]?.nodusId ?? null, quote: '', location: '' }]);
                markDirty();
              }}
            >
              <Icon name="plus" size={13} /> {t('Añadir cita')}
            </button>
            {evidence.length === 0 ? (
              <Empty text={t('Añade citas textuales con su página o rango de páginas.')} />
            ) : (
              <ul className="space-y-2">
                {evidence.map((ev, i) => (
                  <li key={i} className="space-y-2 rounded-md border border-neutral-800 p-2.5">
                    <textarea
                      className="input min-h-[56px] w-full resize-y text-sm italic"
                      value={ev.quote}
                      placeholder={t('Cita textual…')}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEvidence((prev) => prev.map((x, j) => (j === i ? { ...x, quote: v } : x)));
                        markDirty();
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className="input w-40 text-xs"
                        value={ev.location ?? ''}
                        placeholder={t('p. 23 o pp. 23-25')}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEvidence((prev) => prev.map((x, j) => (j === i ? { ...x, location: v } : x)));
                          markDirty();
                        }}
                      />
                      <select
                        className="input flex-1 text-xs"
                        value={ev.nodusId ?? ''}
                        onChange={(e) => {
                          const v = e.target.value || null;
                          setEvidence((prev) => prev.map((x, j) => (j === i ? { ...x, nodusId: v } : x)));
                          markDirty();
                        }}
                      >
                        <option value="">{t('Sin obra asociada')}</option>
                        {works.map((w) => (
                          <option key={w.nodusId} value={w.nodusId}>
                            {w.title.slice(0, 60)}
                          </option>
                        ))}
                      </select>
                      <button
                        className="p-1 text-neutral-500 hover:text-red-400"
                        title={t('Quitar')}
                        onClick={() => {
                          setEvidence((prev) => prev.filter((_, j) => j !== i));
                          markDirty();
                        }}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Connections */}
          <Section title={tx('Conexiones ({n})', { n: connections.length })} icon="network">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                className="btn btn-ghost gap-1.5 border border-neutral-700 text-xs"
                onClick={() => void runAutoIndex()}
                disabled={indexing}
                title={t('Indexar esta idea y buscar ideas relacionadas automáticamente')}
              >
                <Icon name={indexing ? 'sync' : 'wand'} className={indexing ? 'animate-spin' : ''} size={13} />
                {indexing ? t('Indexando…') : t('Indexar y buscar relacionadas')}
              </button>
            </div>
            {indexMsg && <p className="mb-2 text-[11px] text-neutral-500">{indexMsg}</p>}

            {suggestions.length > 0 && (
              <div className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 p-2 dark:border-indigo-900/60 dark:bg-indigo-950/20">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300">{t('Sugerencias')}</div>
                <ul className="space-y-1">
                  {suggestions.map((s) => (
                    <li key={s.global_id}>
                      <button
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-900/60"
                        onClick={() => addConnection(s, 'inferred')}
                      >
                        <Icon name="plus" size={12} className="text-indigo-300" />
                        <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{s.label}</span>
                        {s.similarity != null && (
                          <span className="shrink-0 text-[10px] text-neutral-500">
                            sim {s.similarity.toFixed(2)}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <IdeaConnectionPicker onAdd={(c) => addConnection(c, 'explicit')} excludeIds={excludeIds} />

            {connections.length === 0 ? (
              <Empty text={t('Conecta esta idea con otras a mano o índexala para descubrir relaciones.')} />
            ) : (
              <ul className="space-y-1.5">
                {connections.map((c) => (
                  <li
                    key={c.toId}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-800 px-2.5 py-2"
                  >
                    <select
                      className="input w-40 text-xs"
                      value={c.type}
                      onChange={(e) => {
                        const v = e.target.value as EdgeType;
                        setConnections((prev) => prev.map((x) => (x.toId === c.toId ? { ...x, type: v } : x)));
                        markDirty();
                      }}
                    >
                      {EDGE_TYPES.map((tp) => (
                        <option key={tp} value={tp}>
                          {t(EDGE_LABELS[tp])}
                        </option>
                      ))}
                    </select>
                    <button
                      className="min-w-0 flex-1 truncate text-left text-sm text-neutral-200 hover:text-indigo-300 disabled:hover:text-neutral-200"
                      disabled={!onOpenGraph}
                      title={onOpenGraph ? t('Ver en el grafo') : undefined}
                      onClick={() => onOpenGraph?.({ preset: 'overview', nodeId: c.toId, label: c.toLabel })}
                    >
                      {c.toLabel}
                    </button>
                    {c.basis === 'inferred' && <Badge color="indigo">{t('auto')}</Badge>}
                    <button
                      className="p-1 text-neutral-500 hover:text-red-400"
                      title={t('Quitar')}
                      onClick={() => {
                        setConnections((prev) => prev.filter((x) => x.toId !== c.toId));
                        markDirty();
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        <Icon name={icon} size={13} className="text-indigo-300" />
        {title}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed border-neutral-800 px-3 py-3 text-xs text-neutral-500">{text}</p>;
}

/** Search the Zotero-backed library and link a work to the idea. */
function WorkPicker({ onAdd, existing }: { onAdd: (w: WorkView) => void; existing: string[] }) {
  const [all, setAll] = useState<WorkView[] | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const ensureLoaded = useCallback(() => {
    if (all === null) void window.nodus.listWorks().then(setAll);
  }, [all]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !all) return [];
    const exclude = new Set(existing);
    return all
      .filter((w) => !exclude.has(w.nodus_id))
      .filter(
        (w) => w.title.toLowerCase().includes(q) || w.authors.some((a) => a.toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [all, query, existing]);

  return (
    <div className="relative mb-2">
      <Icon
        name="search"
        size={13}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500"
      />
      <input
        className="input input-with-leading-icon w-full text-sm"
        placeholder={t('Buscar una obra de Zotero…')}
        value={query}
        onFocus={() => {
          ensureLoaded();
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && query.trim() && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-neutral-700 bg-neutral-950 shadow-xl">
          {all === null ? (
            <div className="px-3 py-2 text-xs text-neutral-500">{t('Cargando…')}</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-neutral-500">{t('Sin resultados.')}</div>
          ) : (
            results.map((w) => (
              <button
                key={w.nodus_id}
                className="block w-full px-3 py-1.5 text-left hover:bg-neutral-900"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onAdd(w);
                  setQuery('');
                }}
              >
                <div className="truncate text-sm text-neutral-200">{w.title}</div>
                <div className="truncate text-[11px] text-neutral-500">
                  {(w.authors[0] ?? t('Autor desconocido')) + (w.authors.length > 1 ? ' et al.' : '')}
                  {w.year ? ` (${w.year})` : ''}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Keyword-search existing ideas to add a manual connection. */
function IdeaConnectionPicker({
  onAdd,
  excludeIds,
}: {
  onAdd: (c: IdeaCandidate) => void;
  excludeIds: string[];
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IdeaCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const excludeRef = useRef(excludeIds);
  excludeRef.current = excludeIds;

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let on = true;
    const handle = window.setTimeout(() => {
      void window.nodus.searchIdeaCandidates(q, excludeRef.current, 12).then((r) => {
        if (on) setResults(r);
      });
    }, 200);
    return () => {
      on = false;
      window.clearTimeout(handle);
    };
  }, [query]);

  return (
    <div className="relative mb-2">
      <Icon
        name="search"
        size={13}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500"
      />
      <input
        className="input input-with-leading-icon w-full text-sm"
        placeholder={t('Buscar una idea para conectar…')}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && query.trim() && results.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-neutral-700 bg-neutral-950 shadow-xl">
          {results.map((r) => (
            <button
              key={r.global_id}
              className="block w-full px-3 py-1.5 text-left hover:bg-neutral-900"
              onMouseDown={(e) => {
                e.preventDefault();
                onAdd(r);
                setQuery('');
              }}
            >
              <div className="truncate text-sm text-neutral-200">{r.label}</div>
              {r.statement && <div className="truncate text-[11px] text-neutral-500">{r.statement}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
