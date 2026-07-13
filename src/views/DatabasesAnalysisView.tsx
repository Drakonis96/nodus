import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, Spinner } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { BarList } from '../components/DatabaseChart';
import { AnalysisResultCard, ColumnSelect } from '../components/DatabaseCharts';
import { t, tx } from '../i18n';
import { columnTypeDef } from '@shared/databases';
import { applicableKinds, columnRoles, kindMeta } from '@shared/analysisCatalog';
import type { AnalysisKind, AnalysisRequest, AnalysisResult, AnalysisSuggestion, ColumnProfile, DatabaseProfile, DatabaseSummary } from '@shared/types';

function StatCard({ col }: { col: ColumnProfile }) {
  const def = columnTypeDef(col.type);
  const metric = (): string => {
    if (col.number) return tx('media {n}', { n: col.number.mean });
    if (col.distribution) return tx('{n} valores', { n: col.distribution.length });
    if (col.checkbox) return tx('{n} marcadas', { n: col.checkbox.checked });
    if (col.dateRange) return `${col.dateRange.min} → ${col.dateRange.max}`;
    if (col.relationLinks != null) return tx('{n} enlaces', { n: col.relationLinks });
    if (col.distinct != null) return tx('{n} distintos', { n: col.distinct });
    return '';
  };
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Icon name={def.icon} size={13} className="opacity-60" />
        <span className="truncate">{col.name}</span>
      </div>
      <div className="text-xs text-neutral-500 mt-1">{tx('Relleno {p}%', { p: Math.round(col.fillRate * 100) })}</div>
      <div className="text-xs text-neutral-400 mt-0.5">{metric()}</div>
    </div>
  );
}

function ChartCard({ col }: { col: ColumnProfile }) {
  let items: { label: string; count: number; color?: string | null }[] | null = null;
  if (col.distribution && col.distribution.length) items = col.distribution.map((d) => ({ label: d.label, count: d.count, color: d.color }));
  else if (col.number) items = col.number.histogram.map((h) => ({ label: h.label, count: h.count }));
  else if (col.checkbox)
    items = [
      { label: t('Marcado'), count: col.checkbox.checked, color: '#10b981' },
      { label: t('Sin marcar'), count: col.checkbox.unchecked, color: '#6b7280' },
    ];
  if (!items) return null;
  return (
    <div className="card p-4">
      <div className="text-sm font-medium mb-2">{col.name}</div>
      <BarList items={items} />
    </div>
  );
}

