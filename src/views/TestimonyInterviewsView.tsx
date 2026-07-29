import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TestimonyInterviewFilters,
  TestimonyInterviewRow,
  TestimonyInterviewSort,
} from '@shared/types';
import { DEFAULT_INTERVIEW_VIEWS, INTERVIEW_WORKFLOW_STATUSES, ACCESS_LEVELS, AGREEMENT_STATUSES } from '@shared/testimonies';
import { ACCESS_LEVEL_LABEL, AGREEMENT_STATUS_LABEL, WORKFLOW_STATUS_LABEL } from '@shared/testimonyLabels';
import { Icon } from '../components/ui';
import { useDataRefresh } from '../hooks';
import { InterviewTable } from '../components/testimonies/InterviewTable';
import { NewInterviewModal } from '../components/testimonies/NewInterviewModal';
import { InterviewDossier, type DossierTab } from '../components/testimonies/InterviewDossier';
import { t, tx } from '../i18n';

/**
 * Entrevistas: la lista y su dossier.
 *
 * LAS SIETE VISTAS GUARDADAS son las siete preguntas que un investigador de historia oral
 * se hace al abrir el proyecto («¿qué tengo pendiente de transcribir?», «¿qué espera al
 * narrador?»). Vienen de fábrica y no son configurables el primer día a propósito: un
 * vault que llega con una lista vacía y un botón de «filtrar» no enseña qué estados
 * existen ni por qué son distintos.
 *
 * El dossier sustituye a la tabla en lugar de abrirse encima, porque el trabajo con audio
 * necesita todo el ancho y aperturas largas.
 */
