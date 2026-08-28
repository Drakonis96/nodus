import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { JsonRecord } from './types';
import { Icon, Spinner } from '../components/ui';
import { BarList } from '../components/DatabaseChart';
import { AnalysisResultCard, ColumnSelect } from '../components/DatabaseCharts';
import { computeDatabaseAnalysis } from '@shared/databaseAnalysisEngine';
import type { AnalysisKind, AnalysisRequest, AnalysisResult } from '@shared/analysisSpec';
import { applicableKinds, columnRoles, kindMeta, validateRequest } from '@shared/analysisCatalog';
import { computeProfile, type DatabaseProfile, type ColumnProfile } from '@shared/dataProfile';
import type { DatabaseColumn, DatabaseColumnType, DatabaseRow } from '@shared/databases';
import { t } from './i18nShim';

type PublishedAnalysis = { database: JsonRecord; columns: DatabaseColumn[]; rows: DatabaseRow[]; views?: JsonRecord[]; total?: number };

function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

/** Decode only the public projection; no local object is written or amended. */
function decodePublished(payload: JsonRecord): PublishedAnalysis {
  const columns = (Array.isArray(payload.columns) ? payload.columns : []).map((raw) => {
    const c = object(raw);
    return {
      id: String(c.id ?? ''), databaseId: String(c.databaseId ?? c.database_id ?? ''), name: String(c.name ?? 'Columna'),
      type: String(c.type ?? 'text') as DatabaseColumnType, position: Number(c.position) || 0,
      config: object(c.config), options: (Array.isArray(c.options) ? c.options : []).map((option) => {
        const o = object(option); return { id: String(o.id ?? ''), label: String(o.label ?? o.name ?? ''), color: o.color == null ? null : String(o.color), position: Number(o.position) || 0, group: o.group == null ? null : (String(o.group) as 'pending' | 'in_progress' | 'complete') };
      }),
    } as DatabaseColumn;
  }).filter((column) => column.id);
  const rows = (Array.isArray(payload.rows) ? payload.rows : []).map((raw) => {
    const r = object(raw);
    const cells = Object.fromEntries(Object.entries(object(r.cells)).map(([key, value]) => [key, value == null ? null : String(value)]));
    return {
      id: String(r.id ?? ''), databaseId: String(r.databaseId ?? r.database_id ?? ''), position: Number(r.position) || 0, cells,
      attachments: object(r.attachments), relationCounts: Object.fromEntries(Object.entries(object(r.relationCounts)).map(([key, value]) => [key, Number(value) || 0])),
      createdAt: String(r.createdAt ?? r.created_at ?? ''), updatedAt: String(r.updatedAt ?? r.updated_at ?? ''),
      revision: Number(r.revision) || undefined, createdBy: r.createdBy == null ? undefined : String(r.createdBy), updatedBy: r.updatedBy == null ? undefined : String(r.updatedBy), uniqueSequence: Number(r.uniqueSequence) || undefined,
    } as DatabaseRow;
  }).filter((row) => row.id);
  return { database: object(payload.database), columns, rows, views: Array.isArray(payload.views) ? payload.views.filter((v): v is JsonRecord => Boolean(v && typeof v === 'object' && !Array.isArray(v))) : [], total: Number(payload.total) || rows.length };
}

function profileStat(profile: ColumnProfile): string {
  if (profile.number) return `n=${profile.number.count} · media ${profile.number.mean} · mediana ${profile.number.median}`;
  if (profile.distribution) return `${profile.distribution.length} valores · ${profile.distribution.slice(0, 3).map((item) => `${item.label} (${item.count})`).join(', ')}`;
  if (profile.checkbox) return `${profile.checkbox.checked} marcadas · ${profile.checkbox.unchecked} sin marcar`;
  if (profile.dateRange) return `${profile.dateRange.min} → ${profile.dateRange.max}`;
  if (profile.relationLinks != null) return `${profile.relationLinks} enlaces`;
  return profile.distinct == null ? '' : `${profile.distinct} distintos`;
}

