import { useEffect, useMemo, useState } from 'react';
import type {
  PrimarySourcePersonAssertionField,
  PrimarySourcePersonDossier,
  PrimarySourcePersonFilter,
  PrimarySourcePersonSummary,
} from '@shared/primarySourcesTypes';
import { Icon } from '../components/ui';
import { t, tx } from '../i18n';
import { consumePrimarySourceAttention } from '../primarySourcesAttention';

const FILTERS: Array<{ value: PrimarySourcePersonFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'provisional', label: 'Provisionales' },
  { value: 'confirmed', label: 'Confirmadas' },
  { value: 'discrepant', label: 'Con discrepancias' },
];

const FIELD_LABELS: Record<PrimarySourcePersonAssertionField, string> = {
  name: 'Nombre documentado',
  birth_date: 'Nacimiento',
  death_date: 'Fallecimiento',
  sex: 'Sexo',
  occupation: 'Ocupación',
  role: 'Papel en la fuente',
  other: 'Otro dato',
};

function evidenceLabel(role: string | null): string {
  if (role === 'contradicts') return t('Contradice');
  if (role === 'contextualizes') return t('Contextualiza');
  if (role === 'mentions') return t('Menciona');
  return t('Apoya');
}

function statusLabel(status: PrimarySourcePersonSummary['identityStatus']): string {
  return status === 'provisional' ? t('Provisional') : t('Confirmada');
}

function countLabel(count: number, singular: string, plural: string): string {
  return tx(count === 1 ? singular : plural, { n: count });
}

function sourceMentionCounts(sources: number, mentions: number): string {
  return `${countLabel(sources, '{n} fuente', '{n} fuentes')} · ${countLabel(mentions, '{n} mención', '{n} menciones')}`;
}

function openExcerpt(itemId: string, excerptId: string | null): void {
  if (!excerptId) return;
  window.dispatchEvent(new CustomEvent('nodus:navigate-primary-source', {
    detail: { itemId, excerptId },
  }));
}

function EvidenceRoleBadge({ role }: { role: string | null }) {
  const contradicted = role === 'contradicts';
  return (
    <span className={[
      'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold',
      contradicted
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    ].join(' ')}>
      {evidenceLabel(role)}
    </span>
  );
}

function PersonListCard({
  person,
  selected,
  onSelect,
}: {
  person: PrimarySourcePersonSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`documentary-person-${person.personId}`}
      className={[
        'w-full rounded-xl border p-3 text-left transition',
        selected
          ? 'border-indigo-300 bg-indigo-50 shadow-sm dark:border-indigo-700 dark:bg-indigo-950/40'
          : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700 dark:hover:bg-neutral-800',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{person.displayName}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {person.variants.slice(1, 4).map((variant) => (
              <span key={`${variant.kind}:${variant.value}`} className="max-w-[11rem] truncate rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {variant.value}
              </span>
            ))}
          </div>
        </div>
        <span className={[
          'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
          person.identityStatus === 'provisional'
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
            : 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
        ].join(' ')}>
          {statusLabel(person.identityStatus)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-neutral-500 dark:text-neutral-400">
        <span>{countLabel(person.sourceCount, '{n} fuente', '{n} fuentes')}</span>
        <span>{countLabel(person.mentionCount, '{n} mención', '{n} menciones')}</span>
        <span className={person.discrepancyCount ? 'font-semibold text-rose-600 dark:text-rose-300' : ''}>
          {countLabel(person.discrepancyCount, '{n} discrepancia', '{n} discrepancias')}
        </span>
      </div>
    </button>
  );
}

