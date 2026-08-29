import { lazy, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { GraphData } from '@shared/types';
import { Icon } from '../../components/ui';
import { GraphErrorBoundary } from '../../views/graph/GraphErrorBoundary';
import { buildGraphModel } from '../../views/graph/model';
import { advancedRest, type AuthorsQuery, type IdeasQuery } from './api';
import { toGraphData, type AdvancedAuthor, type AdvancedAuthorDossier, type AdvancedIdea, type AdvancedIdeaDetail, type AdvancedPage } from './types';

type Surface = 'ideas' | 'authors' | 'graph';

const SigmaGraph = lazy(() => import('../../views/graph/SigmaGraph').then((module) => ({ default: module.SigmaGraph })));

const IDEA_TYPES = ['', 'claim', 'finding', 'construct', 'method', 'framework'] as const;
const IDEA_SORTS = ['label', 'type', 'works', 'connections', 'confidence'] as const;
const AUTHOR_SORTS = ['surname', 'name', 'works', 'ideas', 'connections'] as const;

function stringValue(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return typeof value === 'string' ? value : String(value);
}

function authorHeading(dossier: AdvancedAuthorDossier): string {
  return stringValue(dossier.fullName || dossier.author.name, 'Autor sin nombre');
}

function formatNumber(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('es') : '0';
}

function ErrorMessage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return <div className="rounded-xl border border-red-800/70 bg-red-950/30 p-4 text-sm text-red-300" role="alert">
    <strong>No se ha podido cargar el contenido publicado.</strong>
    <p className="mt-1 text-xs opacity-80">{error instanceof Error ? error.message : String(error)}</p>
    {onRetry && <button className="btn btn-ghost mt-3 text-xs" onClick={onRetry}>Reintentar</button>}
  </div>;
}

function Loading() {
  return <div className="grid min-h-40 place-items-center text-sm text-neutral-500" role="status">Cargando…</div>;
}

function ReadOnlyBadge() {
  return <span className="inline-flex items-center gap-1 rounded-full border border-teal-800/70 bg-teal-950/35 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-teal-300"><Icon name="lock" size={11} /> Solo lectura</span>;
}

function Section({ title, icon, children, testId }: { title: string; icon?: string; children: ReactNode; testId?: string }) {
  return <section data-testid={testId} className="rounded-xl border border-neutral-800 bg-neutral-950/45 p-4">
    <div className="mb-3 flex items-center gap-2"><Icon name={icon ?? 'layers'} size={15} className="text-indigo-300" /><h3 className="text-sm font-semibold text-neutral-100">{title}</h3></div>
    {children}
  </section>;
}

function PageControls({ page, onPage }: { page: AdvancedPage<unknown>; onPage: (offset: number) => void }) {
  const current = page.limit ? Math.floor(page.offset / page.limit) + 1 : 1;
  const totalPages = page.limit ? Math.max(1, Math.ceil(page.total / page.limit)) : 1;
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500" data-testid="advanced-pagination">
    <span>{page.total ? `${page.offset + 1}–${Math.min(page.total, page.offset + page.items.length)} de ${page.total}` : 'Sin resultados'}</span>
    <div className="flex items-center gap-2"><button className="btn btn-ghost text-xs" disabled={page.offset <= 0} onClick={() => onPage(Math.max(0, page.offset - page.limit))} aria-label="Página anterior">‹</button><span>Página {current} / {totalPages}</span><button className="btn btn-ghost text-xs" disabled={!page.hasMore} onClick={() => onPage(page.offset + page.limit)} aria-label="Página siguiente">›</button></div>
  </div>;
}

function IdeaCard({ idea, onOpen }: { idea: AdvancedIdea; onOpen: () => void }) {
  return <button className="server-record-card flex items-start gap-3" onClick={onOpen} data-testid="advanced-idea-card">
    <span className="server-record-icon"><Icon name="bulb" /></span>
    <span className="min-w-0 flex-1"><strong className="block truncate text-sm text-neutral-200">{idea.label}</strong><span className="mt-1 block text-[11px] uppercase tracking-wide text-indigo-300">{idea.type}</span><small className="mt-1 line-clamp-2 block text-xs leading-5 text-neutral-500">{idea.statement || 'Sin enunciado publicado'}</small><span className="mt-2 block text-[11px] text-neutral-600">{formatNumber(idea.workCount)} obras · {formatNumber(idea.connectionCount)} conexiones</span></span><Icon name="chevronRight" size={14} className="mt-2 text-neutral-700" />
  </button>;
}