export function TestimonyInterviewsView({
  target,
}: {
  /** Apertura profunda desde Buscar, Contrastes o un enlace `nodus://`. */
  target?: { interviewId: string; tab?: DossierTab; nonce: number } | null;
}) {
  const [rows, setRows] = useState<TestimonyInterviewRow[]>([]);
  const [viewId, setViewId] = useState('all');
  const [extra, setExtra] = useState<TestimonyInterviewFilters>({});
  const [sort, setSort] = useState<TestimonyInterviewSort>('updated');
  const [search, setSearch] = useState('');
  const [facets, setFacets] = useState<{ collections: string[]; languages: string[] }>({ collections: [], languages: [] });
  const [openId, setOpenId] = useState<string | null>(null);
  const [openTab, setOpenTab] = useState<DossierTab>('overview');
  const [creating, setCreating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);

  const savedView = useMemo(
    () => DEFAULT_INTERVIEW_VIEWS.find((view) => view.id === viewId) ?? DEFAULT_INTERVIEW_VIEWS[0],
    [viewId],
  );

  const filters = useMemo<TestimonyInterviewFilters>(
    () => ({ ...savedView.filters, ...extra, search: search.trim() || undefined }),
    [savedView, extra, search],
  );

  const reload = useCallback(async () => {
    const next = await window.nodus.listTestimonyInterviews({ filters, sort });
    setRows(next);
    setLoading(false);
  }, [filters, sort]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    void window.nodus.testimonyInterviewFacets().then(setFacets);
  }, []);
  useDataRefresh(reload);

  useEffect(() => {
    setSort(savedView.sort);
  }, [savedView]);

  useEffect(() => {
    if (!target) return;
    setOpenId(target.interviewId);
    setOpenTab(target.tab ?? 'overview');
  }, [target]);

  if (openId) {
    return (
      <InterviewDossier
        interviewId={openId}
        initialTab={openTab}
        onClose={() => { setOpenId(null); void reload(); }}
        onDeleted={() => { setOpenId(null); void reload(); }}
      />
    );
  }

  const toggleIn = <K extends 'workflowStatus' | 'accessLevel' | 'agreementStatus'>(key: K, value: string): void => {
    const current = (extra[key] ?? []) as string[];
    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
    setExtra({ ...extra, [key]: next.length ? next : undefined } as TestimonyInterviewFilters);
  };

  const activeFilterCount = Object.entries(extra).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value)).length;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="testimony-interviews">
      <header className="border-b border-neutral-200 px-6 pb-3 pt-4 dark:border-neutral-800">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">{t('Entrevistas')}</h1>
          <span className="text-xs text-neutral-500">{tx('{n} entrevistas', { n: rows.length })}</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Icon name="search" size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                className="input input-with-leading-icon w-52"
                placeholder={t('Buscar por título o código…')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button
              className={`btn btn-ghost ${activeFilterCount > 0 ? 'text-indigo-400' : ''}`}
              onClick={() => setShowFilters((open) => !open)}
              data-testid="testimony-toggle-filters"
            >
              <Icon name="columns" /> {t('Filtros')}
              {activeFilterCount > 0 && <span className="ml-1 rounded-full bg-indigo-600 px-1.5 text-[10px] text-white">{activeFilterCount}</span>}
            </button>
            <button className="btn btn-primary" data-testid="testimony-new-interview" onClick={() => setCreating(true)}>
              <Icon name="plus" /> {t('Nueva entrevista')}
            </button>
          </div>
        </div>

        <nav className="mt-3 flex flex-wrap gap-1" aria-label={t('Vistas guardadas')}>
          {DEFAULT_INTERVIEW_VIEWS.map((view) => (
            <button
              key={view.id}
              data-testid={`testimony-view-${view.id}`}
              onClick={() => { setViewId(view.id); setExtra({}); }}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                viewId === view.id
                  ? 'bg-indigo-600 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
              }`}
            >
              {t(view.label)}
            </button>
          ))}
        </nav>

        {showFilters && (
          <div className="mt-3 grid gap-3 rounded-xl border border-neutral-200 p-3 text-xs dark:border-neutral-800 lg:grid-cols-4" data-testid="testimony-filters">
            <FilterGroup label="Flujo">
              {INTERVIEW_WORKFLOW_STATUSES.map((status) => (
                <FilterChip
                  key={status}
                  label={t(WORKFLOW_STATUS_LABEL[status])}
                  active={(extra.workflowStatus ?? []).includes(status)}
                  onClick={() => toggleIn('workflowStatus', status)}
                />
              ))}
            </FilterGroup>
            <FilterGroup label="Acceso">
              {ACCESS_LEVELS.map((level) => (
                <FilterChip
                  key={level}
                  label={t(ACCESS_LEVEL_LABEL[level])}
                  active={(extra.accessLevel ?? []).includes(level)}
                  onClick={() => toggleIn('accessLevel', level)}
                />
              ))}
            </FilterGroup>
            <FilterGroup label="Acuerdo">
              {AGREEMENT_STATUSES.map((status) => (
                <FilterChip
                  key={status}
                  label={t(AGREEMENT_STATUS_LABEL[status])}
                  active={(extra.agreementStatus ?? []).includes(status)}
                  onClick={() => toggleIn('agreementStatus', status)}
                />
              ))}
            </FilterGroup>
            <div className="space-y-2">
              <label className="flex flex-col gap-1">
                <span className="font-medium text-neutral-600 dark:text-neutral-400">{t('Colección')}</span>
                <select
                  className="input w-full"
                  value={extra.collectionLabel ?? ''}
                  onChange={(event) => setExtra({ ...extra, collectionLabel: event.target.value || undefined })}
                >
                  <option value="">{t('Todas')}</option>
                  {facets.collections.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium text-neutral-600 dark:text-neutral-400">{t('Idioma')}</span>
                <select
                  className="input w-full"
                  value={extra.language ?? ''}
                  onChange={(event) => setExtra({ ...extra, language: event.target.value || undefined })}
                >
                  <option value="">{t('Todos')}</option>
                  {facets.languages.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={Boolean(extra.includeArchived)}
                  onChange={(event) => setExtra({ ...extra, includeArchived: event.target.checked || undefined })}
                />
                {t('Incluir archivadas')}
              </label>
              {activeFilterCount > 0 && (
                <button className="btn btn-ghost w-full" onClick={() => setExtra({})}>
                  <Icon name="x" /> {t('Quitar filtros')}
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {loading ? (
          <div className="grid h-full place-items-center text-sm text-neutral-500">
            <span className="flex items-center gap-2"><Icon name="sync" className="animate-spin" /> {t('Cargando...')}</span>
          </div>
        ) : (
          <InterviewTable
            rows={rows}
            sort={sort}
            onSort={setSort}
            onOpen={(id) => { setOpenId(id); setOpenTab('overview'); }}
            emptyLabel={t(
              viewId === 'all' && !search && activeFilterCount === 0
                ? 'Todavía no hay entrevistas. Empieza creando una: el audio y el acuerdo vienen después.'
                : 'Ninguna entrevista coincide con este filtro.'
            )}
          />
        )}
      </div>

      {creating && (
        <NewInterviewModal
          onClose={() => setCreating(false)}
          onCreated={(interview) => {
            setCreating(false);
            setOpenId(interview.id);
            setOpenTab('overview');
            void reload();
          }}
        />
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium text-neutral-600 dark:text-neutral-400">{t(label)}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
        active
          ? 'border-indigo-500 bg-indigo-600 text-white'
          : 'border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400'
      }`}
    >
      {label}
    </button>
  );
}