export function PrimarySourcesPersonsView() {
  const [attention, setAttention] = useState(() => consumePrimarySourceAttention(['provisional_identities']));
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<PrimarySourcePersonFilter>(attention ? 'provisional' : 'all');
  const [people, setPeople] = useState<PrimarySourcePersonSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dossier, setDossier] = useState<PrimarySourcePersonDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variant, setVariant] = useState('');

  const reloadList = async (preferId?: string | null) => {
    const fetched = await window.nodus.listPrimarySourcePersons(search, filter);
    const rows = attention?.targetIds.length
      ? fetched.filter((person) => attention.targetIds.includes(person.personId))
      : fetched;
    setPeople(rows);
    setSelectedId((current) => {
      const preferred = preferId ?? current;
      return preferred && rows.some((person) => person.personId === preferred)
        ? preferred
        : rows[0]?.personId ?? null;
    });
  };

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      window.nodus.listPrimarySourcePersons(search, filter)
        .then((fetched) => {
          if (cancelled) return;
          const rows = attention?.targetIds.length
            ? fetched.filter((person) => attention.targetIds.includes(person.personId))
            : fetched;
          setPeople(rows);
          setSelectedId((current) =>
            current && rows.some((person) => person.personId === current)
              ? current
              : rows[0]?.personId ?? null
          );
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [search, filter, attention]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) {
      setDossier(null);
      return;
    }
    setError(null);
    window.nodus.getPrimarySourcePersonDossier(selectedId)
      .then((next) => {
        if (!cancelled) setDossier(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, [selectedId]);

  const assertionsByField = useMemo(() => {
    const groups = new Map<PrimarySourcePersonAssertionField, PrimarySourcePersonDossier['assertions']>();
    for (const assertion of dossier?.assertions ?? []) {
      const current = groups.get(assertion.field) ?? [];
      current.push(assertion);
      groups.set(assertion.field, current);
    }
    return [...groups.entries()];
  }, [dossier]);

  const runMutation = async (
    operation: () => Promise<PrimarySourcePersonDossier | null>,
    successMessage: string
  ) => {
    setBusy(true);
    setError(null);
    try {
      const next = await operation();
      setDossier(next);
      const preferred = next?.summary.personId ?? selectedId;
      await reloadList(preferred);
      setVariant('');
      setError(successMessage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="primary-sources-persons-view">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-neutral-200 bg-neutral-100/70 dark:border-neutral-800 dark:bg-neutral-950">
        <header className="border-b border-neutral-200 p-4 dark:border-neutral-800">
          {attention && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-[10px] text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
              <Icon name="filter" size={11} />{t(attention.label)}
              <button className="ml-auto font-medium hover:underline" onClick={() => { setAttention(null); setFilter('all'); }}>{t('Mostrar todo')}</button>
            </div>
          )}
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">{t('Índice documental')}</div>
          <h1 className="mt-1 text-lg font-semibold">{t('Personas en las fuentes')}</h1>
          <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            {t('Identidades construidas desde menciones y evidencia, sin completar datos por intuición.')}
          </p>
          <label className="mt-4 flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
            <Icon name="search" size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('Buscar nombre o variante…')}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-neutral-400"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={[
                  'rounded-full px-2.5 py-1 text-[10px] font-medium',
                  filter === option.value
                    ? 'bg-indigo-600 text-white dark:bg-indigo-400 dark:text-neutral-950'
                    : 'bg-white text-neutral-600 ring-1 ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:ring-neutral-700',
                ].join(' ')}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
        </header>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {loading && <div className="p-6 text-center text-xs text-neutral-500">{t('Cargando identidades…')}</div>}
          {!loading && people.map((person) => (
            <PersonListCard
              key={person.personId}
              person={person}
              selected={person.personId === selectedId}
              onSelect={() => setSelectedId(person.personId)}
            />
          ))}
          {!loading && people.length === 0 && (
            <div className="rounded-xl border border-dashed border-neutral-300 p-5 text-center dark:border-neutral-700">
              <Icon name="users" size={22} />
              <div className="mt-2 text-sm font-medium">{t('No hay identidades con estos filtros')}</div>
              <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                {t('Acepta menciones de persona desde un fragmento para iniciar el índice documental.')}
              </p>
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {!dossier && !loading && (
          <div className="grid min-h-full place-items-center p-8">
            <div className="max-w-md text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300"><Icon name="users" size={24} /></span>
              <h2 className="mt-4 text-lg font-semibold">{t('Dossier documental de persona')}</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">{t('Selecciona una identidad para revisar exactamente cómo aparece en cada fuente.')}</p>
            </div>
          </div>
        )}

        {dossier && (
          <div className="mx-auto max-w-6xl space-y-5 p-5 pb-12">
            <header className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-semibold tracking-tight">{dossier.summary.displayName}</h2>
                    <span className={[
                      'rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase',
                      dossier.summary.identityStatus === 'provisional'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                        : 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
                    ].join(' ')}>
                      {statusLabel(dossier.summary.identityStatus)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    {t('Dossier basado exclusivamente en apariciones documentales y decisiones revisables.')}
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    [dossier.summary.sourceCount, 'Fuentes'],
                    [dossier.summary.mentionCount, 'Menciones'],
                    [dossier.summary.evidenceCount, 'Evidencias'],
                    [dossier.summary.discrepancyCount, 'Discrepancias'],
                  ].map(([count, label]) => (
                    <div key={String(label)} className="rounded-lg bg-neutral-100 px-3 py-2 dark:bg-neutral-800">
                      <div className="text-base font-semibold">{count}</div>
                      <div className="text-[9px] uppercase tracking-wide text-neutral-500">{t(String(label))}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {dossier.summary.variants.map((name) => (
                  <span
                    key={`${name.kind}:${name.value}`}
                    title={name.kind === 'documentary_mention' ? t('Forma original conservada desde la fuente') : undefined}
                    className={[
                      'rounded-full border px-2.5 py-1 text-[10px]',
                      name.kind === 'preferred'
                        ? 'border-indigo-300 bg-indigo-50 font-semibold text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
                    ].join(' ')}
                  >
                    {name.value}{name.mentionCount > 0 ? ` · ${name.mentionCount}` : ''}
                  </span>
                ))}
              </div>
              <form
                className="mt-4 flex max-w-xl gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!variant.trim() || busy) return;
                  void runMutation(
                    () => window.nodus.addPrimarySourcePersonVariant(dossier.summary.personId, variant),
                    t('Variante añadida sin modificar las formas originales.')
                  );
                }}
              >
                <input
                  value={variant}
                  onChange={(event) => setVariant(event.target.value)}
                  placeholder={t('Añadir variante editorial…')}
                  className="input h-9 min-w-0 flex-1 text-xs"
                />
                <button className="btn btn-secondary h-9" disabled={!variant.trim() || busy}>
                  <Icon name="plus" size={13} /> {t('Añadir variante')}
                </button>
              </form>
            </header>

            {error && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
                {error}
              </div>
            )}

            <section className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold">{t('Apariciones documentales')}</h3>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('Cada forma se muestra tal como fue escrita y abre el fragmento exacto.')}</p>
                </div>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] text-neutral-500 dark:bg-neutral-800">{dossier.mentions.length}</span>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {dossier.mentions.map((mention) => (
                  <article key={mention.mentionId} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">“{mention.originalLabel}”</div>
                        <div className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                          {mention.sourceTitle}
                          {mention.referenceCode ? ` · ${mention.referenceCode}` : ''}
                          {mention.repositoryName ? ` · ${mention.repositoryName}` : ''}
                        </div>
                      </div>
                      <EvidenceRoleBadge role={mention.evidenceRole} />
                    </div>
                    {mention.quotedText && <blockquote className="mt-3 line-clamp-3 border-l-2 border-indigo-200 pl-3 text-xs italic leading-5 text-neutral-600 dark:border-indigo-800 dark:text-neutral-300">“{mention.quotedText}”</blockquote>}
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-[10px] text-neutral-500">{mention.excerptLocator ?? t('Sin fragmento estable')}</span>
                      <button
                        type="button"
                        disabled={!mention.excerptId}
                        onClick={() => openExcerpt(mention.itemId, mention.excerptId)}
                        className="btn btn-ghost h-7 shrink-0 px-2 text-[10px]"
                      >
                        <Icon name="external" size={12} /> {t('Abrir fragmento')}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <h3 className="text-sm font-semibold">{t('Datos documentados')}</h3>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('No hay una ficha rellenada por consenso: cada valor conserva su fuente, fragmento y papel probatorio.')}</p>
              <div className="mt-4 space-y-4">
                {assertionsByField.map(([field, assertions]) => (
                  <div key={field}>
                    <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{t(FIELD_LABELS[field])}</h4>
                    <div className="mt-2 grid gap-2 lg:grid-cols-2">
                      {assertions.map((assertion) => (
                        <button
                          type="button"
                          key={assertion.assertionId}
                          onClick={() => openExcerpt(assertion.itemId, assertion.excerptId)}
                          className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 p-3 text-left hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-neutral-700 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/20"
                        >
                          <div>
                            <div className="text-sm font-medium">{assertion.value}</div>
                            <div className="mt-1 text-[10px] text-neutral-500">
                              {assertion.sourceTitle}{assertion.referenceCode ? ` · ${assertion.referenceCode}` : ''} · {assertion.excerptLocator}
                            </div>
                          </div>
                          <EvidenceRoleBadge role={assertion.evidenceRole} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={[
              'rounded-2xl border p-5',
              dossier.discrepancies.length
                ? 'border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20'
                : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900',
            ].join(' ')}>
              <div className="flex items-center gap-2">
                <Icon name="alert" size={16} />
                <h3 className="text-sm font-semibold">{t('Discrepancias explícitas')}</h3>
              </div>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('Las versiones incompatibles permanecen visibles; reunir identidades no decide cuál es correcta.')}</p>
              {dossier.discrepancies.length === 0 ? (
                <p className="mt-4 rounded-lg bg-neutral-100 p-3 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{t('No se han detectado valores documentales incompatibles.')}</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {dossier.discrepancies.map((discrepancy) => (
                    <div key={discrepancy.field} className="rounded-xl border border-rose-200 bg-white p-4 dark:border-rose-900 dark:bg-neutral-900">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">{t(FIELD_LABELS[discrepancy.field])}</div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {discrepancy.alternatives.map((alternative) => (
                          <div key={normalizedAlternativeKey(alternative.value)} className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800">
                            <div className="text-sm font-semibold">{alternative.value}</div>
                            <div className="mt-2 space-y-1">
                              {alternative.assertions.map((assertion) => (
                                <button
                                  type="button"
                                  key={assertion.assertionId}
                                  onClick={() => openExcerpt(assertion.itemId, assertion.excerptId)}
                                  className="block w-full truncate text-left text-[10px] text-indigo-600 hover:underline dark:text-indigo-300"
                                >
                                  {assertion.sourceTitle} · {assertion.excerptLocator}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <h3 className="text-sm font-semibold">{t('Identidad reunida, historial intacto')}</h3>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('La persona preferida agrupa registros independientes. Ninguno se elimina y toda fusión puede revertirse.')}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {dossier.identityMembers.map((member) => (
                  <div key={member.personId} className={[
                    'rounded-xl border p-3',
                    member.isPreferred
                      ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/30'
                      : 'border-neutral-200 dark:border-neutral-700',
                  ].join(' ')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{member.displayName}</span>
                      {member.isPreferred && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[9px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">{t('Preferida')}</span>}
                    </div>
                    <div className="mt-2 text-[10px] text-neutral-500">{sourceMentionCounts(member.sourceCount, member.mentionCount)}</div>
                  </div>
                ))}
              </div>
              {dossier.resolutions.some((resolution) => resolution.status === 'active') && (
                <div className="mt-4 space-y-2">
                  {dossier.resolutions.filter((resolution) => resolution.status === 'active').map((resolution) => (
                    <div key={resolution.resolutionId} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{t('Fusión documental activa')}</div>
                        <div className="truncate text-[10px] text-neutral-500">{resolution.rationale}</div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runMutation(
                          () => window.nodus.revertPrimarySourcePersonMerge(resolution.resolutionId),
                          t('Fusión revertida: las identidades vuelven a estar separadas sin pérdida de datos.')
                        )}
                        className="btn btn-secondary h-8 shrink-0 text-[10px]"
                      >
                        <Icon name="undo" size={12} /> {t('Revertir fusión')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <h3 className="text-sm font-semibold">{t('Comparar identidades posibles')}</h3>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('Las coincidencias son sugerencias conservadoras. Solo una decisión humana reúne los dossiers.')}</p>
              {dossier.candidates.length === 0 ? (
                <p className="mt-4 rounded-lg bg-neutral-100 p-3 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{t('No hay otras identidades con nombres y fechas compatibles.')}</p>
              ) : (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {dossier.candidates.map((candidate) => (
                    <article key={candidate.personId} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{candidate.displayName}</div>
                          <div className="mt-1 text-[10px] text-neutral-500">{sourceMentionCounts(candidate.sourceCount, candidate.mentionCount)}</div>
                        </div>
                        <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-semibold dark:bg-neutral-800">{Math.round(candidate.score * 100)}%</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {candidate.variants.slice(0, 5).map((name) => <span key={name} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{name}</span>)}
                      </div>
                      <div className="mt-3 text-[10px] text-neutral-500">{candidate.reasons.map((reason) => t(reasonLabel(reason))).join(' · ')}</div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runMutation(
                          () => window.nodus.mergePrimarySourcePersons({
                            sourcePersonId: candidate.personId,
                            targetPersonId: dossier.summary.personId,
                            rationale: t('Reunidas tras comparar nombres, fechas y fragmentos documentales.'),
                          }),
                          t('Identidades reunidas de forma reversible; las menciones originales siguen intactas.')
                        )}
                        className="btn btn-primary mt-4 h-8 w-full text-[10px]"
                      >
                        <Icon name="link" size={12} /> {t('Reunir en esta identidad')}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function reasonLabel(reason: PrimarySourcePersonDossier['candidates'][number]['reasons'][number]): string {
  if (reason === 'same_name') return 'Mismo nombre';
  if (reason === 'similar_name') return 'Nombre similar';
  if (reason === 'shared_variant') return 'Variante compartida';
  if (reason === 'compatible_dates') return 'Fechas compatibles';
  return 'Fuente compartida';
}

function normalizedAlternativeKey(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
}