function ProfileCard({ column }: { column: ColumnProfile }) {
  return <article className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/35" data-testid="published-analysis-profile-card"><div className="flex items-center gap-2 text-sm font-medium"><Icon name="chartBar" size={13} className="text-[#b30333]" /><span className="truncate">{column.name}</span></div><div className="mt-1 text-xs text-neutral-500">{t('Relleno')} {Math.round(column.fillRate * 100)}%</div>{profileStat(column) && <div className="mt-0.5 text-xs text-neutral-400">{profileStat(column)}</div>}{column.distribution && <div className="mt-2"><BarList items={column.distribution.map((item) => ({ label: item.label, count: item.count, color: item.color }))} /></div>}{column.number && <div className="mt-2"><BarList items={column.number.histogram} /></div>}</article>;
}

function Constructor({ profile, columns, rows }: { profile: DatabaseProfile; columns: DatabaseColumn[]; rows: DatabaseRow[] }) {
  const kinds = useMemo(() => applicableKinds(profile), [profile]);
  const roles = useMemo(() => columnRoles(profile), [profile]);
  const [kind, setKind] = useState<AnalysisKind | ''>(kinds[0] ?? '');
  const [selected, setSelected] = useState<string[][]>([]);
  const [aggregate, setAggregate] = useState<'count' | 'mean' | 'sum'>('mean');
  const [metric, setMetric] = useState<'count' | 'mean' | 'sum'>('mean');
  const [bucket, setBucket] = useState<'day' | 'month' | 'year'>('month');
  const [results, setResults] = useState<Array<{ key: number; title: string; icon: string; result: AnalysisResult }>>([]);
  const [error, setError] = useState<string | null>(null);
  const meta = kind ? kindMeta(kind) : null;
  useEffect(() => {
    if (!kind || !kinds.includes(kind)) { setKind(kinds[0] ?? ''); setSelected([]); setResults([]); }
  }, [kind, kinds]);
  const slot = (index: number) => selected[index] ?? [];
  const reset = (next: AnalysisKind) => { setKind(next); setSelected([]); setError(null); };
  const add = () => {
    if (!meta || !kind) return;
    const request: AnalysisRequest = { kind, columns: meta.slots.flatMap((_, index) => slot(index)), options: { aggregate, metric, bucket } };
    const checked = validateRequest(request, profile);
    if (!checked.ok || !checked.normalized) { setError(checked.error ?? t('Solicitud no válida.')); return; }
    try {
      const result = computeDatabaseAnalysis(columns, rows, checked.normalized);
      setResults((current) => [{ key: Date.now(), title: meta.label, icon: meta.icon, result }, ...current]);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const canAdd = Boolean(meta && meta.slots.every((s, index) => s.optional || slot(index).length >= 1));
  return <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/35" data-testid="published-analysis-constructor"><div className="flex items-center gap-2"><Icon name="tools" size={16} className="text-[#b30333]" /><h2 className="font-semibold">{t('Constructor de análisis')}</h2><span className="ml-auto text-xs text-neutral-500">{t('Solo datos publicados')}</span></div>{kinds.length === 0 ? <p className="mt-3 text-sm text-neutral-500">{t('No hay análisis aplicables a esta base de datos publicada.')}</p> : <><div className="mt-3 flex flex-wrap items-end gap-3"><label className="flex flex-col gap-1 text-xs text-neutral-500">{t('Tipo')}<select className="input" value={kind} onChange={(event) => reset(event.target.value as AnalysisKind)}>{kinds.map((item) => <option key={item} value={item}>{kindMeta(item).label}</option>)}</select></label>{meta?.slots.map((slotDefinition, index) => <label key={`${kind}-${index}`} className="flex flex-col gap-1 text-xs text-neutral-500">{t(slotDefinition.label)}<ColumnSelect options={roles[slotDefinition.role].map((column) => ({ id: column.id, name: column.name }))} value={slot(index)} onChange={(next) => setSelected((current) => { const copy = [...current]; copy[index] = next; return copy; })} multi={slotDefinition.multi} placeholder={slotDefinition.optional ? `(${t('ninguna')})` : t('Elegir…')} /></label>)}{(kind === 'crosstab' || kind === 'time_series') && <label className="flex flex-col gap-1 text-xs text-neutral-500">{t(kind === 'crosstab' ? 'Agregar' : 'Métrica')}<select className="input" value={kind === 'crosstab' ? aggregate : metric} onChange={(event) => kind === 'crosstab' ? setAggregate(event.target.value as 'count' | 'mean' | 'sum') : setMetric(event.target.value as 'count' | 'mean' | 'sum')}><option value="count">{t('Recuento')}</option><option value="mean">{t('Media')}</option><option value="sum">{t('Suma')}</option></select></label>}{kind === 'time_series' && <label className="flex flex-col gap-1 text-xs text-neutral-500">{t('Agrupar por')}<select className="input" value={bucket} onChange={(event) => setBucket(event.target.value as 'day' | 'month' | 'year')}><option value="day">{t('Día')}</option><option value="month">{t('Mes')}</option><option value="year">{t('Año')}</option></select></label>}<button className="btn btn-primary" onClick={add} disabled={!canAdd}>{t('Añadir análisis')}</button></div>{error && <p className="mt-2 text-sm text-red-600 dark:text-red-300" role="alert">{error}</p>}<div className="mt-4 grid gap-3">{results.map((item) => <AnalysisResultCard key={item.key} title={item.title} icon={item.icon} result={item.result} />)}</div></>}</section>;
}

export function DatabaseAnalysisServerView({ spaceId }: { spaceId: string }) {
  const [databases, setDatabases] = useState<JsonRecord[]>([]);
  const [databaseId, setDatabaseId] = useState<string>('');
  const [payload, setPayload] = useState<PublishedAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let alive = true; api.collection(spaceId, 'databases', { limit: '200' }).then((response) => { const values = Array.isArray(response.databases) ? response.databases as JsonRecord[] : Array.isArray(response.items) ? response.items : []; if (alive) { setDatabases(values); setDatabaseId((current) => current || String(values[0]?.id ?? '')); } }).catch((cause) => alive && setError(cause instanceof Error ? cause.message : String(cause))).finally(() => alive && setLoading(false)); return () => { alive = false; }; }, [spaceId]);
  useEffect(() => { if (!databaseId) { setPayload(null); return; } let alive = true; setLoading(true); setError(null); api.databaseAnalysis(spaceId, databaseId).then((response) => alive && setPayload(decodePublished(response))).catch((cause) => alive && setError(cause instanceof Error ? cause.message : String(cause))).finally(() => alive && setLoading(false)); return () => { alive = false; }; }, [spaceId, databaseId]);
  const profile = useMemo(() => payload ? computeProfile(payload.columns, payload.rows) : null, [payload]);
  const name = String(payload?.database.name ?? payload?.database.title ?? 'Base de datos');
  return <div className="h-full overflow-y-auto" data-testid="published-database-analysis"><div className="mx-auto max-w-6xl p-5"><header className="flex flex-wrap items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#b30333]/15 text-[#b30333]"><Icon name="chartBar" size={18} /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[#b30333]">{t('Análisis publicado')}</p><h1 className="text-xl font-semibold">{t('Análisis de bases de datos')}</h1></div><select className="input ml-auto" value={databaseId} onChange={(event) => setDatabaseId(event.target.value)}>{databases.length === 0 && <option value="">{t('Sin bases de datos')}</option>}{databases.map((database) => <option key={String(database.id)} value={String(database.id)}>{String(database.name ?? database.title ?? database.id)}</option>)}</select></header>{loading && <div className="mt-5"><Spinner label={t('Cargando datos publicados…')} /></div>}{error && <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">{error}</p>}{!loading && !error && profile && payload && <div className="mt-5 space-y-5"><div><h2 className="text-lg font-semibold">{name}</h2><p className="mt-1 text-sm text-neutral-500">{profile.rowCount} {t('filas')} · {profile.columns.length} {t('columnas')} · {payload.views?.length ?? 0} {t('vistas publicadas')}</p></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{profile.columns.map((column) => <ProfileCard key={column.columnId} column={column} />)}</div><Constructor profile={profile} columns={payload.columns} rows={payload.rows} />{payload.views && payload.views.length > 0 && <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/35" data-testid="published-analysis-views"><h2 className="font-semibold">{t('Vistas publicadas')}</h2><div className="mt-2 grid gap-2 sm:grid-cols-2">{payload.views.map((view, index) => <div key={String(view.id ?? index)} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"><strong>{String(view.name ?? t('Vista'))}</strong><span className="ml-2 text-xs text-neutral-500">{String(view.layout ?? 'table')}</span></div>)}</div></section>}</div>}</div></div>;
}

export default DatabaseAnalysisServerView;
