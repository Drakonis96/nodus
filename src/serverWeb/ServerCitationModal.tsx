import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/ui';
import { AcademicDetailExplorer, type AcademicTarget } from './academic/AcademicDetailExplorer';
import { api } from './api';
import type { JsonRecord } from './types';

export type ServerCitationTarget = AcademicTarget | { kind: 'gap' | 'passage' | 'theme' | 'contradiction'; id: string; label: string };
type NonAcademicCitationTarget = Extract<ServerCitationTarget, { kind: 'gap' | 'passage' | 'theme' | 'contradiction' }>;

const COLLECTIONS: Record<ServerCitationTarget['kind'], string> = {
  idea: 'ideas', work: 'works', author: 'authors', gap: 'gaps', passage: 'passages', theme: 'themes', contradiction: 'contradictions',
};

/** Parse only the citation schemes emitted by Nodus. External and unsupported
 * schemes remain ordinary links in MarkdownReader, so no arbitrary URL can
 * select a private record or trigger an API request. */
export function parseServerCitation(href: string): ServerCitationTarget | null {
  const match = /^nodus:\/\/(idea|work|author|gap|passage|theme|contradiction)\/(.+)$/.exec(href);
  if (!match) return null;
  let id: string;
  try { id = decodeURIComponent(match[2]); } catch { return null; }
  if (!id || id.length > 512) return null;
  const kind = match[1] as ServerCitationTarget['kind'];
  return { kind, id, label: id } as ServerCitationTarget;
}

function text(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return typeof value === 'string' ? value : String(value);
}

function record(value: unknown): JsonRecord | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null; }

function titleFor(value: JsonRecord, fallback: string): string {
  return text(value.title ?? value.label ?? value.name ?? value.statement ?? value.text, fallback);
}

function relatedTarget(value: JsonRecord, collection = ''): ServerCitationTarget | null {
  const rawKind = text(value.kind || value.collection || collection || value.type, '').toLowerCase();
  const normalized = rawKind.replace(/^(idea|work|author|gap|passage|theme|contradiction)_?(occurrences?|links?)?$/, '$1');
  const kind = normalized.endsWith('s') ? normalized.slice(0, -1) : normalized;
  if (!['idea', 'work', 'author', 'gap', 'passage', 'theme', 'contradiction'].includes(kind)) return null;
  const id = text(value.id || value.global_id || value.globalId || value.nodus_id || value.work_id || value.author_id || value.gap_id || value.passage_id || value.theme_id, '');
  return id ? { kind: kind as ServerCitationTarget['kind'], id, label: titleFor(value, id) } : null;
}