function IdeaDetail({ detail, onBack }: { detail: AdvancedIdeaDetail; onBack: () => void }) {
  const idea = detail.idea;
  return <div className="space-y-4" data-testid="advanced-idea-detail">
    <button className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-200" onClick={onBack}><Icon name="chevronLeft" size={13} />Volver a Ideas</button>
    <header className="rounded-2xl border border-indigo-800/60 bg-indigo-950/25 p-5"><div className="flex flex-wrap items-start gap-3"><span className="server-record-icon"><Icon name="bulb" /></span><div className="min-w-0 flex-1"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-indigo-300">{stringValue(idea.type, 'claim')}</div><h2 className="mt-1 text-xl font-semibold text-neutral-100">{stringValue(idea.label, 'Idea sin título')}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-400">{stringValue(idea.statement, 'Sin enunciado publicado')}</p><div className="mt-3 flex flex-wrap gap-2">{detail.themes.map((theme) => <span key={theme} className="rounded-full border border-amber-800/60 px-2 py-1 text-[11px] text-amber-300">{theme}</span>)}</div></div><ReadOnlyBadge /></div></header>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Section title={`Obras y ocurrencias (${detail.occurrences.length})`} icon="book"><div className="space-y-2">{detail.occurrences.length ? detail.occurrences.map((entry, index) => <article key={`${stringValue(entry.nodus_id, String(index))}-${index}`} className="rounded-lg border border-neutral-800 p-3"><strong className="text-sm text-neutral-200">{stringValue(entry.workTitle ?? entry.nodus_id, 'Obra publicada')}</strong><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-neutral-500">{stringValue(entry.development ?? entry.context, 'Sin desarrollo publicado')}</p><span className="mt-1 block text-[11px] text-neutral-600">{stringValue(entry.role, 'secondary')} · confianza {stringValue(entry.confidence, '—')}</span></article>) : <p className="text-xs text-neutral-600">No hay ocurrencias publicadas.</p>}</div></Section>
      <Section title={`Evidencia (${detail.evidence.length})`} icon="quote"><div className="space-y-2">{detail.evidence.length ? detail.evidence.map((entry, index) => <blockquote key={`${index}-${stringValue(entry.id)}`} className="rounded-r-lg border-l-2 border-indigo-500 bg-neutral-900/55 px-3 py-2 text-sm italic leading-6 text-neutral-300">“{stringValue(entry.quote ?? entry.text, 'Evidencia sin texto')}”<span className="mt-1 block text-[11px] not-italic text-neutral-600">{stringValue(entry.location ?? entry.source_ref, '')}</span></blockquote>) : <p className="text-xs text-neutral-600">No hay evidencia anclada publicada.</p>}</div></Section>
      <Section title={`Relaciones (${detail.relations.length})`} icon="share"><div className="space-y-2">{detail.relations.length ? detail.relations.map((entry, index) => <div key={`${stringValue(entry.id, String(index))}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-xs"><span className="text-neutral-300">{stringValue(entry.type, 'relación')}</span><span className="text-neutral-500">{stringValue(entry.from_id)} → {stringValue(entry.to_id)}</span></div>) : <p className="text-xs text-neutral-600">No hay relaciones visibles.</p>}</div></Section>
      <Section title="Metadatos publicados" icon="info"><dl className="server-detail-list">{Object.entries(idea).filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object').slice(0, 20).map(([key, value]) => <div key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{stringValue(value)}</dd></div>)}</dl></Section>
    </div>
  </div>;
}

export function IdeasServerView({ spaceId }: { spaceId: string }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<IdeasQuery>({ offset: 0, limit: 80, sort: 'label' });
  const [page, setPage] = useState<AdvancedPage<AdvancedIdea>>({ items: [], total: 0, offset: 0, limit: 80, hasMore: false });
  const [detail, setDetail] = useState<AdvancedIdeaDetail | null>(null);
  const [openTabs, setOpenTabs] = useState<Array<{ id: string; label: string }>>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  const load = useCallback(async () => { const request = ++listRequest.current; setLoading(true); setError(undefined); try { const next = await advancedRest.ideas(spaceId, filters); if (request === listRequest.current) setPage(next); } catch (cause) { if (request === listRequest.current) setError(cause); } finally { if (request === listRequest.current) setLoading(false); } }, [filters, spaceId]);
  useEffect(() => { void load(); }, [load]);
  const open = useCallback(async (idea: Pick<AdvancedIdea, 'id' | 'label'>) => { const request = ++detailRequest.current; setOpenTabs((tabs) => tabs.some((tab) => tab.id === idea.id) ? tabs : [...tabs, { id: idea.id, label: idea.label }]); setActiveId(idea.id); setError(undefined); try { const next = await advancedRest.idea(spaceId, idea.id); if (request === detailRequest.current) setDetail(next); } catch (cause) { if (request === detailRequest.current) setError(cause); } }, [spaceId]);
  const showCatalog = () => { detailRequest.current += 1; setActiveId(null); setDetail(null); };
  const closeTab = (id: string) => { setOpenTabs((tabs) => tabs.filter((tab) => tab.id !== id)); if (activeId === id) showCatalog(); };
  const submit = (event: FormEvent) => { event.preventDefault(); setFilters((current) => ({ ...current, offset: 0, q: query.trim() || undefined })); };

  return <div className="flex h-full min-h-0 flex-col" data-testid="advanced-ideas-view">
    <header className="shrink-0 border-b border-neutral-800 p-4"><div className="flex flex-wrap items-center gap-3"><div><h1 className="text-base font-semibold text-neutral-100">Ideas</h1><p className="text-xs text-neutral-500">{formatNumber(page.total)} ideas publicadas</p></div><ReadOnlyBadge /></div><div data-testid="advanced-ideas-tabs" className="mt-4 flex min-w-0 items-end gap-1 overflow-x-auto"><button className={`flex h-8 shrink-0 items-center gap-2 rounded-t-lg px-3 text-xs ${!activeId ? 'bg-neutral-900 text-neutral-100' : 'text-neutral-500'}`} onClick={showCatalog}>Catálogo</button>{openTabs.map((tab) => <div key={tab.id} className={`flex h-8 shrink-0 items-center rounded-t-lg ${activeId === tab.id ? 'bg-neutral-900 text-neutral-100' : 'text-neutral-500'}`}><button className="max-w-48 truncate px-3 text-xs" onClick={() => { setActiveId(tab.id); const found = page.items.find((idea) => idea.id === tab.id); if (found) void open(found); }}>{tab.label}</button><button className="mr-1 rounded px-1 text-neutral-600 hover:text-neutral-200" aria-label={`Cerrar ${tab.label}`} onClick={() => closeTab(tab.id)}>×</button></div>)}</div></header>
    <div className="min-h-0 flex-1 overflow-auto p-4">{activeId && detail ? <IdeaDetail detail={detail} onBack={showCatalog} /> : <>{activeId && <Loading />}{!activeId && <><form className="mb-4 flex flex-wrap gap-2" onSubmit={submit}><input data-testid="advanced-ideas-search" className="input min-w-[180px] flex-1 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ideas publicadas…" /><select className="input text-xs" value={filters.type ?? ''} onChange={(event) => setFilters((current) => ({ ...current, offset: 0, type: event.target.value || undefined }))}>{IDEA_TYPES.map((type) => <option key={type} value={type}>{type || 'Todos los tipos'}</option>)}</select><select className="input text-xs" value={filters.sort ?? 'label'} onChange={(event) => setFilters((current) => ({ ...current, offset: 0, sort: event.target.value as IdeasQuery['sort'] }))}>{IDEA_SORTS.map((sort) => <option key={sort} value={sort}>{sort === 'label' ? 'Etiqueta' : sort}</option>)}</select><button className="btn text-xs">Buscar</button></form>{error ? <ErrorMessage error={error} onRetry={() => void load()} /> : loading ? <Loading /> : page.items.length === 0 ? <div className="grid min-h-40 place-items-center text-sm text-neutral-600">No hay ideas publicadas con estos filtros.</div> : <><div className="server-record-grid">{page.items.map((idea) => <IdeaCard key={idea.id} idea={idea} onOpen={() => void open(idea)} />)}</div><PageControls page={page} onPage={(offset) => setFilters((current) => ({ ...current, offset }))} /></>}</>}</>}</div>
  </div>;
}

function AuthorCard({ author, onOpen }: { author: AdvancedAuthor; onOpen: () => void }) {
  return <button className="server-record-card flex items-start gap-3" onClick={onOpen} data-testid="advanced-author-card"><span className="server-record-icon"><Icon name="graduation" /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-neutral-200">{author.fullName || author.name}</strong><small className="mt-1 block truncate text-xs text-neutral-500">{author.affiliation || 'Afiliación no publicada'}</small><span className="mt-2 block text-[11px] text-neutral-600">{formatNumber(author.workCount)} obras · {formatNumber(author.ideaCount)} ideas · {formatNumber(author.relationCount)} conexiones</span><span className="mt-2 flex flex-wrap gap-1">{author.topThemes.slice(0, 3).map((theme) => <span key={theme} className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-amber-300">{theme}</span>)}</span></span><Icon name="chevronRight" size={14} className="mt-2 text-neutral-700" /></button>;
}

function Synthesis({ synthesis }: { synthesis: AdvancedAuthorDossier['synthesis'] }) {
  if (!synthesis) return <p className="text-xs text-neutral-600">No hay síntesis publicada para este autor.</p>;
  return <div data-testid="advanced-author-synthesis" className="space-y-3"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-teal-800/60 px-2 py-1 text-[10px] uppercase tracking-wide text-teal-300">Síntesis publicada</span>{synthesis.stale && <span className="rounded-full border border-amber-800/60 px-2 py-1 text-[10px] text-amber-300">Puede estar desactualizada</span>}</div><p className="text-sm leading-6 text-neutral-300">{synthesis.thesis || 'Sin tesis publicada.'}</p>{synthesis.remember.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-neutral-400">{synthesis.remember.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ul>}{synthesis.positioning && <p className="border-t border-neutral-800 pt-3 text-xs leading-5 text-neutral-500">{synthesis.positioning}</p>}<p className="text-[10px] text-neutral-600">Generada: {stringValue(synthesis.generatedAt)}</p></div>;
}

function AuthorDossier({ dossier, onBack, privateSynthesis: _privateSynthesis }: { dossier: AdvancedAuthorDossier; onBack: () => void; privateSynthesis?: ReactNode }) {
  return <div className="space-y-4" data-testid="advanced-author-dossier"><button className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-200" onClick={onBack}><Icon name="chevronLeft" size={13} />Volver a Autores</button><header className="rounded-2xl border border-indigo-800/60 bg-indigo-950/25 p-5"><div className="flex flex-wrap items-start gap-3"><span className="server-record-icon"><Icon name="graduation" /></span><div className="min-w-0 flex-1"><h2 className="text-xl font-semibold text-neutral-100">{authorHeading(dossier)}</h2><p className="mt-1 text-xs text-neutral-500">{stringValue(dossier.author.affiliation, 'Afiliación no publicada')}</p><div className="mt-3 flex flex-wrap gap-2">{dossier.themes.map((theme) => <span key={theme} className="rounded-full border border-amber-800/60 px-2 py-1 text-[11px] text-amber-300">{theme}</span>)}</div></div><ReadOnlyBadge /></div></header><Section title="Síntesis publicada" icon="sparkles"><Synthesis synthesis={dossier.synthesis} /></Section><div className="grid items-start gap-4 xl:grid-cols-2"><Section title={`Obras (${dossier.works.length})`} icon="book">{dossier.works.length ? <div className="space-y-2">{dossier.works.map((work) => <article key={work.nodus_id} className="rounded-lg border border-neutral-800 p-3"><strong className="text-sm text-neutral-200">{work.title}</strong><p className="mt-1 text-xs text-neutral-500">{stringValue(work.year, 'Año desconocido')} · {work.itemType || 'obra'} · {work.read ? 'Leída' : 'No marcada como leída'}</p></article>)}</div> : <p className="text-xs text-neutral-600">No hay obras de autoría publicadas.</p>}</Section><Section title={`Ideas (${dossier.ideas.length})`} icon="bulb">{dossier.ideas.length ? <div className="space-y-2">{dossier.ideas.map((idea) => <article key={`${idea.global_id}-${idea.workId}`} className="rounded-lg border border-neutral-800 p-3"><strong className="text-sm text-neutral-200">{idea.label}</strong><p className="mt-1 line-clamp-3 text-xs leading-5 text-neutral-500">{idea.statement || idea.development}</p><span className="mt-1 block text-[11px] text-neutral-600">{idea.workTitle} · {idea.role} · confianza {idea.confidence.toFixed(2)}</span></article>)}</div> : <p className="text-xs text-neutral-600">No hay ideas publicadas.</p>}</Section><Section title={`Relaciones autorales (${dossier.relations.length})`} icon="share">{dossier.relations.length ? <div className="space-y-2">{dossier.relations.map((relation) => <div key={`${relation.author_id}-${relation.type}`} className="flex flex-wrap justify-between gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-xs"><span className="text-neutral-300">{relation.name}</span><span className="text-neutral-500">{relation.type} · peso {relation.weight}</span></div>)}</div> : <p className="text-xs text-neutral-600">No hay relaciones visibles.</p>}</Section></div>{dossier.editedWorks.length > 0 && <Section title={`Obras editadas (${dossier.editedWorks.length})`} icon="book"><div className="space-y-1 text-xs text-neutral-500">{dossier.editedWorks.map((work) => <div key={work.nodus_id}>{work.title} <span className="text-neutral-700">· edición</span></div>)}</div></Section>}</div>;
}

export function AuthorsServerView({ spaceId, renderPrivateSynthesis: _renderPrivateSynthesis }: { spaceId: string; renderPrivateSynthesis?: (dossier: AdvancedAuthorDossier) => ReactNode }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<AuthorsQuery>({ offset: 0, limit: 80, sort: 'surname', synthesis: 'all' });
  const [page, setPage] = useState<AdvancedPage<AdvancedAuthor>>({ items: [], total: 0, offset: 0, limit: 80, hasMore: false });
  const [dossier, setDossier] = useState<AdvancedAuthorDossier | null>(null);
  const [openTabs, setOpenTabs] = useState<Array<{ id: string; label: string }>>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const load = useCallback(async () => { const request = ++listRequest.current; setLoading(true); setError(undefined); try { const next = await advancedRest.authors(spaceId, filters); if (request === listRequest.current) setPage(next); } catch (cause) { if (request === listRequest.current) setError(cause); } finally { if (request === listRequest.current) setLoading(false); } }, [filters, spaceId]);
  useEffect(() => { void load(); }, [load]);
  const open = useCallback(async (author: Pick<AdvancedAuthor, 'author_id' | 'name' | 'fullName'>) => { const request = ++detailRequest.current; setOpenTabs((tabs) => tabs.some((tab) => tab.id === author.author_id) ? tabs : [...tabs, { id: author.author_id, label: author.fullName || author.name }]); setActiveId(author.author_id); setError(undefined); try { const next = await advancedRest.authorDossier(spaceId, author.author_id); if (request === detailRequest.current) setDossier(next); } catch (cause) { if (request === detailRequest.current) setError(cause); } }, [spaceId]);
  const submit = (event: FormEvent) => { event.preventDefault(); setFilters((current) => ({ ...current, offset: 0, q: query.trim() || undefined })); };
  const showCatalog = () => { detailRequest.current += 1; setActiveId(null); setDossier(null); };
  const closeTab = (id: string) => { setOpenTabs((tabs) => tabs.filter((tab) => tab.id !== id)); if (activeId === id) showCatalog(); };
  return <div className="flex h-full min-h-0 flex-col" data-testid="advanced-authors-view"><header className="shrink-0 border-b border-neutral-800 p-4"><div className="flex flex-wrap items-center gap-3"><div><h1 className="text-base font-semibold text-neutral-100">Autores</h1><p className="text-xs text-neutral-500">{formatNumber(page.total)} autores publicados</p></div><ReadOnlyBadge /></div><div data-testid="advanced-authors-tabs" className="mt-4 flex min-w-0 items-end gap-1 overflow-x-auto"><button className={`flex h-8 shrink-0 items-center rounded-t-lg px-3 text-xs ${!activeId ? 'bg-neutral-900 text-neutral-100' : 'text-neutral-500'}`} onClick={showCatalog}>Catálogo</button>{openTabs.map((tab) => <div key={tab.id} className={`flex h-8 shrink-0 items-center rounded-t-lg ${activeId === tab.id ? 'bg-neutral-900 text-neutral-100' : 'text-neutral-500'}`}><button className="max-w-48 truncate px-3 text-xs" onClick={() => void open({ author_id: tab.id, name: tab.label, fullName: tab.label })}>{tab.label}</button><button className="mr-1 rounded px-1 text-neutral-600 hover:text-neutral-200" aria-label={`Cerrar ${tab.label}`} onClick={() => closeTab(tab.id)}>×</button></div>)}</div></header><div className="min-h-0 flex-1 overflow-auto p-4">{activeId && dossier ? <AuthorDossier dossier={dossier} onBack={showCatalog} /> : <><form className="mb-4 flex flex-wrap gap-2" onSubmit={submit}><input data-testid="advanced-authors-search" className="input min-w-[180px] flex-1 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar autores publicados…" /><select className="input text-xs" value={filters.synthesis ?? 'all'} onChange={(event) => setFilters((current) => ({ ...current, offset: 0, synthesis: event.target.value as AuthorsQuery['synthesis'] }))}><option value="all">Todas las síntesis</option><option value="with">Con síntesis</option><option value="without">Sin síntesis</option></select><select className="input text-xs" value={filters.sort ?? 'surname'} onChange={(event) => setFilters((current) => ({ ...current, offset: 0, sort: event.target.value as AuthorsQuery['sort'] }))}>{AUTHOR_SORTS.map((sort) => <option key={sort} value={sort}>{sort}</option>)}</select><button className="btn text-xs">Buscar</button></form>{error ? <ErrorMessage error={error} onRetry={() => void load()} /> : loading ? <Loading /> : page.items.length === 0 ? <div className="grid min-h-40 place-items-center text-sm text-neutral-600">No hay autores publicados con estos filtros.</div> : <><div className="server-record-grid">{page.items.map((author) => <AuthorCard key={author.author_id} author={author} onOpen={() => void open(author)} />)}</div><PageControls page={page} onPage={(offset) => setFilters((current) => ({ ...current, offset }))} /></>}</>}</div></div>;
}

const GRAPH_FILTERS = { search: '', nodeTypes: ['theme', 'claim', 'finding', 'construct', 'method', 'framework'], edgeTypes: ['supports', 'refutes', 'contradicts', 'extends', 'refines', 'applies_to', 'shares_method', 'precondition_of', 'measures_same', 'variant_of', 'contains'], theme: '', workIds: [], authors: [], yearMin: null, yearMax: null, readState: 'all' as const, minConfidence: 0, basis: 'all' as const };

export function GraphServerView({ spaceId, initialSeedId, onOpenIdea }: { spaceId: string; initialSeedId?: string; onOpenIdea?: (id: string) => void }) {
  const [seeds, setSeeds] = useState<AdvancedIdea[]>([]);
  const [seedId, setSeedId] = useState(initialSeedId ?? '');
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const graphRequest = useRef(0);
  useEffect(() => { advancedRest.ideas(spaceId, { offset: 0, limit: 80, sort: 'connections' }).then((page) => { setSeeds(page.items); setSeedId((current) => current || page.items[0]?.id || ''); }).catch(setError); }, [spaceId]);
  const load = useCallback(async () => { if (!seedId) return; const request = ++graphRequest.current; setLoading(true); setError(undefined); try { const next = toGraphData(await advancedRest.ideaGraph(spaceId, seedId)); if (request === graphRequest.current) setGraph(next); } catch (cause) { if (request === graphRequest.current) setError(cause); } finally { if (request === graphRequest.current) setLoading(false); } }, [seedId, spaceId]);
  useEffect(() => { void load(); }, [load]);
  const selectedLabel = useMemo(() => seeds.find((idea) => idea.id === seedId)?.label, [seedId, seeds]);
  const graphModel = useMemo(() => graph ? buildGraphModel(graph, GRAPH_FILTERS, 'ideas', 'overview') : null, [graph]);
  return <div className="flex h-full min-h-0 flex-col" data-testid="advanced-graph-view"><header className="shrink-0 border-b border-neutral-800 p-4"><div className="flex flex-wrap items-center gap-3"><div><h1 className="text-base font-semibold text-neutral-100">Grafo</h1><p className="text-xs text-neutral-500">Vecindad publicada alrededor de una idea{selectedLabel ? ` · ${selectedLabel}` : ''}</p></div><ReadOnlyBadge /><label className="ml-auto flex items-center gap-2 text-xs text-neutral-500">Semilla<select data-testid="advanced-graph-seed" className="input max-w-64 text-xs" value={seedId} onChange={(event) => setSeedId(event.target.value)}><option value="">Selecciona una idea</option>{seeds.map((idea) => <option key={idea.id} value={idea.id}>{idea.label}</option>)}</select></label></div></header><div className="relative min-h-0 flex-1 overflow-hidden p-3">{error ? <ErrorMessage error={error} onRetry={() => void load()} /> : loading && !graph ? <Loading /> : graph && graphModel ? <GraphErrorBoundary><SigmaGraph data={graph} filters={GRAPH_FILTERS} lens="ideas" preset="overview" highlightDepth={2} lightTheme={typeof document !== 'undefined' && document.documentElement.classList.contains('light')} overrideModel={graphModel} viewLevel="atlas" showMinimap={false} onOpenNode={(id) => onOpenIdea?.(id)} onOpenEdge={() => undefined} onClearFocus={() => undefined} /></GraphErrorBoundary> : <div className="grid h-full min-h-60 place-items-center text-sm text-neutral-600">Publica ideas para explorar su grafo.</div>}</div></div>;
}

/** Opt-in composition used by the Server Advanced shell; it performs no writes. */
export function AdvancedServerWorkspace({ spaceId, initialSurface = 'ideas', initialGraphSeedId, onOpenIdea }: { spaceId: string; initialSurface?: Surface; initialGraphSeedId?: string; onOpenIdea?: (id: string) => void }) {
  const [surface, setSurface] = useState<Surface>(initialSurface);
  return <div className="server-desktop-surface flex h-full min-h-0 flex-col bg-neutral-950 text-neutral-100" data-testid="advanced-server-workspace"><nav className="flex shrink-0 gap-1 border-b border-neutral-800 p-2" aria-label="Superficies académicas"><button className={`btn text-xs ${surface === 'ideas' ? '' : 'btn-ghost'}`} onClick={() => setSurface('ideas')}><Icon name="bulb" size={13} /> Ideas</button><button className={`btn text-xs ${surface === 'authors' ? '' : 'btn-ghost'}`} onClick={() => setSurface('authors')}><Icon name="graduation" size={13} /> Autores</button><button className={`btn text-xs ${surface === 'graph' ? '' : 'btn-ghost'}`} onClick={() => setSurface('graph')}><Icon name="network" size={13} /> Grafo</button></nav><div className="min-h-0 flex-1">{surface === 'ideas' ? <IdeasServerView spaceId={spaceId} /> : surface === 'authors' ? <AuthorsServerView spaceId={spaceId} /> : <GraphServerView spaceId={spaceId} initialSeedId={initialGraphSeedId} onOpenIdea={onOpenIdea} />}</div></div>;
}
