// The processing-log modal: every failure and every stage the extraction and indexing
// pipeline recorded, filterable, sortable, copyable and downloadable.
//
// It hangs off the "Logs" button in the queue panel and is portalled to the body at a higher
// z-index than that panel, which is what keeps the panel's own browser-overlay freeze in force
// (a native WebContentsView cannot be covered by a z-index, so freezing it is the panel's job
// and this modal simply inherits it while the panel stays open behind).
//
// Two languages meet here on purpose: the CONTROLS follow the interface language (t()), while
// the LINES follow the language chosen in the header (`pipelineLogLanguage`, English by
// default), because a log is written to be pasted into a GitHub issue.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppLanguage, AppSettings } from '@shared/types';
import type {
  PipelineLogCategory,
  PipelineLogEntry,
  PipelineLogFacets,
  PipelineLogFilter,
  PipelineLogLevel,
  PipelineLogRetention,
  PipelineLogScope,
  PipelineLogSort,
} from '@shared/pipelineLogs';
import {
  DEFAULT_PIPELINE_LOG_LIMIT,
  PIPELINE_LOG_MAX_ENTRIES_OPTIONS,
  PIPELINE_LOG_RETENTION_OPTIONS,
} from '@shared/pipelineLogs';
import { errorText, t, tx } from '../../i18n';
import { Icon } from '../ui';
import { LogMultiSelect } from './LogMultiSelect';
import { LogContextMenu, type LogContextMenuItem } from './LogContextMenu';
import {
  CATEGORY_ORDER,
  LEVEL_ORDER,
  LEVEL_PRESENTATION,
  SCOPE_LABEL,
  categoryLabel,
  entryFieldChips,
  entryIdentityChips,
  logTime,
  renderPipelineLogLine,
} from './logPresentation';
import {
  buildLogEntryJson,
  buildLogEntryText,
  buildLogsText,
  suggestedLogFileName,
} from './pipelineLogExport';

/** Mirrors the order and the labels of the language selector in Settings. */
const LOG_LANGUAGES: { value: AppLanguage; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português (Portugal)' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'it', label: 'Italiano' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'zh-CN', label: '简体中文' },
];

const RETENTION_LABEL: Record<PipelineLogRetention, string> = {
  '1d': '1 día',
  '3d': '3 días',
  '7d': '7 días',
  '10d': '10 días',
  '30d': '30 días',
  '90d': '90 días',
  forever: 'Nunca borrar',
};

interface LogsPage {
  entries: PipelineLogEntry[];
  total: number;
  facets: PipelineLogFacets;
  revision: number;
  retention: PipelineLogRetention;
  maxEntries: number;
  stats: { entries: number; oldestAt: string | null; newestAt: string | null; bytes: number };
}

const EMPTY_PAGE: LogsPage = {
  entries: [],
  total: 0,
  revision: 0,
  retention: '10d',
  maxEntries: 5_000,
  stats: { entries: 0, oldestAt: null, newestAt: null, bytes: 0 },
  facets: { total: 0, levels: [], categories: [], scopes: [], vaults: [], days: [] },
};