function GenericCitationPanel({ spaceId, target, onOpen }: { spaceId: string; target: NonAcademicCitationTarget; onOpen: (target: ServerCitationTarget) => void }) {
  const [payload, setPayload] = useState<JsonRecord | null>(null);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let alive = true;
    setPayload(null); setError(undefined);
    void api.detail(spaceId, COLLECTIONS[target.kind], target.id).then((next) => { if (alive) setPayload(next); }).catch((cause) => { if (alive) setError(cause); });
    return () => { alive = false; };
  }, [spaceId, target.kind, target.id]);
  const primary = payload?.[target.kind] && record(payload[target.kind]) ? record(payload[target.kind]) : payload;
  const arrays = payload ? Object.entries(payload).filter(([, value]) => Array.isArray(value) && (value as unknown[]).length > 0) : [];
  return <div className="space-y-5" data-testid={`server-citation-${target.kind}`}>
    {error ? <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">No se ha podido cargar esta cita.</div> : !payload ? <div className="grid h-48 place-items-center text-sm text-neutral-500">Cargando fuente…</div> : <>
      <header className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5 dark:border-indigo-900/60 dark:bg-indigo-950/25"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-indigo-600 dark:text-indigo-300">{target.kind === 'passage' ? 'Pasaje' : target.kind === 'theme' ? 'Tema' : target.kind === 'gap' ? 'Hueco' : 'Contradicción'} · publicado</p><h2 className="mt-1 text-xl font-semibold">{titleFor(primary || {}, target.label)}</h2><p className="mt-1 text-xs text-neutral-500">Contexto y evidencia publicados · solo lectura</p></header>
      <section className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800" data-testid="server-citation-fields"><dl className="divide-y divide-neutral-200 dark:divide-neutral-800">{Object.entries(primary || {}).filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object').map(([key, value]) => <div key={key} className="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3 text-xs"><dt className="font-semibold uppercase tracking-wide text-neutral-500">{key.replace(/_/g, ' ')}</dt><dd className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{text(value)}</dd></div>)}</dl></section>
      {arrays.map(([key, value]) => <section key={key} className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800"><header className="border-b border-neutral-200 bg-neutral-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">{key.replace(/_/g, ' ')}</header><div>{(value as unknown[]).map((entry, index) => { const item = record(entry); const next = item && relatedTarget(item, key); return next ? <button key={`${next.kind}:${next.id}:${index}`} className="flex w-full items-center gap-3 border-b border-neutral-100 px-4 py-3 text-left text-xs hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/60" onClick={() => onOpen(next)}><span className="min-w-0 flex-1 truncate font-medium">{next.label}</span><Icon name="chevronRight" size={13} className="text-neutral-400" /></button> : <div key={index} className="border-b border-neutral-100 px-4 py-3 text-xs text-neutral-600 dark:border-neutral-900 dark:text-neutral-400">{item ? titleFor(item, text(entry)) : text(entry)}</div>; })}</div></section>)}
    </>}
  </div>;
}

function CitationPanel({ spaceId, target, onOpen }: { spaceId: string; target: ServerCitationTarget; onOpen: (target: ServerCitationTarget) => void }) {
  if (target.kind === 'idea' || target.kind === 'work' || target.kind === 'author') return <AcademicDetailExplorer spaceId={spaceId} origin="Deep Research" initialTarget={target} onOrigin={() => undefined} onOpenTarget={onOpen} />;
  return <GenericCitationPanel spaceId={spaceId} target={target as NonAcademicCitationTarget} onOpen={onOpen} />;
}

type CitationTab = { key: string; target: ServerCitationTarget };

/** Web counterpart of Desktop's SourceCitationModal. Every citation stays in
 * this workspace, and following a related source opens a closeable tab rather
 * than replacing the report behind it. */
export function ServerCitationModal({ spaceId, target, onClose }: { spaceId: string; target: ServerCitationTarget | null; onClose: () => void }) {
  const initial = target;
  const initialKey = initial ? `${initial.kind}:${initial.id}` : '';
  const [tabs, setTabs] = useState<CitationTab[]>(() => initial ? [{ key: initialKey, target: initial }] : []);
  const [activeKey, setActiveKey] = useState(initialKey);
  useEffect(() => { if (!initial) return; setTabs([{ key: initialKey, target: initial }]); setActiveKey(initialKey); }, [initialKey]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  const active = useMemo(() => tabs.find((tab) => tab.key === activeKey), [activeKey, tabs]);
  if (!initial) return null;
  const openTarget = (next: ServerCitationTarget) => { const key = `${next.kind}:${next.id}`; setTabs((current) => current.some((tab) => tab.key === key) ? current : [...current, { key, target: next }]); setActiveKey(key); };
  const closeTab = (key: string) => { const index = tabs.findIndex((tab) => tab.key === key); const remaining = tabs.filter((tab) => tab.key !== key); if (!remaining.length) { onClose(); return; } setTabs(remaining); if (key === activeKey) setActiveKey(remaining[Math.min(index, remaining.length - 1)].key); };
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-2 backdrop-blur-[2px] sm:p-4" onClick={onClose} data-testid="server-citation-backdrop"><div role="dialog" aria-modal="true" aria-label="Fuentes y contexto" data-testid="server-citation-modal" className="flex h-[min(94vh,1100px)] max-h-[94vh] min-h-0 w-full max-w-[92rem] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-950" onClick={(event) => event.stopPropagation()}>
    <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"><Icon name="bookOpen" size={16} /></span><div className="min-w-0"><h2 className="text-sm font-semibold">Fuentes y contexto</h2><p className="text-[10px] text-neutral-500">Explora las relaciones sin salir del informe</p></div><span className="ml-auto hidden text-[10px] text-neutral-500 sm:block">{tabs.length} pestañas abiertas</span><button data-testid="server-citation-close" className="btn btn-ghost h-8 w-8 p-0" onClick={onClose} aria-label="Cerrar" title="Cerrar"><Icon name="x" size={15} /></button></header>
    <div className="flex shrink-0 overflow-x-auto border-b border-neutral-200 dark:border-neutral-800" role="tablist" aria-label="Fuentes abiertas" data-testid="server-citation-tabs">{tabs.map((tab) => <div key={tab.key} className={`flex h-10 shrink-0 items-center border-r border-neutral-200 dark:border-neutral-800 ${tab.key === activeKey ? 'bg-indigo-50 dark:bg-indigo-950/30' : ''}`}><button role="tab" aria-selected={tab.key === activeKey} data-testid={`server-citation-tab-${tab.key}`} className="max-w-64 truncate px-3 text-xs" onClick={() => setActiveKey(tab.key)}>{tab.target.label}</button><button className="grid h-6 w-6 place-items-center rounded text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => closeTab(tab.key)} aria-label={`Cerrar ${tab.target.label}`}><Icon name="x" size={11} /></button></div>)}</div>
    <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" data-testid="server-citation-content">{active && <div className="mx-auto max-w-6xl"><CitationPanel spaceId={spaceId} target={active.target} onOpen={openTarget} /></div>}</main>
  </div></div>;
}