/** Runs one analysis on demand (or on mount) and renders it, with an optional AI reading. */
function AnalysisRunner({
  dbId,
  request,
  title,
  icon,
  rationale,
  autoRun,
}: {
  dbId: string;
  request: AnalysisRequest;
  title: string;
  icon?: string;
  rationale?: string;
  autoRun?: boolean;
}) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await window.nodus.runDatabaseAnalysis(dbId, request);
      setResult(res.result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [dbId, request]);

  useEffect(() => {
    if (autoRun) void run();
  }, [autoRun, run]);

  const explain = async () => {
    if (!result) return;
    setExplaining(true);
    try {
      setNarrative(await window.nodus.narrateDatabaseAnalysis(result));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExplaining(false);
    }
  };

  if (result) return <AnalysisResultCard title={title} icon={icon} result={result} onExplain={explain} narrative={narrative} explaining={explaining} />;

  return (
    <div className="card p-4">
      <div className="flex items-start gap-2">
        {icon && <Icon name={icon} size={16} className="text-indigo-400 mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{title}</div>
          {rationale && <p className="text-xs text-neutral-500 mt-0.5">{rationale}</p>}
        </div>
        <button className="btn btn-primary gap-1.5 shrink-0" onClick={() => void run()} disabled={running}>
          <Icon name={running ? 'sync' : 'play'} size={13} className={running ? 'animate-spin' : ''} />
          {running ? t('Calculando…') : t('Ejecutar')}
        </button>
      </div>
      {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
    </div>
  );
}

/** Manual analysis builder: pick a kind, then columns constrained to eligible roles. */
function ManualBuilder({ dbId, profile }: { dbId: string; profile: DatabaseProfile }) {
  const roles = useMemo(() => columnRoles(profile), [profile]);
  const kinds = useMemo(() => applicableKinds(profile), [profile]);
  const [kind, setKind] = useState<AnalysisKind | ''>(kinds[0] ?? '');
  const [sel, setSel] = useState<string[][]>([]);
  const [aggregate, setAggregate] = useState<'count' | 'mean' | 'sum'>('mean');
  const [bucket, setBucket] = useState<'day' | 'month' | 'year'>('month');
  const [metric, setMetric] = useState<'count' | 'mean' | 'sum'>('mean');
  const [built, setBuilt] = useState<{ request: AnalysisRequest; title: string; icon: string; key: number }[]>([]);

  const meta = kind ? kindMeta(kind) : null;

  const reset = (k: AnalysisKind | '') => {
    setKind(k);
    setSel([]);
    setAggregate('mean');
    setBucket('month');
    setMetric('mean');
  };

  const setSlot = (i: number, next: string[]) =>
    setSel((cur) => {
      const copy = [...cur];
      copy[i] = next;
      return copy;
    });

  const slotVal = (i: number): string[] => sel[i] ?? [];

  const canAdd =
    !!meta &&
    meta.slots.every((slot, i) => {
      if (slot.optional) return true;
      if (slot.multi) return slotVal(i).length >= 1;
      return slotVal(i).length === 1;
    });

  const hasCrosstabValue = kind === 'crosstab' && slotVal(2).length > 0;
  const hasSeriesValue = kind === 'time_series' && slotVal(1).length > 0;

  const add = () => {
    if (!meta || !kind) return;
    const columns = meta.slots.flatMap((_, i) => slotVal(i));
    const options: AnalysisRequest['options'] = {};
    if (kind === 'crosstab') options.aggregate = hasCrosstabValue ? aggregate : 'count';
    if (kind === 'time_series') {
      options.bucket = bucket;
      options.metric = hasSeriesValue ? metric : 'count';
    }
    setBuilt((cur) => [{ request: { kind, columns, options }, title: t(meta.label), icon: meta.icon, key: Date.now() }, ...cur]);
  };

  return (
    <section className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="construct" size={16} className="text-neutral-400" />
        <h2 className="font-semibold">{t('Análisis manual')}</h2>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          {t('Tipo')}
          <select className="input" value={kind} onChange={(e) => reset(e.target.value as AnalysisKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(kindMeta(k).label)}
              </option>
            ))}
          </select>
        </label>
        {meta?.slots.map((slot, i) => (
          <label key={i} className="flex flex-col gap-1 text-xs text-neutral-400">
            {t(slot.label)}
            <ColumnSelect
              options={roles[slot.role].map((c) => ({ id: c.id, name: c.name }))}
              value={slotVal(i)}
              onChange={(next) => setSlot(i, next)}
              multi={slot.multi}
              placeholder={slot.optional ? t('(ninguna)') : t('Elegir…')}
            />
          </label>
        ))}
        {hasCrosstabValue && (
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            {t('Agregar')}
            <select className="input" value={aggregate} onChange={(e) => setAggregate(e.target.value as 'mean' | 'sum')}>
              <option value="mean">{t('Media')}</option>
              <option value="sum">{t('Suma')}</option>
            </select>
          </label>
        )}
        {kind === 'time_series' && (
          <>
            {hasSeriesValue && (
              <label className="flex flex-col gap-1 text-xs text-neutral-400">
                {t('Métrica')}
                <select className="input" value={metric} onChange={(e) => setMetric(e.target.value as 'mean' | 'sum')}>
                  <option value="mean">{t('Media')}</option>
                  <option value="sum">{t('Suma')}</option>
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              {t('Agrupar por')}
              <select className="input" value={bucket} onChange={(e) => setBucket(e.target.value as 'day' | 'month' | 'year')}>
                <option value="day">{t('Día')}</option>
                <option value="month">{t('Mes')}</option>
                <option value="year">{t('Año')}</option>
              </select>
            </label>
          </>
        )}
        <button className="btn btn-primary gap-1.5" onClick={add} disabled={!canAdd}>
          <Icon name="plus" size={13} />
          {t('Añadir')}
        </button>
      </div>
      {built.length > 0 && (
        <div className="grid grid-cols-1 gap-3 mt-4">
          {built.map((b) => (
            <AnalysisRunner key={b.key} dbId={dbId} request={b.request} title={b.title} icon={b.icon} autoRun />
          ))}
        </div>
      )}
    </section>
  );
}

export function DatabasesAnalysisView({ initialDatabaseId }: { initialDatabaseId: string | null }) {
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [dbId, setDbId] = useState<string | null>(initialDatabaseId);
  const [data, setData] = useState<{ databaseName: string; profile: DatabaseProfile } | null>(null);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<{ report: string; profileText: string } | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [showData, setShowData] = useState(false);
  const [suggestions, setSuggestions] = useState<AnalysisSuggestion[] | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  useEffect(() => {
    void window.nodus.listDatabases().then((list) => {
      setDatabases(list);
      setDbId((cur) => cur ?? list[0]?.id ?? null);
    });
  }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setReport(null);
    setReportError(null);
    setSuggestions(null);
    setSuggestError(null);
    try {
      setData(await window.nodus.getDatabaseProfile(id));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (dbId) void load(dbId);
    else setData(null);
  }, [dbId, load]);

  const generate = async () => {
    if (!dbId) return;
    setReportBusy(true);
    setReportError(null);
    try {
      const res = await window.nodus.analyzeDatabaseReport(dbId);
      setReport({ report: res.report, profileText: res.profileText });
    } catch (e) {
      setReportError((e as Error).message);
    } finally {
      setReportBusy(false);
    }
  };

  const suggest = async () => {
    if (!dbId) return;
    setSuggestBusy(true);
    setSuggestError(null);
    try {
      const res = await window.nodus.suggestDatabaseAnalyses(dbId);
      setSuggestions(res.suggestions);
    } catch (e) {
      setSuggestError((e as Error).message);
    } finally {
      setSuggestBusy(false);
    }
  };

  const chartCols = data?.profile.columns.filter((c) => c.distribution?.length || c.number || c.checkbox) ?? [];
  const roles = data ? columnRoles(data.profile) : null;
  const matrixRequest = useMemo<AnalysisRequest>(() => ({ kind: 'correlation_matrix', columns: [] }), []);

  return (
    <div className="h-full overflow-y-auto">
     <div className="max-w-6xl mx-auto p-6">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <Icon name="chartBar" size={20} className="text-indigo-400" />
          <h1 className="text-xl font-semibold">{t('Análisis')}</h1>
        </div>
        <div className="flex-1" />
        <select className="input" value={dbId ?? ''} onChange={(e) => setDbId(e.target.value || null)}>
          {databases.length === 0 && <option value="">{t('Sin bases de datos')}</option>}
          {databases.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {loading && <Spinner label={t('Calculando…')} />}

      {!loading && data && (
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-sm text-neutral-400 mb-4">{tx('{n} filas · {c} columnas', { n: data.profile.rowCount, c: data.profile.columns.length })}</p>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {data.profile.columns.map((c) => (
                <StatCard key={c.columnId} col={c} />
              ))}
            </div>
          </div>

          {chartCols.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {chartCols.map((c) => (
                <ChartCard key={c.columnId} col={c} />
              ))}
            </div>
          )}

          {/* Correlation matrix headline (only when there are ≥2 numeric columns). */}
          {roles && roles.numeric.length >= 2 && (
            <AnalysisRunner dbId={dbId!} request={matrixRequest} title={t('Matriz de correlación')} icon="grid" autoRun />
          )}

          {/* AI-planned analyses. */}
          <section className="card p-4">
            <div className="flex items-center gap-2">
              <Icon name="wand" size={16} className="text-indigo-400" />
              <h2 className="font-semibold">{t('Análisis sugeridos por IA')}</h2>
              <div className="flex-1" />
              <button className="btn btn-primary gap-1.5" onClick={() => void suggest()} disabled={suggestBusy}>
                <Icon name={suggestBusy ? 'sync' : 'wand'} size={14} className={suggestBusy ? 'animate-spin' : ''} />
                {suggestBusy ? t('Pensando…') : suggestions ? t('Volver a sugerir') : t('Sugerir análisis')}
              </button>
            </div>
            {suggestError && <p className="text-sm text-red-400 mt-2">{suggestError}</p>}
            {!suggestions && !suggestError && (
              <p className="text-xs text-neutral-500 mt-2">
                {t('La IA revisa el perfil de tus datos y propone los análisis más reveladores. Cada uno se calcula en tu equipo con cifras reales.')}
              </p>
            )}
            {suggestions && suggestions.length === 0 && <p className="text-sm text-neutral-500 mt-2">{t('No hay sugerencias para esta base de datos.')}</p>}
            {suggestions && suggestions.length > 0 && (
              <div className="grid grid-cols-1 gap-3 mt-4">
                {suggestions.map((s, i) => (
                  <AnalysisRunner
                    key={`${s.kind}-${s.columns.join('-')}-${i}`}
                    dbId={dbId!}
                    request={{ kind: s.kind, columns: s.columns, options: s.options }}
                    title={s.title}
                    icon={kindMeta(s.kind).icon}
                    rationale={s.rationale}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Manual builder. */}
          <ManualBuilder dbId={dbId!} profile={data.profile} />

          {/* AI narrative report over the univariate profile. */}
          <section className="card p-4">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">{t('Informe con IA')}</h2>
              <div className="flex-1" />
              <button className="btn btn-primary gap-1.5" onClick={() => void generate()} disabled={reportBusy}>
                <Icon name={reportBusy ? 'sync' : 'wand'} size={14} className={reportBusy ? 'animate-spin' : ''} />
                {reportBusy ? t('Generando…') : report ? t('Regenerar') : t('Generar informe')}
              </button>
            </div>
            {reportError && <p className="text-sm text-red-400 mt-2">{reportError}</p>}
            {report && (
              <div className="mt-3">
                <Markdown content={report.report} className="text-sm" />
                <button className="text-xs text-neutral-500 hover:text-neutral-300 mt-3" onClick={() => setShowData((v) => !v)}>
                  {showData ? t('Ocultar datos usados') : t('Ver datos usados')}
                </button>
                {showData && (
                  <pre className="text-[11px] text-neutral-500 whitespace-pre-wrap mt-2 p-2 rounded bg-neutral-900/60 border border-neutral-800">
                    {report.profileText}
                  </pre>
                )}
              </div>
            )}
            {!report && !reportError && (
              <p className="text-xs text-neutral-500 mt-2">
                {t('El informe se escribe sobre las estadísticas de arriba (no sobre las filas en bruto), así que siempre cita cifras reales.')}
              </p>
            )}
          </section>
        </div>
      )}
     </div>
    </div>
  );
}
