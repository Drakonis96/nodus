import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AppSettings,
  AuthorDossier,
  AuthorDossierIdea,
  AuthorSummary,
  IdeaType,
  ModelRef,
  SynthesisMatrix,
  SynthesisMatrixCell,
} from '@shared/types';
import { Badge, Icon, NODE_COLORS, NODE_LABELS, Spinner, TypeDot } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { useDataRefresh, useScanComplete } from '../hooks';
import type { PendingGraphNavigationTarget } from '../navigation';
import { t, tx } from '../i18n';

type Tab = 'dossier' | 'matrix';

const RELATION_LABELS: Record<string, string> = {
  contradicts: 'contradice a',
  refutes: 'refuta a',
  extends: 'extiende a',
  supports: 'apoya a',
  refines: 'refina a',
  coauthor: 'coautor con',
};

const RELATION_COLORS: Record<string, 'red' | 'amber' | 'green' | 'cyan' | 'neutral'> = {
  contradicts: 'red',
  refutes: 'red',
  extends: 'cyan',
  supports: 'green',
  refines: 'amber',
  coauthor: 'neutral',
};

const IDEA_TYPE_ORDER: IdeaType[] = ['claim', 'finding', 'construct', 'method', 'framework'];

export function AuthorsView({
  settings,
  onOpenGraph,
}: {
  settings: AppSettings;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
}) {
  const [tab, setTab] = useState<Tab>('dossier');
  const [model, setModel] = useState<ModelRef | null>(settings.synthesisModel ?? settings.defaultModel);

  return (
    <div className="h-full flex flex-col min-h-0 p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Icon name="graduation" size={20} className="text-indigo-400" />
          <h2 className="text-lg font-semibold">{t('Autores')}</h2>
        </div>
        <div className="flex rounded-lg bg-neutral-900 p-0.5 text-sm">
          <button
            className={`px-3 py-1 rounded-md ${tab === 'dossier' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
            onClick={() => setTab('dossier')}
          >
            {t('Fichas de autor')}
          </button>
          <button
            className={`px-3 py-1 rounded-md ${tab === 'matrix' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
            onClick={() => setTab('matrix')}
          >
            {t('Matriz de síntesis')}
          </button>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">{t('Modelo de síntesis')}</span>
          <ModelPicker settings={settings} value={model} onChange={setModel} compact />
        </div>
      </div>

      {tab === 'dossier' ? (
        <DossierTab onOpenGraph={onOpenGraph} model={model} />
      ) : (
        <MatrixTab onOpenGraph={onOpenGraph} model={model} />
      )}
    </div>
  );
}

// ─── Tab 1: Author dossiers ───────────────────────────────────────────────────

function DossierTab({
  onOpenGraph,
  model,
}: {
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  model: ModelRef | null;
}) {
  const [authors, setAuthors] = useState<AuthorSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dossier, setDossier] = useState<AuthorDossier | null>(null);
  const [loadingDossier, setLoadingDossier] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const reloadAuthors = useCallback(async () => {
    const list = await window.nodus.listAuthors();
    setAuthors(list);
    setSelectedId((cur) => cur ?? list[0]?.author_id ?? null);
  }, []);

  useEffect(() => {
    void reloadAuthors();
  }, [reloadAuthors]);
  useDataRefresh(reloadAuthors);
  useScanComplete(reloadAuthors);

  useEffect(() => {
    if (!selectedId) {
      setDossier(null);
      return;
    }
    let cancelled = false;
    setLoadingDossier(true);
    void window.nodus
      .getAuthorDossier(selectedId)
      .then((d) => {
        if (!cancelled) setDossier(d);
      })
      .finally(() => {
        if (!cancelled) setLoadingDossier(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const synthesize = useCallback(async () => {
    if (!selectedId) return;
    setSynthesizing(true);
    setError(null);
    try {
      const synthesis = await window.nodus.synthesizeAuthor(selectedId, model);
      setDossier((cur) => (cur ? { ...cur, synthesis } : cur));
      setAuthors((cur) => cur.map((a) => (a.author_id === selectedId ? { ...a, hasSynthesis: true } : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSynthesizing(false);
    }
  }, [selectedId, model]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return authors;
    return authors.filter((a) => a.name.toLowerCase().includes(q));
  }, [authors, query]);

  return (
    <div className="flex-1 min-h-0 flex gap-4">
      {/* Author list */}
      <div className="w-72 shrink-0 flex flex-col min-h-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Buscar autor…')}
          className="mb-2 w-full bg-neutral-900 border border-neutral-800 rounded-md px-3 py-1.5 text-sm outline-none focus:border-indigo-600"
        />
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1">
          {filtered.length === 0 && <p className="text-sm text-neutral-500 px-1">{t('No hay autores todavía.')}</p>}
          {filtered.map((a) => (
            <button
              key={a.author_id}
              onClick={() => setSelectedId(a.author_id)}
              className={`w-full text-left px-3 py-2 rounded-lg border transition ${
                selectedId === a.author_id
                  ? 'bg-neutral-800 border-indigo-600'
                  : 'bg-neutral-900 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{a.name}</span>
                {a.hasSynthesis && <Icon name="wand" size={12} className="text-indigo-400 shrink-0" />}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-neutral-500">
                <span>{tx('{n} obras', { n: a.workCount })}</span>
                <span>·</span>
                <span>{tx('{n} ideas', { n: a.ideaCount })}</span>
                {a.relationCount > 0 && (
                  <>
                    <span>·</span>
                    <span>{tx('{n} conexiones', { n: a.relationCount })}</span>
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Dossier detail */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {loadingDossier && !dossier ? (
          <Spinner label={t('Cargando ficha…')} />
        ) : !dossier ? (
          <p className="text-sm text-neutral-500">{t('Selecciona un autor para ver su ficha.')}</p>
        ) : (
          <AuthorDossierDetail
            dossier={dossier}
            synthesizing={synthesizing}
            error={error}
            onSynthesize={synthesize}
            onOpenGraph={onOpenGraph}
            onSelectAuthor={setSelectedId}
          />
        )}
      </div>
    </div>
  );
}

function AuthorDossierDetail({
  dossier,
  synthesizing,
  error,
  onSynthesize,
  onOpenGraph,
  onSelectAuthor,
}: {
  dossier: AuthorDossier;
  synthesizing: boolean;
  error: string | null;
  onSynthesize: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onSelectAuthor: (id: string) => void;
}) {
  const ideasByType = useMemo(() => {
    const map = new Map<IdeaType, AuthorDossierIdea[]>();
    for (const idea of dossier.ideas) {
      const list = map.get(idea.type) ?? [];
      list.push(idea);
      map.set(idea.type, list);
    }
    return map;
  }, [dossier.ideas]);

  const { author, synthesis } = dossier;

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div>
        <div className="flex items-start gap-3">
          <h3 className="text-xl font-semibold">{author.name}</h3>
          <button
            className="ml-auto shrink-0 text-xs px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 flex items-center gap-1"
            onClick={() => onOpenGraph({ preset: 'authors', nodeId: author.author_id, label: author.name })}
            title={t('Ver en el grafo de autores')}
          >
            <Icon name="network" size={13} /> {t('Ver en grafo')}
          </button>
        </div>
        {author.affiliation && <p className="text-sm text-neutral-500">{author.affiliation}</p>}
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-400">
          <Badge>{tx('{n} obras', { n: dossier.works.length })}</Badge>
          <Badge>{tx('{n} ideas', { n: dossier.ideas.length })}</Badge>
          {dossier.themes.slice(0, 5).map((th) => (
            <Badge key={th} color="indigo">
              {th}
            </Badge>
          ))}
        </div>
      </div>

      {/* Synthesis */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon name="wand" size={15} className="text-indigo-400" />
          <h4 className="font-medium">{t('Síntesis')}</h4>
          {synthesis?.stale && (
            <Badge color="amber" title={t('Las ideas cambiaron desde la última síntesis')}>
              {t('desactualizada')}
            </Badge>
          )}
          <div className="ml-auto">
            {synthesis && !synthesizing && (
              <button
                className="text-xs px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 flex items-center gap-1"
                onClick={onSynthesize}
              >
                <Icon name="refresh" size={12} /> {t('Regenerar')}
              </button>
            )}
          </div>
        </div>

        {synthesizing ? (
          <Spinner label={t('Generando síntesis…')} />
        ) : !synthesis ? (
          <div>
            <p className="text-sm text-neutral-400 mb-3">
              {t('Genera una tesis central, los puntos clave para recordar y cómo se posiciona este autor frente a los demás.')}
            </p>
            <button
              className="text-sm px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5"
              onClick={onSynthesize}
            >
              <Icon name="wand" size={14} /> {t('Generar síntesis')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">{t('Tesis central')}</p>
              <p className="text-sm text-neutral-100">{synthesis.thesis}</p>
            </div>
            {synthesis.remember.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">{t('Qué recordar')}</p>
                <ul className="space-y-1">
                  {synthesis.remember.map((r, i) => (
                    <li key={i} className="text-sm text-neutral-300 flex gap-2">
                      <span className="text-indigo-400 mt-0.5">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {synthesis.positioning && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">{t('Cómo se relaciona')}</p>
                <p className="text-sm text-neutral-300">{synthesis.positioning}</p>
              </div>
            )}
          </div>
        )}
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>

      {/* Relations */}
      {dossier.relations.length > 0 && (
        <div>
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <Icon name="network" size={15} className="text-neutral-400" /> {t('Conexiones con otros autores')}
          </h4>
          <div className="space-y-1.5">
            {dossier.relations.map((r) => (
              <button
                key={`${r.author_id}-${r.type}`}
                onClick={() => onSelectAuthor(r.author_id)}
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-700"
              >
                <Badge color={RELATION_COLORS[r.type] ?? 'neutral'}>{t(RELATION_LABELS[r.type] ?? r.type)}</Badge>
                <span className="text-sm">{r.name}</span>
                {r.sharedThemes.length > 0 && (
                  <span className="ml-auto text-[11px] text-neutral-500 truncate max-w-[45%]">
                    {t('temas comunes')}: {r.sharedThemes.slice(0, 3).join(', ')}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ideas grouped by type */}
      <div>
        <h4 className="font-medium mb-2 flex items-center gap-2">
          <Icon name="bulb" size={15} className="text-neutral-400" /> {t('Ideas del autor')}
        </h4>
        {dossier.ideas.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('Este autor aún no tiene ideas extraídas. Analiza sus obras.')}</p>
        ) : (
          <div className="space-y-4">
            {IDEA_TYPE_ORDER.filter((type) => ideasByType.has(type)).map((type) => (
              <div key={type}>
                <div className="flex items-center gap-2 mb-1.5">
                  <TypeDot type={type} />
                  <span className="text-sm font-medium" style={{ color: NODE_COLORS[type] }}>
                    {t(NODE_LABELS[type])}
                  </span>
                  <span className="text-xs text-neutral-500">({ideasByType.get(type)!.length})</span>
                </div>
                <div className="space-y-2">
                  {ideasByType.get(type)!.map((idea) => (
                    <IdeaCard key={idea.global_id} idea={idea} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Works */}
      {dossier.works.length > 0 && (
        <div>
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <Icon name="book" size={15} className="text-neutral-400" /> {t('Obras')}
          </h4>
          <div className="space-y-1">
            {dossier.works.map((w) => (
              <div key={w.nodus_id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800">
                <span className="truncate">{w.title || t('(sin título)')}</span>
                {w.year && <span className="text-xs text-neutral-500 shrink-0">{w.year}</span>}
                {w.read && (
                  <Badge color="green" title={t('Leído')}>
                    <Icon name="check" size={10} />
                  </Badge>
                )}
                {w.zoteroKey && (
                  <button
                    className="ml-auto shrink-0 text-neutral-500 hover:text-indigo-400"
                    title={t('Abrir en Zotero')}
                    onClick={() => window.nodus.openInZotero(w.zoteroKey!)}
                  >
                    <Icon name="external" size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IdeaCard({ idea }: { idea: AuthorDossierIdea }) {
  const [open, setOpen] = useState(false);
  const hasMore = Boolean(idea.development) || idea.evidence.length > 0;
  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2">
      <button className="w-full text-left" onClick={() => hasMore && setOpen((v) => !v)}>
        <div className="flex items-start gap-2">
          <span className="text-sm font-medium">{idea.label}</span>
          {idea.themes.slice(0, 2).map((th) => (
            <Badge key={th} color="indigo">
              {th}
            </Badge>
          ))}
          {hasMore && <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} className="ml-auto text-neutral-500 shrink-0" />}
        </div>
        <p className="text-sm text-neutral-400 mt-0.5">{idea.statement}</p>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-neutral-800 pt-2">
          {idea.development && <p className="text-sm text-neutral-300">{idea.development}</p>}
          {idea.evidence.slice(0, 3).map((ev) => (
            <blockquote key={ev.id} className="text-xs text-neutral-400 border-l-2 border-neutral-700 pl-2 italic">
              «{ev.quote}»
              {ev.location && <span className="not-italic text-neutral-600"> — {ev.location}</span>}
            </blockquote>
          ))}
          <p className="text-[11px] text-neutral-600">
            {idea.workTitle}
            {idea.year ? ` (${idea.year})` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Tab 2: Synthesis matrix ──────────────────────────────────────────────────

function MatrixTab({
  onOpenGraph,
  model,
}: {
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  model: ModelRef | null;
}) {
  const [matrix, setMatrix] = useState<SynthesisMatrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<{ authorId: string; themeId: string } | null>(null);
  const [generating, setGenerating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setMatrix(await window.nodus.getSynthesisMatrix());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useDataRefresh(reload);
  useScanComplete(reload);

  const cellMap = useMemo(() => {
    const map = new Map<string, SynthesisMatrixCell>();
    for (const c of matrix?.cells ?? []) map.set(`${c.authorId}::${c.themeId}`, c);
    return map;
  }, [matrix]);

  const selectedCell = selected ? cellMap.get(`${selected.authorId}::${selected.themeId}`) ?? null : null;
  const selectedAuthor = selected ? matrix?.authors.find((a) => a.author_id === selected.authorId) : undefined;
  const selectedTheme = selected ? matrix?.themes.find((t2) => t2.theme_id === selected.themeId) : undefined;

  const generateStance = useCallback(async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      const cell = await window.nodus.synthesizeMatrixCell(selected.authorId, selected.themeId, model);
      setMatrix((cur) =>
        cur
          ? {
              ...cur,
              cells: cur.cells.map((c) =>
                c.authorId === cell.authorId && c.themeId === cell.themeId ? cell : c
              ),
            }
          : cur
      );
    } finally {
      setGenerating(false);
    }
  }, [selected, model]);

  if (loading && !matrix) return <Spinner label={t('Construyendo la matriz…')} />;
  if (!matrix || matrix.authors.length === 0 || matrix.themes.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        {t('Aún no hay suficientes autores y temas analizados para construir la matriz.')}
      </p>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <p className="text-xs text-neutral-500">
        {t('Filas = autores, columnas = temas. Cada celda muestra cuántas ideas aporta ese autor al tema; haz clic para ver las ideas y generar una postura.')}
      </p>
      <div className="flex-1 min-h-0 flex gap-4">
        <div className="flex-1 min-h-0 overflow-auto border border-neutral-800 rounded-lg">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 bg-neutral-950 border-b border-r border-neutral-800 px-3 py-2 text-left font-medium min-w-[180px]">
                  {t('Autor')}
                </th>
                {matrix.themes.map((th) => (
                  <th
                    key={th.theme_id}
                    title={th.label}
                    className="sticky top-0 z-10 bg-neutral-950 border-b border-neutral-800 px-2 py-2 text-left font-medium text-xs text-neutral-300 max-w-[140px] min-w-[110px] align-bottom"
                  >
                    <span className="line-clamp-2">{th.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.authors.map((a) => (
                <tr key={a.author_id} className="hover:bg-neutral-900/40">
                  <td className="sticky left-0 z-10 bg-neutral-950 border-r border-b border-neutral-800 px-3 py-1.5 truncate max-w-[200px]">
                    {a.name}
                  </td>
                  {matrix.themes.map((th) => {
                    const cell = cellMap.get(`${a.author_id}::${th.theme_id}`);
                    const isSel = selected?.authorId === a.author_id && selected?.themeId === th.theme_id;
                    return (
                      <td key={th.theme_id} className="border-b border-neutral-900 p-1 text-center">
                        {cell ? (
                          <button
                            onClick={() => setSelected({ authorId: a.author_id, themeId: th.theme_id })}
                            title={cell.stance ?? tx('{n} ideas', { n: cell.ideaCount })}
                            className={`w-full h-full min-h-[28px] rounded flex items-center justify-center gap-1 ${
                              isSel ? 'ring-1 ring-indigo-500' : ''
                            } ${cell.stance ? 'bg-indigo-900/40 hover:bg-indigo-900/60' : 'bg-neutral-800/60 hover:bg-neutral-800'}`}
                          >
                            <span className="text-xs text-neutral-200">{cell.ideaCount}</span>
                            {cell.stance && <Icon name="wand" size={10} className="text-indigo-300" />}
                          </button>
                        ) : (
                          <span className="text-neutral-800">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Selected cell panel */}
        {selectedCell && selectedAuthor && selectedTheme && (
          <div className="w-80 shrink-0 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="font-medium">{selectedAuthor.name}</p>
                <p className="text-xs text-indigo-300">{selectedTheme.label}</p>
              </div>
              <button className="text-neutral-500 hover:text-neutral-300" onClick={() => setSelected(null)}>
                <Icon name="x" size={15} />
              </button>
            </div>

            <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-2 mb-3">
              {generating ? (
                <Spinner label={t('Generando postura…')} />
              ) : selectedCell.stance ? (
                <p className="text-sm text-neutral-200">{selectedCell.stance}</p>
              ) : (
                <button
                  className="text-sm px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5"
                  onClick={generateStance}
                >
                  <Icon name="wand" size={13} /> {t('Generar postura')}
                </button>
              )}
              {selectedCell.stance && !generating && (
                <button className="mt-2 text-xs text-neutral-500 hover:text-indigo-400 flex items-center gap-1" onClick={generateStance}>
                  <Icon name="refresh" size={11} /> {t('Regenerar')}
                </button>
              )}
            </div>

            <p className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">
              {tx('{n} ideas', { n: selectedCell.ideaCount })}
            </p>
            <div className="space-y-1">
              {selectedCell.ideas.map((idea) => (
                <div key={idea.global_id} className="flex items-center gap-2 text-sm">
                  <TypeDot type={idea.type} />
                  <span className="truncate">{idea.label}</span>
                </div>
              ))}
            </div>
            <button
              className="mt-3 text-xs text-neutral-500 hover:text-indigo-400 flex items-center gap-1"
              onClick={() => onOpenGraph({ preset: 'authors', nodeId: selectedAuthor.author_id, label: selectedAuthor.name })}
            >
              <Icon name="network" size={12} /> {t('Ver autor en el grafo')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