export function PipelineLogsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [page, setPage] = useState<LogsPage>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [limit, setLimit] = useState(DEFAULT_PIPELINE_LOG_LIMIT);
  const [sort, setSort] = useState<PipelineLogSort>('newest');
  const [search, setSearch] = useState('');
  const [levels, setLevels] = useState<PipelineLogLevel[]>([]);
  const [categories, setCategories] = useState<PipelineLogCategory[]>([]);
  const [scopes, setScopes] = useState<PipelineLogScope[]>([]);
  const [vaultIds, setVaultIds] = useState<string[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: PipelineLogEntry } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'all' | 'shown'; count: number }>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filter = useMemo<PipelineLogFilter>(() => ({
    levels: levels.length ? levels : undefined,
    categories: categories.length ? categories : undefined,
    scopes: scopes.length ? scopes : undefined,
    vaultIds: vaultIds.length ? vaultIds : undefined,
    days: days.length ? days : undefined,
    search: search.trim() || undefined,
  }), [categories, days, levels, scopes, search, vaultIds]);

  const logLanguage: AppLanguage = settings?.pipelineLogLanguage ?? 'en';
  // `filter` always carries its keys (with `undefined` values), so the empty state has to ask
  // whether anything is actually narrowing the list — otherwise a log that is simply empty
  // looks like a filter with no matches.
  const filtersActive = levels.length > 0 || categories.length > 0 || scopes.length > 0
    || vaultIds.length > 0 || days.length > 0 || search.trim().length > 0;

  const load = useCallback(async (options?: { limit?: number; sort?: PipelineLogSort; filter?: PipelineLogFilter }) => {
    const result = await window.nodus.getPipelineLogs({
      filter: options?.filter ?? filter,
      sort: options?.sort ?? sort,
      limit: options?.limit ?? limit,
    }) as LogsPage;
    setPage(result);
    return result;
  }, [filter, limit, sort]);

  useEffect(() => {
    let cancelled = false;
    // The log store is global and the window can outlive a vault switch, so the policy is
    // re-read here rather than taken from whatever App last loaded.
    void Promise.all([window.nodus.getPipelineLogs({ filter, sort, limit }), window.nodus.getSettings()])
      .then(([logs, prefs]) => {
        if (cancelled) return;
        setPage(logs as LogsPage);
        setSettings(prefs);
      })
      .catch((cause) => { if (!cancelled) setNotice(errorText(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const reload = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    void load().catch((cause) => setNotice(cause instanceof Error ? cause.message : String(cause)));
  }, [load]);

  // Any filter/sort change re-queries. Debounced because the search box is typed into.
  useEffect(() => {
    if (loading) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { reload(); }, 180);
    return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, [filter, sort, limit, loading]);

  // Live updates: grouping, pruning and deletions all change rows already on screen, so the
  // store's own revision is the signal to re-query rather than a delta to reconcile.
  useEffect(() => {
    const stop = window.nodus.onPipelineLogsChanged(() => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => { reload(); }, 400);
    });
    return stop;
  }, [reload]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The context menu captures Escape first (it is portalled above and stops propagation);
      // here, Escape closes the confirmation if it is up and the modal otherwise.
      if (event.key !== 'Escape') return;
      if (confirm) setConfirm(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, onClose]);

  const patchSettings = async (patch: Partial<AppSettings>) => {
    setBusy(true);
    try {
      const next = await window.nodus.updateSettings(patch);
      setSettings(next);
      // Retention and the cap are applied by main on the spot, so the counts come back changed.
      await load();
    } catch (cause) {
      setNotice(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label} ✓`);
    } catch {
      setNotice(t('No se pudo copiar al portapapeles.'));
    }
  };

  const save = async (text: string, fileName: string) => {
    setBusy(true);
    try {
      const result = await window.nodus.exportPipelineLogs(text, fileName);
      if (!result.canceled && result.path) setNotice(tx('Guardado en {path}', { path: result.path }));
    } catch (cause) {
      setNotice(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const deleteShown = async () => {
    setBusy(true);
    try {
      const removed = await window.nodus.deletePipelineLogs(filter);
      setConfirm(null);
      setNotice(tx('{count} entradas', { count: removed.removed }));
      setLevels([]); setCategories([]); setScopes([]); setVaultIds([]); setDays([]); setSearch('');
    } catch (cause) {
      setNotice(errorText(cause));
    } finally {
      setBusy(false);
      // The store also pushes a change, but the view refreshes here as well: a deletion the
      // reader just confirmed must not appear to have done nothing while a push is in flight.
      reload();
    }
  };

  const deleteAll = async () => {
    setBusy(true);
    try {
      await window.nodus.clearPipelineLogs();
      setConfirm(null);
    } catch (cause) {
      setNotice(errorText(cause));
    } finally {
      setBusy(false);
      reload();
    }
  };

  const deleteEntry = async (entry: PipelineLogEntry) => {
    try {
      await window.nodus.deletePipelineLogs({ ids: [entry.id] });
    } catch (cause) {
      setNotice(errorText(cause));
    }
    reload();
  };

  const copyShownText = () => buildLogsText(page.entries, {
    language: logLanguage,
    filter,
    sort,
    total: page.total,
  });

  const menuItems: LogContextMenuItem[] = menu ? [
    { id: 'copy-entry', label: t('Copiar registro'), icon: 'copy' },
    { id: 'copy-json', label: t('Copiar como JSON'), icon: 'code' },
    { id: 'download-entry', label: t('Descargar registro (.txt)'), icon: 'download' },
    { id: 'copy-shown', label: t('Copiar lo mostrado'), icon: 'copy' },
    { id: 'download-shown', label: t('Descargar lo mostrado (.txt)'), icon: 'download' },
    { id: 'delete-entry', label: t('Borrar registro'), icon: 'trash', danger: true },
  ] : [];

  const onMenuSelect = (id: string) => {
    const entry = menu?.entry;
    if (!entry) return;
    if (id === 'copy-entry') void copy(buildLogEntryText(entry, logLanguage), t('Copiar registro'));
    else if (id === 'copy-json') void copy(buildLogEntryJson(entry, logLanguage), t('Copiar como JSON'));
    else if (id === 'download-entry') void save(buildLogEntryText(entry, logLanguage), suggestedLogFileName(`-${logTime(entry.at).replace(/[:.]/g, '')}`));
    else if (id === 'copy-shown') void copy(copyShownText(), t('Copiar lo mostrado'));
    else if (id === 'download-shown') void save(copyShownText(), suggestedLogFileName());
    else if (id === 'delete-entry') void deleteEntry(entry);
  };

  const levelOptions = LEVEL_ORDER.map((level) => ({
    id: level,
    label: t(LEVEL_PRESENTATION[level].label),
    count: page.facets.levels.find((item) => item.value === level)?.count ?? 0,
  })).filter((option) => option.count > 0 || levels.includes(option.id));

  const categoryOptions = CATEGORY_ORDER.map((category) => ({
    id: category,
    label: categoryLabel(category),
    count: page.facets.categories.find((item) => item.value === category)?.count ?? 0,
  })).filter((option) => option.count > 0 || categories.includes(option.id));

  const vaultOptions = page.facets.vaults.map((vault) => ({ id: vault.id, label: vault.label, count: vault.count }));
  const dayOptions = page.facets.days.map((day) => ({ id: day.value, label: day.value, count: day.count }));
  const scopeOptions = Object.entries(SCOPE_LABEL)
    .map(([scope, label]) => ({
      id: scope,
      label: t(label as string),
      count: page.facets.scopes.find((item) => item.value === scope)?.count ?? 0,
    }))
    .filter((option) => option.count > 0 || scopes.includes(option.id as PipelineLogScope));

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60 p-4"
      style={{ zIndex: 200 }}
      data-testid="pipeline-logs-modal"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        className="card-modal flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pipeline-logs-title"
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-neutral-200 p-3 dark:border-neutral-800">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/15 text-indigo-500 dark:text-indigo-300">
            <Icon name="list" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="pipeline-logs-title" className="font-semibold" data-testid="pipeline-logs-title">
              {t('Registros de procesamiento')}
            </h2>
            <p className="text-[11px] text-neutral-500" data-testid="pipeline-logs-count">
              {tx('{count} entradas', { count: page.facets.total })}
              {page.total !== page.facets.total ? ` · ${page.total}/${page.facets.total}` : ''}
              {page.stats.bytes ? ` · ${Math.max(1, Math.round(page.stats.bytes / 1024))} KB` : ''}
            </p>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-neutral-500">
            {t('Idioma de los registros')}
            <select
              className="input h-9 w-44 text-xs"
              data-testid="pipeline-logs-language"
              value={logLanguage}
              disabled={busy || !settings}
              onChange={(event) => void patchSettings({ pipelineLogLanguage: event.target.value as AppLanguage })}
            >
              {LOG_LANGUAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button className="rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t('Cerrar')} data-testid="pipeline-logs-close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>

        <div className="grid gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800 md:grid-cols-[minmax(180px,1fr)_repeat(5,minmax(112px,146px))_auto]">
          <label className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-neutral-300 px-2 dark:border-neutral-700">
            <Icon name="search" size={13} className="text-neutral-500" />
            <input
              data-testid="pipeline-logs-search"
              className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none"
              placeholder={t('Buscar en los registros…')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <LogMultiSelect
            testId="pipeline-logs-levels"
            options={levelOptions}
            selectedIds={levels}
            onChange={(ids) => setLevels(ids as PipelineLogLevel[])}
            placeholder={t('Nivel')}
          />
          <LogMultiSelect
            testId="pipeline-logs-types"
            options={categoryOptions}
            selectedIds={categories}
            onChange={(ids) => setCategories(ids as PipelineLogCategory[])}
            placeholder={t('Tipo')}
          />
          <LogMultiSelect
            testId="pipeline-logs-scopes"
            options={scopeOptions}
            selectedIds={scopes}
            onChange={(ids) => setScopes(ids as PipelineLogScope[])}
            placeholder={t('Origen')}
          />
          <LogMultiSelect
            testId="pipeline-logs-vaults"
            options={vaultOptions}
            selectedIds={vaultIds}
            onChange={setVaultIds}
            placeholder={t('Bóveda')}
            searchPlaceholder={t('Buscar')}
          />
          <LogMultiSelect
            testId="pipeline-logs-days"
            options={dayOptions}
            selectedIds={days}
            onChange={setDays}
            placeholder={t('Día')}
            searchPlaceholder={t('Buscar')}
          />
          <button
            type="button"
            data-testid="pipeline-logs-sort"
            className="btn btn-ghost h-9 shrink-0 px-2 text-xs"
            title={t('Orden')}
            onClick={() => setSort((current) => (current === 'newest' ? 'oldest' : 'newest'))}
          >
            {sort === 'newest' ? '↓' : '↑'}
            <span className="ml-1">{sort === 'newest' ? t('Más recientes primero') : t('Más antiguas primero')}</span>
          </button>
        </div>

        <div className="min-h-64 flex-1 overflow-y-auto p-2" data-testid="pipeline-logs-list">
          {loading && <p className="px-3 py-8 text-center text-sm text-neutral-500">{t('Cargando…')}</p>}
          {!loading && page.entries.length === 0 && (
            <div className="grid min-h-56 place-items-center px-5 text-center text-sm text-neutral-500">
              <div>
                <Icon name="list" size={26} className="mx-auto mb-3 opacity-40" />
                <p className="font-medium">
                  {filtersActive ? t('Sin registros que coincidan con los filtros.') : t('Sin registros todavía. Ejecuta un análisis o una indexación.')}
                </p>
              </div>
            </div>
          )}
          {!loading && page.entries.map((entry) => (
            <LogRow
              key={entry.id}
              entry={entry}
              language={logLanguage}
              onContextMenu={(x, y) => setMenu({ x, y, entry })}
            />
          ))}
          {!loading && page.total > page.entries.length && (
            <div className="flex justify-center px-3 py-3">
              <button
                type="button"
                data-testid="pipeline-logs-more"
                className="btn btn-ghost text-xs"
                disabled={busy}
                onClick={() => setLimit((current) => current + DEFAULT_PIPELINE_LOG_LIMIT)}
              >
                {t('Mostrar más')} ({page.entries.length}/{page.total})
              </button>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-end gap-3 border-t border-neutral-200 p-3 dark:border-neutral-800">
          <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
            {t('Eliminar los registros más antiguos que')}
            <select
              className="input h-9 w-40 text-xs"
              data-testid="pipeline-logs-retention"
              value={page.retention}
              disabled={busy}
              onChange={(event) => void patchSettings({ pipelineLogRetention: event.target.value as PipelineLogRetention })}
            >
              {PIPELINE_LOG_RETENTION_OPTIONS.map((option) => (
                <option key={option} value={option}>{t(RETENTION_LABEL[option])}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
            {t('Máximo de entradas')}
            <select
              className="input h-9 w-36 text-xs"
              data-testid="pipeline-logs-max-entries"
              value={page.maxEntries}
              disabled={busy}
              onChange={(event) => void patchSettings({ pipelineLogMaxEntries: Number(event.target.value) })}
            >
              {PIPELINE_LOG_MAX_ENTRIES_OPTIONS.map((option) => (
                <option key={option} value={option}>{tx('{count} entradas', { count: option })}</option>
              ))}
            </select>
          </label>
          <p className="min-w-48 flex-1 text-[11px] text-neutral-500">{t('Los registros son locales: no se incluyen en las copias de seguridad ni se sincronizan.')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="pipeline-logs-download"
              className="btn btn-ghost text-xs"
              disabled={busy || page.entries.length === 0}
              onClick={() => void save(copyShownText(), suggestedLogFileName())}
            >
              <Icon name="download" size={12} /> {t('Descargar lo mostrado (.txt)')}
            </button>
            <button
              type="button"
              data-testid="pipeline-logs-delete-shown"
              className="btn btn-ghost text-xs"
              disabled={busy || page.total === 0}
              onClick={() => setConfirm({ kind: 'shown', count: page.total })}
            >
              <Icon name="trash" size={12} /> {t('Borrar los mostrados')}
            </button>
            <button
              type="button"
              data-testid="pipeline-logs-clear"
              className="btn btn-ghost border border-red-500/40 text-xs text-red-600 dark:text-red-300"
              disabled={busy || page.facets.total === 0}
              onClick={() => setConfirm({ kind: 'all', count: page.facets.total })}
            >
              <Icon name="trash" size={12} /> {t('Borrar todos los registros')}
            </button>
          </div>
        </footer>

        {notice && (
          <div className="border-t border-neutral-200 px-3 py-2 text-[11px] text-neutral-600 dark:border-neutral-800 dark:text-neutral-300" data-testid="pipeline-logs-notice">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 truncate">{notice}</span>
              <button type="button" className="shrink-0 text-neutral-500 hover:underline" onClick={() => setNotice(null)}>{t('Cerrar')}</button>
            </div>
          </div>
        )}

        {menu && (
          <LogContextMenu
            x={menu.x}
            y={menu.y}
            items={menuItems}
            onSelect={onMenuSelect}
            onClose={() => setMenu(null)}
          />
        )}

        {confirm && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 p-5" style={{ zIndex: 240 }}>
            <section className="card-modal w-full max-w-md p-5" role="alertdialog" aria-modal="true" data-testid="pipeline-logs-confirm">
              <h3 className="text-lg font-semibold">
                {confirm.kind === 'all' ? t('Borrar todos los registros') : t('Borrar los mostrados')}
              </h3>
              <p className="mt-2 text-sm text-neutral-500">
                {tx('Se eliminarán {count} entradas y no se podrán recuperar.', { count: confirm.count })}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>{t('Cancelar')}</button>
                <button
                  data-testid="pipeline-logs-confirm-delete"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => void (confirm.kind === 'all' ? deleteAll() : deleteShown())}
                >
                  {t('Borrar')}
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

function LogRow({
  entry,
  language,
  onContextMenu,
}: {
  entry: PipelineLogEntry;
  language: AppLanguage;
  onContextMenu: (x: number, y: number) => void;
}) {
  const level = LEVEL_PRESENTATION[entry.level];
  const identity = entryIdentityChips(entry);
  const fields = entryFieldChips(entry);
  return (
    <article
      data-testid="pipeline-log-row"
      data-level={entry.level}
      data-category={entry.category}
      className={`mb-1 rounded-md px-2 py-1.5 ${level.accent} ${level.row}`}
      onContextMenu={(event) => { event.preventDefault(); onContextMenu(event.clientX, event.clientY); }}
      title={entry.repeat > 1 && entry.firstAt ? tx('Primera vez: {at}', { at: entry.firstAt }) : entry.at}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] tabular-nums text-neutral-500">{logTime(entry.at)}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${level.badge}`}>
          {t(level.label)}
        </span>
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {categoryLabel(entry.category)}
        </span>
        {entry.code && (
          <span className="rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] text-neutral-100 dark:bg-neutral-950 dark:text-neutral-300">
            {entry.code}
          </span>
        )}
        {entry.repeat > 1 && (
          // Just the count on screen: "repeated 12 times" beside it only repeated the number.
          // The sentence lives in the tooltip, next to when the group started.
          <span
            data-testid="pipeline-log-repeat"
            title={`${tx('repetido {count} veces', { count: entry.repeat })}${entry.firstAt ? ` · ${tx('Primera vez: {at}', { at: entry.firstAt })}` : ''}`}
            className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
          >
            ×{entry.repeat}
          </span>
        )}
        {fields.map((chip) => (
          <span key={chip} className="font-mono text-[10px] text-neutral-500">{chip}</span>
        ))}
      </div>
      <p className={`mt-1 text-xs ${level.text}`} data-testid="pipeline-log-message">
        {renderPipelineLogLine(entry.message, language)}
      </p>
      {entry.detail && (
        <p className="mt-0.5 font-mono text-[10px] text-neutral-500 [overflow-wrap:anywhere]" data-testid="pipeline-log-detail">
          {entry.detail}
        </p>
      )}
      {identity.length > 0 && (
        <p className="mt-0.5 truncate text-[10px] text-neutral-500">{identity.join(' · ')}</p>
      )}
    </article>
  );
}
