import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  WorkView,
  WorkFilter,
  DeepStatus,
  LightStatus,
  AppSettings,
  ModelRef,
  WorkEmbeddingStatus,
  ZoteroTag,
} from '@shared/types';
import { Badge, Icon } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { ModelPicker } from '../components/ModelPicker';
import { VirtualList } from '../components/VirtualList';
import { useDataRefresh } from '../hooks';
import {
  ASSISTANT_CONTEXTS,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';

const LIBRARY_ROW_HEIGHT = 64;
const LIBRARY_GRID_TEMPLATE =
  '2rem minmax(18rem,2fr) minmax(9rem,1fr) 4.5rem minmax(8rem,1fr) 5.25rem 6.25rem 5.75rem 12rem';

function lightBadge(s: LightStatus) {
  if (s === 'done') return <Badge color="green">ligero ✓</Badge>;
  if (s === 'none') return <Badge color="neutral">—</Badge>;
  if (s === 'failed') return <Badge color="red">ligero ✕</Badge>;
  return <Badge color="neutral">ligero…</Badge>;
}

function deepBadge(s: DeepStatus) {
  switch (s) {
    case 'done':
      return <Badge color="indigo">profundo ✓</Badge>;
    case 'pending':
      return <Badge color="amber">profundo…</Badge>;
    case 'failed':
      return <Badge color="red">profundo ✕</Badge>;
    case 'skipped_no_text':
      return <Badge color="amber" title="Sin texto disponible">sin texto</Badge>;
    default:
      return <Badge color="neutral">—</Badge>;
  }
}

function triggerBadge(w: WorkView) {
  if (!w.deep_trigger) return null;
  if (w.deep_trigger === 'tag') return <span title="Por tag">🏷</span>;
  if (w.deep_trigger === 'manual') return <span title="Manual">✦</span>;
  return (
    <span title="Tag + manual">
      🏷✦
    </span>
  );
}

function embeddingBadge(status: WorkEmbeddingStatus | undefined) {
  if (!status || status.totalIdeas === 0) return <Badge color="neutral">—</Badge>;
  if (status.complete) return <Badge color="cyan">✓ {status.embeddedIdeas}</Badge>;
  return (
    <Badge color="amber" title={`${status.embeddedIdeas}/${status.totalIdeas} ideas indexadas`}>
      {status.embeddedIdeas}/{status.totalIdeas}
    </Badge>
  );
}

export function Library({
  settings,
  onOpenCollections,
  onOpenGraph,
  onOpenAssistant,
}: {
  settings: AppSettings;
  onOpenCollections: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const [works, setWorks] = useState<WorkView[]>([]);
  const [filter, setFilter] = useState<WorkFilter>({ lightStatus: 'all', deepStatus: 'all' });
  const [availableZoteroTags, setAvailableZoteroTags] = useState<ZoteroTag[]>([]);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [scanModel, setScanModel] = useState<ModelRef | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [embeddingStatuses, setEmbeddingStatuses] = useState<Map<string, WorkEmbeddingStatus>>(new Map());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmReindex, setConfirmReindex] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [w, tags, statuses] = await Promise.all([
      window.nodus.listWorks(filter),
      window.nodus.listZoteroTags(),
      window.nodus.getWorkEmbeddingStatuses(),
    ]);
    setWorks(w);
    setAvailableZoteroTags(tags);
    setEmbeddingStatuses(new Map(statuses.map((s) => [s.nodus_id, s])));
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataRefresh(load);

  const analyzeThemes = async (w: WorkView) => {
    await window.nodus.rescan(w.nodus_id, 'light', scanModel);
    await load();
  };

  const analyzeIdeas = async (w: WorkView) => {
    if (w.deep_status === 'done') {
      await window.nodus.rescan(w.nodus_id, 'deep', scanModel);
    } else {
      await window.nodus.setManualDeep(w.nodus_id, true, scanModel);
    }
    await load();
  };

  const analyzeBoth = async (w: WorkView) => {
    await window.nodus.analyzeBoth(w.nodus_id, scanModel);
    await load();
  };

  const analyzeSelectedThemes = async () => {
    for (const id of selected) {
      await window.nodus.rescan(id, 'light', scanModel);
    }
    setSelected(new Set());
    await load();
  };

  const analyzeSelectedIdeas = async () => {
    await window.nodus.setManualDeepBulk(Array.from(selected), true, scanModel);
    setSelected(new Set());
    await load();
  };

  const analyzeSelectedBoth = async () => {
    await window.nodus.analyzeBothBulk(Array.from(selected), scanModel);
    setSelected(new Set());
    await load();
  };

  const reassignThemes = async () => {
    const ok = window.confirm(
      'Reasignar temas vuelve a ejecutar el análisis ligero (título + abstract) sobre TODA la biblioteca para reconstruir los temas padre y agrupar las ideas existentes bajo ellos. Consume tokens del modelo seleccionado. ¿Continuar?'
    );
    if (!ok) return;
    const n = await window.nodus.reassignThemes(scanModel);
    await load();
    window.alert(`Reasignación de temas en cola para ${n} obra(s). Verás el progreso en la cola.`);
  };

  const embedWork = async (nodusId: string) => {
    await window.nodus.startEmbedding([nodusId]);
  };

  const embedSelected = async () => {
    await window.nodus.startEmbedding(Array.from(selected));
    setSelected(new Set());
  };

  const embedPending = async () => {
    await window.nodus.startEmbedding();
  };

  const doReindexAll = async () => {
    setConfirmReindex(false);
    await window.nodus.reindexAll();
  };

  const needsEmbedding = (w: WorkView) => {
    const s = embeddingStatuses.get(w.nodus_id);
    return w.deep_status === 'done' && s && !s.complete && s.totalIdeas > 0;
  };

  const discoverBridges = async () => {
    await window.nodus.enqueueBridgeDiscovery(scanModel);
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectedZoteroTags = filter.zoteroTags ?? [];
  const visibleZoteroTags = useMemo(() => {
    const query = tagSearch.trim().toLocaleLowerCase();
    return query ? availableZoteroTags.filter((tag) => tag.label.toLocaleLowerCase().includes(query)) : availableZoteroTags;
  }, [availableZoteroTags, tagSearch]);

  const toggleZoteroTag = (label: string) => {
    setFilter((current) => {
      const selected = current.zoteroTags ?? [];
      const normalized = label.toLocaleLowerCase();
      const exists = selected.some((tag) => tag.toLocaleLowerCase() === normalized);
      return {
        ...current,
        zoteroTags: exists ? selected.filter((tag) => tag.toLocaleLowerCase() !== normalized) : [...selected, label],
      };
    });
  };

  const clearZoteroTags = () => {
    setFilter((current) => ({ ...current, zoteroTags: [], zoteroTagMode: 'any' }));
    setTagSearch('');
  };

  const allVisibleSelected = works.length > 0 && works.every((w) => selected.has(w.nodus_id));
  const summary = useMemo(() => {
    const pendingEmbeddings = works.filter((w) => {
      const s = embeddingStatuses.get(w.nodus_id);
      return w.deep_status === 'done' && s && !s.complete && s.totalIdeas > 0;
    }).length;
    return {
      withoutThemes: works.filter((w) => w.light_status === 'none').length,
      themesDone: works.filter((w) => w.light_status === 'done').length,
      ideasDone: works.filter((w) => w.deep_status === 'done').length,
      failed: works.filter((w) => w.light_status === 'failed' || w.deep_status === 'failed').length,
      pendingEmbeddings,
    };
  }, [embeddingStatuses, works]);

  return (
    <div className="h-full flex flex-col p-6 min-h-0">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">Biblioteca</h1>
          <p className="text-sm text-neutral-500 mt-1">{works.length} obras visibles</p>
        </div>
        <div className="flex-1" />
        <button
          className={`btn border border-neutral-700 gap-1.5 ${advancedOpen ? 'bg-neutral-800 text-neutral-100' : 'btn-ghost'}`}
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
        >
          <Icon name="wand" /> Operaciones
        </button>
        <button className="btn btn-ghost border border-neutral-700" onClick={onOpenCollections}>
          <Icon name="folder" /> Colecciones
        </button>
      </div>

      <div className="card p-3 mb-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="input"
            placeholder="Buscar título o autor…"
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          />
          <select
            className="input"
            value={filter.lightStatus}
            onChange={(e) => setFilter((f) => ({ ...f, lightStatus: e.target.value as any }))}
          >
            <option value="all">Ligero: todos</option>
            <option value="none">Ligero: ninguno</option>
            <option value="done">Ligero: hecho</option>
            <option value="pending">Ligero: pendiente</option>
            <option value="failed">Ligero: fallido</option>
          </select>
          <select
            className="input"
            value={filter.deepStatus}
            onChange={(e) => setFilter((f) => ({ ...f, deepStatus: e.target.value as any }))}
          >
            <option value="all">Profundo: todos</option>
            <option value="done">Profundo: hecho</option>
            <option value="pending">Profundo: pendiente</option>
            <option value="none">Profundo: ninguno</option>
            <option value="skipped_no_text">Profundo: sin texto</option>
          </select>
          <div className="relative">
            <button
              type="button"
              className={`zotero-tag-filter btn border gap-1.5 ${selectedZoteroTags.length ? 'is-active border-indigo-700 bg-indigo-950/40 text-indigo-100' : 'btn-ghost border-neutral-700'}`}
              onClick={() => setTagFilterOpen((open) => !open)}
              aria-expanded={tagFilterOpen}
              aria-haspopup="dialog"
            >
              <Icon name="tag" /> Etiquetas Zotero
              {selectedZoteroTags.length > 0 && (
                <span className="zotero-tag-filter-count rounded bg-indigo-800/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {selectedZoteroTags.length}
                </span>
              )}
            </button>
            {tagFilterOpen && (
              <div
                role="dialog"
                aria-label="Filtrar por etiquetas de Zotero"
                className="absolute left-0 z-30 mt-2 w-[23rem] max-w-[calc(100vw-3rem)] rounded-lg border border-neutral-700 bg-neutral-950 p-3 shadow-2xl"
              >
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    className="input min-w-0 flex-1"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="Buscar etiqueta…"
                  />
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={selectedZoteroTags.length === 0}
                    onClick={clearZoteroTags}
                  >
                    Limpiar
                  </button>
                </div>
                {selectedZoteroTags.length > 1 && (
                  <label className="mt-3 flex items-center justify-between gap-3 text-xs text-neutral-400">
                    Combinar etiquetas
                    <select
                      className="input py-1 text-xs"
                      value={filter.zoteroTagMode ?? 'any'}
                      onChange={(e) => setFilter((current) => ({ ...current, zoteroTagMode: e.target.value as 'any' | 'all' }))}
                    >
                      <option value="any">Cualquiera</option>
                      <option value="all">Todas</option>
                    </select>
                  </label>
                )}
                <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
                  {visibleZoteroTags.map((tag) => {
                    const checked = selectedZoteroTags.some((selected) => selected.toLocaleLowerCase() === tag.label.toLocaleLowerCase());
                    return (
                      <button
                        key={tag.label}
                        type="button"
                        className={`zotero-tag-option flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-800 ${
                          checked ? 'is-selected bg-indigo-950/50 text-indigo-100' : 'text-neutral-300'
                        }`}
                        onClick={() => toggleZoteroTag(tag.label)}
                      >
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded border ${
                            checked ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-neutral-600'
                          }`}
                        >
                          {checked && <Icon name="check" size={12} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{tag.label}</span>
                        <span className="text-xs tabular-nums text-neutral-500">{tag.workCount}</span>
                      </button>
                    );
                  })}
                  {availableZoteroTags.length === 0 && (
                    <p className="px-2 py-3 text-xs leading-relaxed text-neutral-500">
                      Aún no hay etiquetas guardadas. Pulsa “Actualizar” para leer las etiquetas de las colecciones monitorizadas en Zotero.
                    </p>
                  )}
                  {availableZoteroTags.length > 0 && visibleZoteroTags.length === 0 && (
                    <p className="px-2 py-3 text-xs text-neutral-500">No hay etiquetas que coincidan.</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex-1" />
          <span className="text-xs text-neutral-500">Modelo para análisis</span>
          <ModelPicker settings={settings} value={scanModel} onChange={setScanModel} compact />
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <SummaryPill label="temas hechos" value={summary.themesDone} />
          <SummaryPill label="sin temas" value={summary.withoutThemes} />
          <SummaryPill label="ideas hechas" value={summary.ideasDone} />
          <SummaryPill label="embeddings pendientes" value={summary.pendingEmbeddings} tone="cyan" />
          {summary.failed > 0 && <SummaryPill label="fallos" value={summary.failed} tone="red" />}
        </div>
        {selectedZoteroTags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span>Etiquetas:</span>
            {selectedZoteroTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="zotero-tag-chip inline-flex items-center gap-1 rounded-md border border-indigo-800/70 bg-indigo-950/30 px-2 py-1 text-indigo-200 hover:bg-indigo-950/60"
                onClick={() => toggleZoteroTag(tag)}
                title={`Quitar ${tag}`}
              >
                {tag} <Icon name="x" size={12} />
              </button>
            ))}
            {selectedZoteroTags.length > 1 && (
              <span className="ml-1">
                {filter.zoteroTagMode === 'all' ? 'deben estar todas' : 'basta cualquiera'}
              </span>
            )}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="mb-3 rounded-lg border border-indigo-800/70 bg-indigo-950/20 px-3 py-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-indigo-200">{selected.size} seleccionadas</span>
          <span className="hidden sm:block h-5 w-px bg-indigo-800/70" />
          <button className="btn btn-ghost border border-neutral-700" onClick={analyzeSelectedThemes}>
            <Icon name="tag" /> Temas
          </button>
          <button className="btn btn-ghost border border-neutral-700" onClick={analyzeSelectedIdeas}>
            <Icon name="bulb" /> Ideas
          </button>
          <button className="btn btn-primary" onClick={analyzeSelectedBoth}>
            <Icon name="layers" /> Temas + ideas
          </button>
          <button className="btn btn-ghost border border-cyan-800 text-cyan-300" onClick={embedSelected}>
            <Icon name="search" /> Indexar
          </button>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>
            Limpiar selección
          </button>
        </div>
      )}

      {advancedOpen && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-4">
          <OperationCard
            icon="wand"
            title="Reasignar temas"
            description="Reconstruye los temas padre de toda la biblioteca con análisis ligero. Útil tras cambiar criterios temáticos."
            buttonLabel="Reasignar"
            onClick={reassignThemes}
          />
          <OperationCard
            icon="search"
            title="Indexar pendientes"
            description="Genera embeddings para las ideas que aún no los tienen. No regenera los existentes."
            buttonLabel="Indexar pendientes"
            tone="cyan"
            onClick={embedPending}
          />
          <OperationCard
            icon="search"
            title="Reindexar todo"
            description="Borra todos los embeddings y los regenera desde cero. Útil tras cambiar de modelo de embeddings."
            buttonLabel="Reindexar todo"
            tone="cyan"
            onClick={() => setConfirmReindex(true)}
          />
          <OperationCard
            icon="compass"
            title="Descubrir relaciones"
            description="Usa embeddings e IA para validar puentes semánticos entre ideas que aún no están conectadas. El progreso se muestra en la cola."
            buttonLabel="Descubrir"
            tone="violet"
            onClick={discoverBridges}
          />
        </div>
      )}

      <div className="card flex-1 flex flex-col min-h-0 overflow-hidden text-sm">
        <div
          className="grid items-center bg-neutral-900 text-neutral-400 border-b border-neutral-800 px-2 py-2 text-left text-xs"
          style={{ gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}
        >
          <div className="font-medium">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(e) => {
                if (e.target.checked) setSelected(new Set(works.map((w) => w.nodus_id)));
                else setSelected(new Set());
              }}
            />
          </div>
          <div className="font-medium">Título</div>
          <div className="font-medium">Autores</div>
          <div className="font-medium">Año</div>
          <div className="font-medium">Tema(s)</div>
          <div className="font-medium">Ligero</div>
          <div className="font-medium">Profundo</div>
          <div className="font-medium">Embeddings</div>
          <div className="font-medium" data-tour="library-actions">Acciones</div>
        </div>
        {loading ? (
          <div className="p-4 text-neutral-500">Cargando...</div>
        ) : (
          <VirtualList
            items={works}
            itemHeight={LIBRARY_ROW_HEIGHT}
            getKey={(w) => w.nodus_id}
            className="flex-1 min-h-0"
            empty={<div className="p-4 text-neutral-500">No hay obras con los filtros actuales.</div>}
            renderItem={(w) => (
              <div
                className="grid h-full items-center border-b border-neutral-800/70 px-2 hover:bg-neutral-900/50"
                style={{ gridTemplateColumns: LIBRARY_GRID_TEMPLATE }}
              >
                <div className="p-1">
                  <input
                    type="checkbox"
                    checked={selected.has(w.nodus_id)}
                    onChange={(e) => toggleSelected(w.nodus_id, e.target.checked)}
                  />
                </div>
                <div className="min-w-0 p-1">
                  <div className="truncate" title={w.title}>
                    {w.title}
                  </div>
                  <div className="text-[10px] text-neutral-600 font-mono">{w.nodus_id.slice(0, 8)}</div>
                </div>
                <div className="p-1 min-w-0 truncate text-neutral-400">
                  {w.authors[0] ?? '—'}
                  {w.authors.length > 1 ? ' et al.' : ''}
                </div>
                <div className="p-1 text-neutral-400">{w.year ?? '—'}</div>
                <div className="p-1 text-neutral-400 truncate">{w.themes.join(', ')}</div>
                <div className="p-1">{lightBadge(w.light_status)}</div>
                <div className="p-1 whitespace-nowrap">
                  {deepBadge(w.deep_status)} {triggerBadge(w)}
                </div>
                <div className="p-1 whitespace-nowrap">
                  {embeddingBadge(embeddingStatuses.get(w.nodus_id))}
                  {needsEmbedding(w) && (
                    <button
                      className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300"
                      title="Indexar embeddings de esta obra"
                      onClick={() => embedWork(w.nodus_id)}
                    >
                      <Icon name="search" size={11} />
                    </button>
                  )}
                </div>
                <div className="p-1 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <RowIconButton title="Analizar temas" icon="tag" onClick={() => analyzeThemes(w)} />
                    <RowIconButton title={w.deep_status === 'done' ? 'Reanalizar ideas' : 'Analizar ideas'} icon="bulb" onClick={() => analyzeIdeas(w)} />
                    <RowIconButton title="Analizar temas e ideas" icon="layers" onClick={() => analyzeBoth(w)} />
                    <RowIconButton
                      title="Ver esta obra en el grafo"
                      icon="map"
                      tone="cyan"
                      onClick={() =>
                        onOpenGraph({
                          preset: 'reading',
                          workId: w.nodus_id,
                          workTitle: w.title,
                          zoteroKey: w.zotero_key,
                          label: `Lectura: ${w.title}`,
                        })
                      }
                    />
                    <RowIconButton
                      title="Preguntar al asistente sobre esta obra"
                      icon="wand"
                      tone="violet"
                      onClick={() =>
                        onOpenAssistant({
                          title: `Lectura: ${w.title}`,
                          selection: ASSISTANT_CONTEXTS.reading,
                          prompt:
                            `Analiza esta lectura dentro del corpus: ideas extraídas, temas, huecos, contradicciones y próximas lecturas relacionadas.\n\n` +
                            `${w.title}\n${w.authors.join(', ')}${w.year ? ` (${w.year})` : ''}`,
                        })
                      }
                    />
                    <RowIconButton title="Abrir en Zotero" icon="external" tone="indigo" onClick={() => window.nodus.openInZotero(w.zotero_key)} />
                  </div>
                </div>
              </div>
            )}
          />
        )}
      </div>
      {confirmReindex && (
        <ConfirmModal
          title="Reindexar todos los embeddings"
          message="Se borrarán TODOS los embeddings existentes y se regenerarán desde cero. Esto consumirá tokens del proveedor de embeddings configurado. ¿Continuar?"
          confirmLabel="Reindexar todo"
          danger
          onConfirm={() => void doReindexAll()}
          onCancel={() => setConfirmReindex(false)}
        />
      )}
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'cyan' | 'red';
}) {
  const toneClass =
    tone === 'cyan'
      ? 'border-cyan-900/70 text-cyan-300'
      : tone === 'red'
        ? 'border-red-900/70 text-red-300'
        : 'border-neutral-800 text-neutral-400';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${toneClass}`}>
      <span className="font-semibold tabular-nums text-neutral-100">{value}</span>
      {label}
    </span>
  );
}

function OperationCard({
  icon,
  title,
  description,
  buttonLabel,
  tone = 'neutral',
  disabled,
  onClick,
}: {
  icon: string;
  title: string;
  description: string;
  buttonLabel: string;
  tone?: 'neutral' | 'cyan' | 'violet';
  disabled?: boolean;
  onClick: () => void;
}) {
  const toneClass =
    tone === 'cyan'
      ? 'border-cyan-900/70 text-cyan-300'
      : tone === 'violet'
        ? 'border-violet-900/70 text-violet-300'
        : 'border-neutral-800 text-neutral-300';
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md border ${toneClass}`}>
          <Icon name={icon} />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
      <button className="btn btn-ghost border border-neutral-700 mt-auto" disabled={disabled} onClick={onClick}>
        {buttonLabel}
      </button>
    </section>
  );
}

function RowIconButton({
  title,
  icon,
  tone = 'neutral',
  onClick,
}: {
  title: string;
  icon: string;
  tone?: 'neutral' | 'indigo' | 'cyan' | 'violet';
  onClick: () => void;
}) {
  const toneClass =
    tone === 'indigo'
      ? 'text-indigo-400 hover:text-indigo-300'
      : tone === 'cyan'
        ? 'text-cyan-400 hover:text-cyan-300'
        : tone === 'violet'
          ? 'text-violet-400 hover:text-violet-300'
          : 'text-neutral-400 hover:text-neutral-100';
  return (
    <button
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-neutral-800 ${toneClass}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}
