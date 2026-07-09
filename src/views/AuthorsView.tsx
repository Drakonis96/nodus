import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AppSettings,
  AuthorDossier,
  AuthorDossierIdea,
  AuthorDossierWork,
  AuthorSummary,
  ModelRef,
  SynthesisMatrix,
  SynthesisMatrixCell,
} from '@shared/types';
import { Badge, Icon, Spinner, TypeDot } from '../components/ui';
import { IdeaDetailModal } from '../components/IdeaDetailModal';
import { ModelPicker } from '../components/ModelPicker';
import { WorkIdeasModal } from './WorkIdeasModal';
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

type SortKey = 'name' | 'surname' | 'works' | 'ideas' | 'connections';
type SynthFilter = 'all' | 'with' | 'without';

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Nombre',
  surname: 'Apellidos',
  works: 'Nº de obras',
  ideas: 'Nº de ideas',
  connections: 'Nº de conexiones',
};

const SYNTH_FILTER_LABELS: Record<SynthFilter, string> = {
  all: 'Todas',
  with: 'Con síntesis',
  without: 'Sin síntesis',
};

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
  const [sortBy, setSortBy] = useState<SortKey>('surname');
  const [synthFilter, setSynthFilter] = useState<SynthFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportFormat, setExportFormat] = useState<'markdown' | 'pdf'>('markdown');
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

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
    let list = authors;
    if (q) list = list.filter((a) => a.fullName.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
    if (synthFilter === 'with') list = list.filter((a) => a.hasSynthesis);
    else if (synthFilter === 'without') list = list.filter((a) => !a.hasSynthesis);
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName);
        case 'surname':
          return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
        case 'works':
          return b.workCount - a.workCount || a.lastName.localeCompare(b.lastName);
        case 'ideas':
          return b.ideaCount - a.ideaCount || a.lastName.localeCompare(b.lastName);
        case 'connections':
          return b.relationCount - a.relationCount || a.lastName.localeCompare(b.lastName);
      }
    });
    return sorted;
  }, [authors, query, synthFilter, sortBy]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allFilteredSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.author_id));
  const toggleSelectAll = useCallback(() => {
    setSelected((cur) => {
      const next = new Set(cur);
      const every = filtered.length > 0 && filtered.every((a) => next.has(a.author_id));
      if (every) filtered.forEach((a) => next.delete(a.author_id));
      else filtered.forEach((a) => next.add(a.author_id));
      return next;
    });
  }, [filtered]);

  const doExport = useCallback(async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const res = await window.nodus.exportAuthorSyntheses({ authorIds: [...selected], format: exportFormat });
      setExportMsg(res ? tx('Exportado a {path}', { path: res.path }) : null);
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [selected, exportFormat]);

  return (
    <div className="flex-1 min-h-0 flex gap-4">
      {/* Author list */}
      <div className="w-80 shrink-0 flex flex-col min-h-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Buscar autor…')}
          className="mb-2 w-full bg-neutral-900 border border-neutral-800 rounded-md px-3 py-1.5 text-sm outline-none focus:border-indigo-600"
        />
        <div className="flex gap-2 mb-2">
          <label className="flex-1 min-w-0 flex items-center gap-1.5 text-[11px] text-neutral-500">
            {t('Ordenar')}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="flex-1 min-w-0 bg-neutral-900 border border-neutral-800 rounded-md px-1.5 py-1 text-xs text-neutral-200 outline-none focus:border-indigo-600"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {t(SORT_LABELS[k])}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 min-w-0 flex items-center gap-1.5 text-[11px] text-neutral-500">
            {t('Síntesis')}
            <select
              value={synthFilter}
              onChange={(e) => setSynthFilter(e.target.value as SynthFilter)}
              className="flex-1 min-w-0 bg-neutral-900 border border-neutral-800 rounded-md px-1.5 py-1 text-xs text-neutral-200 outline-none focus:border-indigo-600"
            >
              {(Object.keys(SYNTH_FILTER_LABELS) as SynthFilter[]).map((k) => (
                <option key={k} value={k}>
                  {t(SYNTH_FILTER_LABELS[k])}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Selection + export */}
        <div className="flex items-center justify-between mb-2 text-[11px]">
          <label className="flex items-center gap-1.5 text-neutral-400 cursor-pointer">
            <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="accent-indigo-600" />
            {selected.size > 0 ? tx('{n} seleccionados', { n: selected.size }) : t('Seleccionar todos')}
          </label>
          {selected.size > 0 && (
            <button className="text-neutral-500 hover:text-neutral-300" onClick={() => setSelected(new Set())}>
              {t('Limpiar')}
            </button>
          )}
        </div>
        <div className="flex gap-2 mb-2">
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as 'markdown' | 'pdf')}
            className="bg-neutral-900 border border-neutral-800 rounded-md px-1.5 py-1 text-xs text-neutral-200 outline-none focus:border-indigo-600"
          >
            <option value="markdown">Markdown</option>
            <option value="pdf">PDF</option>
          </select>
          <button
            onClick={doExport}
            disabled={exporting}
            className="flex-1 text-xs px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 flex items-center justify-center gap-1"
            title={t('Exporta la síntesis de los autores seleccionados (o de todos los que tengan síntesis)')}
          >
            <Icon name="download" size={12} />
            {selected.size > 0 ? tx('Exportar ({n})', { n: selected.size }) : t('Exportar todas')}
          </button>
        </div>
        {exportMsg && <p className="text-[11px] text-neutral-500 mb-2 break-words">{exportMsg}</p>}

        <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1">
          {filtered.length === 0 && <p className="text-sm text-neutral-500 px-1">{t('No hay autores todavía.')}</p>}
          {filtered.map((a) => (
            <div
              key={a.author_id}
              className={`flex items-start gap-2 px-2 py-2 rounded-lg border transition ${
                selectedId === a.author_id
                  ? 'bg-neutral-800 border-indigo-600'
                  : 'bg-neutral-900 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(a.author_id)}
                onChange={() => toggleSelect(a.author_id)}
                className="mt-1 accent-indigo-600 shrink-0"
                title={t('Seleccionar para exportar')}
              />
              <button onClick={() => setSelectedId(a.author_id)} className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{a.fullName || a.name}</span>
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
            </div>
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
            model={model}
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
  model,
  synthesizing,
  error,
  onSynthesize,
  onOpenGraph,
  onSelectAuthor,
}: {
  dossier: AuthorDossier;
  model: ModelRef | null;
  synthesizing: boolean;
  error: string | null;
  onSynthesize: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onSelectAuthor: (id: string) => void;
}) {
  const [worksOpen, setWorksOpen] = useState(false);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [ideasWork, setIdeasWork] = useState<{ nodus_id: string; title: string } | null>(null);

  const { author, synthesis } = dossier;

  useEffect(() => {
    setWorksOpen(false);
    setSelectedIdeaId(null);
    setIdeasWork(null);
  }, [author.author_id]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] max-w-6xl items-start">
      <div className="space-y-5 min-w-0">
      {/* Header */}
      <div>
        <div className="flex items-start gap-3">
          <h3 className="text-xl font-semibold">{dossier.fullName || author.name}</h3>
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
          <button
            type="button"
            onClick={() => setWorksOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            title={t('Ver obras de este autor')}
          >
            <Icon name="book" size={11} />
            {tx('{n} obras', { n: dossier.works.length })}
          </button>
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

      {/* Works */}
      {dossier.works.length > 0 && (
        <div>
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <Icon name="book" size={15} className="text-neutral-400" /> {t('Obras')}
          </h4>
          <div className="space-y-1">
            {dossier.works.map((w) => (
              <AuthorWorkRow key={w.nodus_id} work={w} onOpenIdeas={(work) => setIdeasWork(work)} />
            ))}
          </div>
        </div>
      )}
      </div>
      <AuthorIdeasSidebar ideas={dossier.ideas} onOpenIdea={setSelectedIdeaId} />
      {worksOpen && (
        <AuthorWorksModal
          authorName={dossier.fullName || author.name}
          works={dossier.works}
          onClose={() => setWorksOpen(false)}
          onOpenWorkIdeas={(work) => {
            setWorksOpen(false);
            setIdeasWork(work);
          }}
        />
      )}
      {selectedIdeaId && (
        <IdeaDetailModal
          initialIdeaId={selectedIdeaId}
          onClose={() => setSelectedIdeaId(null)}
          onOpenGraph={onOpenGraph}
        />
      )}
      {ideasWork && (
        <WorkIdeasModal
          work={ideasWork}
          model={model}
          enableSynthesis
          onClose={() => setIdeasWork(null)}
          onOpenGraph={onOpenGraph}
          onOpenWorkGraph={(work) => {
            setIdeasWork(null);
            onOpenGraph({ preset: 'reading', workId: work.nodus_id, workTitle: work.title, label: `${t('Ideas y conexiones:')} ${work.title}` });
          }}
        />
      )}
    </div>
  );
}

function AuthorIdeasSidebar({ ideas, onOpenIdea }: { ideas: AuthorDossierIdea[]; onOpenIdea: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ideas;
    return ideas.filter((idea) =>
      [idea.label, idea.statement, idea.development, idea.workTitle, idea.type, ...idea.themes]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [ideas, query]);

  return (
    <aside className="xl:sticky xl:top-0 rounded-lg border border-neutral-800 bg-neutral-950/70 p-3 min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <Icon name="bulb" size={14} className="text-neutral-400" />
        <h4 className="text-sm font-medium">{t('Ideas')}</h4>
        <span className="ml-auto text-xs text-neutral-500">{ideas.length}</span>
      </div>
      <div className="relative mb-2">
        <Icon name="search" size={13} className="absolute left-2 top-2 text-neutral-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Buscar ideas…')}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-md pl-7 pr-2 py-1.5 text-xs outline-none focus:border-indigo-600"
        />
      </div>
      <div className="max-h-[calc(100vh-14rem)] overflow-y-auto pr-1 space-y-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-neutral-500 px-1 py-2">{t('No hay ideas que coincidan.')}</p>
        ) : (
          filtered.map((idea) => (
            <button
              key={idea.global_id}
              type="button"
              onClick={() => onOpenIdea(idea.global_id)}
              className="w-full text-left px-2 py-2 rounded-md border border-neutral-800 bg-neutral-900/80 hover:border-neutral-700"
            >
              <div className="flex items-start gap-2">
                <TypeDot type={idea.type} />
                <span className="min-w-0 text-xs font-medium text-neutral-200 line-clamp-2">{idea.label}</span>
              </div>
              <p className="mt-1 text-[11px] text-neutral-500 line-clamp-2">{idea.statement}</p>
              <div className="mt-1 flex items-center gap-1 text-[10px] text-neutral-600">
                <span className="truncate">{idea.workTitle || t('(sin título)')}</span>
                {idea.year && <span className="shrink-0">{idea.year}</span>}
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

const STATUS_LABELS: Record<string, string> = {
  none: 'sin analizar',
  pending: 'pendiente',
  done: 'hecho',
  failed: 'falló',
  skipped_no_text: 'sin texto',
};

const SOURCE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  markdown: 'Markdown',
  upload: 'archivo añadido',
  abstract_only: 'solo resumen',
  none: 'sin texto',
};

function statusLabel(value: string | null | undefined): string {
  return t(STATUS_LABELS[value ?? 'none'] ?? value ?? 'sin analizar');
}

function sourceLabel(value: string | null | undefined): string {
  return value ? t(SOURCE_LABELS[value] ?? value) : t('sin texto');
}

function AuthorWorksModal({
  authorName,
  works,
  onClose,
  onOpenWorkIdeas,
}: {
  authorName: string;
  works: AuthorDossierWork[];
  onClose: () => void;
  onOpenWorkIdeas: (work: { nodus_id: string; title: string }) => void;
}) {
  const ordered = useMemo(
    () =>
      [...works].sort(
        (a, b) =>
          (b.year ?? -Infinity) - (a.year ?? -Infinity) ||
          (a.title || '').localeCompare(b.title || '')
      ),
    [works]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('Obras del autor')}
      >
        <div className="flex items-start gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{tx('Obras de {name}', { name: authorName })}</h3>
            <p className="text-xs text-neutral-500">{tx('{n} obras vinculadas a este autor', { n: works.length })}</p>
          </div>
          <button
            type="button"
            className="ml-auto rounded-md p-1 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
            onClick={onClose}
            title={t('Cerrar')}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="max-h-[calc(88vh-4.5rem)] overflow-y-auto p-4 space-y-3">
          {ordered.map((work) => (
            <div key={work.nodus_id} className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onOpenWorkIdeas({ nodus_id: work.nodus_id, title: work.title || t('(sin título)') })}
                  title={t('Ver todas las ideas de esta obra')}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-medium text-neutral-100">{work.title || t('(sin título)')}</h4>
                    {work.year && <Badge>{work.year}</Badge>}
                    <Badge color={work.role === 'editor' ? 'cyan' : 'neutral'}>
                      {work.role === 'editor' ? t('editor/a') : t('autor/a')}
                    </Badge>
                    {work.read && (
                      <Badge color="green">
                        <Icon name="check" size={10} /> {t('Leído')}
                      </Badge>
                    )}
                  </div>
                  {work.authors.length > 0 && (
                    <p className="mt-1 text-xs text-neutral-500">{work.authors.join(', ')}</p>
                  )}
                </button>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 flex items-center gap-1"
                    onClick={() => onOpenWorkIdeas({ nodus_id: work.nodus_id, title: work.title || t('(sin título)') })}
                    title={t('Ver todas las ideas de esta obra')}
                  >
                    <Icon name="bulb" size={12} />
                    {t('Ideas')}
                  </button>
                  {work.zoteroKey && (
                    <button
                      type="button"
                      className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 flex items-center gap-1"
                      onClick={() => window.nodus.openInZotero(work.zoteroKey!)}
                      title={t('Abrir en Zotero')}
                    >
                      <Icon name="external" size={12} />
                      Zotero
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-xs text-neutral-400 sm:grid-cols-2 lg:grid-cols-3">
                <InfoRow label={t('Tipo')} value={work.itemType || t('sin tipo')} />
                <InfoRow label="DOI" value={work.doi || t('sin DOI')} />
                <InfoRow label={t('Texto')} value={sourceLabel(work.sourceType)} />
                <InfoRow label={t('Exploración')} value={statusLabel(work.lightStatus)} />
                <InfoRow label={t('Ideas')} value={statusLabel(work.deepStatus)} />
                <InfoRow label={t('Resumen')} value={statusLabel(work.summaryStatus)} />
                <InfoRow label={t('Zotero key')} value={work.zoteroKey || t('sin clave')} />
                <InfoRow label="Nodus ID" value={work.nodus_id} />
              </div>

              {work.notes && (
                <p className="mt-3 border-t border-neutral-800 pt-2 text-xs text-neutral-400 whitespace-pre-wrap">
                  {work.notes}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AuthorWorkRow({
  work,
  onOpenIdeas,
}: {
  work: AuthorDossierWork;
  onOpenIdeas: (work: { nodus_id: string; title: string }) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onOpenIdeas({ nodus_id: work.nodus_id, title: work.title || t('(sin título)') })}
        title={t('Ver todas las ideas de esta obra')}
      >
        <span className="block truncate">{work.title || t('(sin título)')}</span>
      </button>
      {work.year && <span className="shrink-0 text-xs text-neutral-500">{work.year}</span>}
      {work.role === 'editor' && (
        <Badge color="cyan" title={t('Figura como editor/a de esta obra')}>
          {t('ed.')}
        </Badge>
      )}
      {work.read && (
        <Badge color="green" title={t('Leído')}>
          <Icon name="check" size={10} />
        </Badge>
      )}
      <button
        type="button"
        className="shrink-0 text-neutral-500 hover:text-indigo-400"
        title={t('Ver todas las ideas de esta obra')}
        onClick={() => onOpenIdeas({ nodus_id: work.nodus_id, title: work.title || t('(sin título)') })}
      >
        <Icon name="bulb" size={13} />
      </button>
      {work.zoteroKey && (
        <button
          className="shrink-0 text-neutral-500 hover:text-indigo-400"
          title={t('Abrir en Zotero')}
          onClick={() => window.nodus.openInZotero(work.zoteroKey!)}
        >
          <Icon name="external" size={13} />
        </button>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-neutral-950/70 px-2 py-1.5">
      <div className="text-[10px] uppercase text-neutral-600">{label}</div>
      <div className="truncate text-neutral-300" title={value}>
        {value}
      </div>
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
