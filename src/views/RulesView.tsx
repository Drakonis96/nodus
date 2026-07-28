import { useEffect, useMemo, useState } from 'react';
import type { RuleHardness, RuleStatus, WorldBeat, WorldGroup, WorldPlace, WorldRule } from '@shared/types';
import {
  BEAT_MARK_LABEL,
  marksFor,
} from '@shared/worldThreads';
import {
  RULE_HARDNESS,
  RULE_HARDNESS_HINT,
  RULE_HARDNESS_LABEL,
  RULE_HEALTH_LABEL,
  RULE_SCOPE_LABEL,
  RULE_STATUSES,
  RULE_STATUS_LABEL,
  RULE_SUGGESTIONS,
  ruleHealth,
  ruleTally,
  type RuleHealth,
} from '@shared/worldRules';
import type { View } from '../navigation';
import type { WorldSectionDef } from '../components/world/WorldWorkspace';
import { WorldWorkspace } from '../components/world/WorldWorkspace';
import { NewRuleModal } from '../components/world/NewRuleModal';
import { AutoSavingField } from '../components/AutoSavingField';
import { Icon } from '../components/ui';
import { confirm, toast } from '../components/feedback';
import { PERSON_DOSSIER_SECTION_CLASS } from '../components/personDossierLayout';
import { notifyDataChanged } from '../hooks';
import { t, tx } from '../i18n';

/**
 * The hard laws of the world.
 *
 * A rule exists so that breaking it costs something, and every screen here serves that one
 * sentence: the price and the limits are fields of their own, the tests are counted, and
 * the health facet answers the only question a writer has about their own laws — *which of
 * these have I never actually put in front of the reader?*
 *
 * Only the title is mandatory. A section that demands fifteen fields before it is useful is
 * a section abandoned in two weeks.
 */
function rulesSection(onNavigate?: (view: View) => void): WorldSectionDef<WorldRule> {
  return {
    id: 'rules',
    icon: 'lock',
    title: 'Reglas del mundo',
    searchPlaceholder: 'Buscar reglas…',
    createLabel: 'Nueva regla',
    emptyLabel: 'Todavía no hay reglas.',
    noMatchLabel: 'Ninguna regla coincide con el filtro.',
    presentation: 'list',
    load: () => window.nodus.listWorldRules(),
    idOf: (rule) => rule.ruleId,
    labelOf: (rule) => rule.title,
    facets: [
      {
        id: 'hardness',
        label: 'Dureza',
        source: 'vocabulary',
        vocabulary: RULE_HARDNESS.map((hardness) => ({ id: hardness, label: RULE_HARDNESS_LABEL[hardness] })),
      },
      {
        id: 'status',
        label: 'Estado',
        source: 'vocabulary',
        vocabulary: RULE_STATUSES.map((status) => ({ id: status, label: RULE_STATUS_LABEL[status] })),
      },
      // The facet that turns the collection into a report: which laws are never tested,
      // and which are broken without paying.
      {
        id: 'health',
        label: 'Cómo va',
        source: 'vocabulary',
        vocabulary: (['untested', 'working', 'unpaid', 'overrun'] as RuleHealth[]).map((health) => ({
          id: health,
          label: RULE_HEALTH_LABEL[health],
        })),
      },
    ],
    facetValues: (rule) => ({
      hardness: rule.hardness,
      status: rule.status,
      health: healthCache.get(rule.ruleId) ?? 'untested',
    }),
    searchText: (rule) => [rule.title, rule.statement ?? '', rule.cost ?? ''],
    Card: RuleRow,
    Sheet: ({ item, onChanged, onBack }) => (
      <RuleSheet rule={item} onChanged={onChanged} onBack={onBack} onNavigate={onNavigate} />
    ),
  };
}

/**
 * Health is computed from the beats, which the section does not load per row.
 *
 * Filled once per load by the view below and read by the facet. A module-level cache
 * rather than a prop because `facetValues` is a plain function on the descriptor — and the
 * alternative, fetching the beats inside it, would be one query per row per keystroke.
 */
const healthCache = new Map<string, RuleHealth>();

export function RulesView({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const [ready, setReady] = useState(false);
  const section = useMemo(() => rulesSection(onNavigate), [onNavigate]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [rules, beats] = await Promise.all([window.nodus.listWorldRules(), window.nodus.listWorldBeats()]);
      if (!active) return;
      healthCache.clear();
      const byRule = new Map<string, WorldBeat[]>();
      for (const beat of beats) {
        if (beat.threadKind !== 'rule') continue;
        byRule.set(beat.threadId, [...(byRule.get(beat.threadId) ?? []), beat]);
      }
      for (const rule of rules) {
        const children = rules.filter((other) => other.parentRuleId === rule.ruleId);
        const childBeats = children.flatMap((child) => byRule.get(child.ruleId) ?? []);
        healthCache.set(rule.ruleId, ruleHealth(ruleTally(byRule.get(rule.ruleId) ?? [], childBeats, 0)));
      }
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!ready) return <p className="p-6 text-sm text-neutral-600 dark:text-neutral-500">{t('Cargando…')}</p>;

  return (
    <WorldWorkspace
      section={section}
      createModal={(close, created) => <NewRuleModal onClose={close} onCreated={created} />}
    />
  );
}

function RuleRow({ item, compact, onOpen }: { item: WorldRule; compact: boolean; onOpen: () => void }) {
  const health = healthCache.get(item.ruleId) ?? 'untested';
  return (
    <button
      data-testid="rule-row"
      data-health={health}
      onClick={onOpen}
      className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-left transition-colors hover:border-indigo-400 dark:hover:border-violet-700/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/20"
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-900 dark:text-neutral-100">{item.title}</span>
        {item.parentRuleId && (
          <span className="shrink-0 rounded bg-neutral-200 dark:bg-neutral-800 px-1 text-[9px] uppercase tracking-wide text-neutral-600 dark:text-neutral-500">
            {t('Excepción')}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-600">{t(RULE_HARDNESS_LABEL[item.hardness])}</span>
      </span>
      {!compact && item.statement && (
        <span className="mt-0.5 line-clamp-1 block text-[11px] text-neutral-600 dark:text-neutral-500">{item.statement}</span>
      )}
      {!compact && health !== 'working' && (
        <span
          className={`mt-0.5 block text-[10px] ${health === 'unpaid' ? 'text-amber-700 dark:text-amber-500' : 'text-neutral-500 dark:text-neutral-600'}`}
        >
          {t(RULE_HEALTH_LABEL[health])}
        </span>
      )}
    </button>
  );
}

function RuleSheet({
  rule,
  onChanged,
  onBack,
  onNavigate,
}: {
  rule: WorldRule;
  onChanged: () => Promise<void>;
  onBack: () => void;
  onNavigate?: (view: View) => void;
}) {
  const [beats, setBeats] = useState<WorldBeat[]>([]);
  const [exceptions, setExceptions] = useState<WorldRule[]>([]);
  const [groups, setGroups] = useState<WorldGroup[]>([]);
  const [places, setPlaces] = useState<WorldPlace[]>([]);
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [allBeats, rules, allGroups, allPlaces] = await Promise.all([
        window.nodus.listWorldBeats(),
        window.nodus.listWorldRules(),
        window.nodus.listWorldGroups(),
        window.nodus.listWorldPlaces(),
      ]);
      if (!active) return;
      setBeats(allBeats.filter((beat) => beat.threadKind === 'rule' && beat.threadId === rule.ruleId));
      setExceptions(rules.filter((other) => other.parentRuleId === rule.ruleId));
      setGroups(allGroups);
      setPlaces(allPlaces);
    })();
    return () => {
      active = false;
    };
  }, [rule.ruleId, rule.updatedAt]);

  const tally = ruleTally(beats, [], 0);
  const save = async (patch: Parameters<typeof window.nodus.updateWorldRule>[1]) => {
    await window.nodus.updateWorldRule(rule.ruleId, patch);
    await onChanged();
    notifyDataChanged();
  };

  /**
   * The one model call this screen makes, and it attacks the blank page rather than
   * judging anything: the draft lands in `proposedText`, beside the author's own sentence,
   * and becomes the law only when they say so.
   */
  const draft = async () => {
    setDrafting(true);
    try {
      const result = await window.nodus.draftWorldRule(rule.ruleId);
      if (result.noMaterial) {
        toast(t('Todavía no hay de dónde escribirla: dime sobre qué rige, empieza una línea o márcala en una escena.'));
        return;
      }
      await onChanged();
    } finally {
      setDrafting(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Eliminar la regla'),
      message: t('Sus excepciones no se borran: pasan a ser reglas por su cuenta.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteWorldRule(rule.ruleId);
    onBack();
    await onChanged();
    notifyDataChanged();
  };

  return (
    <div className="space-y-5 p-6" data-testid="rule-sheet">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button className="mb-2 flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200" onClick={onBack}>
            <Icon name="chevronLeft" size={13} /> {t('Volver')}
          </button>
          <h2 className="text-xl font-semibold">{rule.title}</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {[t(RULE_HARDNESS_LABEL[rule.hardness]), t(RULE_STATUS_LABEL[rule.status])].join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {!rule.proposedText && (
            <button
              className="btn btn-ghost h-8 gap-1 border border-neutral-300 dark:border-neutral-700 px-2 text-xs"
              data-testid="rule-draft"
              disabled={drafting}
              onClick={() => void draft()}
            >
              <Icon name="sparkles" size={13} /> {drafting ? t('Escribiendo…') : t('Redactar')}
            </button>
          )}
          <button
            className="btn btn-ghost h-8 w-8 p-0 text-red-600 dark:text-red-300 hover:text-red-700 dark:hover:text-red-200"
            title={t('Eliminar')}
            onClick={() => void remove()}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>

      {/* The AI draft, quarantined exactly as an article's is. */}
      {rule.proposedText && (
        <section className="rounded-xl border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/10 p-4" data-testid="rule-proposal">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            <Icon name="sparkles" size={13} /> {t('Propuesta de la IA')}
          </h3>
          <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{rule.proposedText}</p>
          <p className="mt-1 text-[10px] leading-4 text-neutral-500 dark:text-neutral-600">
            {t('Solo el enunciado. El precio y los límites los escribes tú: cada uno responde a una pregunta distinta.')}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              className="btn btn-primary px-3 text-xs"
              onClick={async () => {
                await window.nodus.acceptRuleDraft(rule.ruleId);
                await onChanged();
              }}
            >
              {t('Aceptar')}
            </button>
            <button
              className="btn btn-ghost border border-neutral-300 dark:border-neutral-700 px-3 text-xs"
              onClick={async () => {
                await window.nodus.rejectRuleDraft(rule.ruleId);
                await onChanged();
              }}
            >
              {t('Descartar')}
            </button>
          </div>
        </section>
      )}

      <section className={PERSON_DOSSIER_SECTION_CLASS}>
        <AutoSavingField
          label={t('La regla')}
          hint={t('Qué pasa siempre, o qué no puede pasar nunca. Puedes enlazar con [[dobles corchetes]].')}
          value={rule.statement}
          placeholder={t('La sangre paga la sangre…')}
          field="statement"
          onSave={(value) => save({ statement: value })}
          rows={3}
        />
        <AutoSavingField
          label={t('Qué cuesta romperla')}
          hint={t('Todo lo que revisa esta sección pregunta una sola cosa: si ese precio está alguna vez en la página.')}
          value={rule.cost}
          placeholder={t('Se paga con un año de vida…')}
          field="cost"
          onSave={(value) => save({ cost: value })}
          rows={2}
        />
        <AutoSavingField
          label={t('Hasta dónde no llega')}
          hint={t('Sin esto, un sistema de magia es un disolvente de tramas.')}
          value={rule.limits}
          placeholder={t('No funciona sobre los muertos…')}
          field="limits"
          onSave={(value) => save({ limits: value })}
          rows={2}
        />
      </section>

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="rule-scope">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-600 dark:text-neutral-500">{t('Dureza')}</span>
            <select
              className="input h-9 w-full text-sm"
              value={rule.hardness}
              onChange={(event) => void save({ hardness: event.target.value as RuleHardness })}
            >
              {RULE_HARDNESS.map((hardness) => (
                <option key={hardness} value={hardness}>
                  {t(RULE_HARDNESS_LABEL[hardness])}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-600 dark:text-neutral-500">{t('Rige sobre')}</span>
            <select
              className="input h-9 w-full text-sm"
              value={rule.scopeKind}
              onChange={(event) =>
                void save({ scopeKind: event.target.value as WorldRule['scopeKind'], scopeId: null })
              }
            >
              {(['world', 'group', 'place'] as const).map((scope) => (
                <option key={scope} value={scope}>
                  {t(RULE_SCOPE_LABEL[scope])}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-600 dark:text-neutral-500">{t('Estado')}</span>
            <select
              className="input h-9 w-full text-sm"
              value={rule.status}
              onChange={(event) => void save({ status: event.target.value as RuleStatus })}
            >
              {RULE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(RULE_STATUS_LABEL[status])}
                </option>
              ))}
            </select>
          </label>
        </div>
        {rule.scopeKind !== 'world' && (
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-600 dark:text-neutral-500">
              {t(rule.scopeKind === 'group' ? 'Qué facción' : 'Qué lugar')}
            </span>
            <select
              className="input h-9 w-full text-sm"
              value={rule.scopeId ?? ''}
              onChange={(event) => void save({ scopeId: event.target.value || null })}
            >
              <option value="">{t('Sin elegir')}</option>
              {(rule.scopeKind === 'group' ? groups : places).map((entry) =>
                'groupId' in entry ? (
                  <option key={entry.groupId} value={entry.groupId}>
                    {entry.name}
                  </option>
                ) : (
                  <option key={entry.placeId} value={entry.placeId}>
                    {entry.name}
                  </option>
                )
              )}
            </select>
          </label>
        )}
        <p className="mt-1 text-[10px] leading-4 text-neutral-500 dark:text-neutral-600">{t(RULE_HARDNESS_HINT[rule.hardness])}</p>
      </section>

      <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="rule-tests">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">{t('Puesta a prueba')}</h3>
        {beats.length === 0 ? (
          <p className="text-[11px] leading-4 text-neutral-500 dark:text-neutral-600">
            {t('Ninguna escena la pone a prueba todavía. Se marca desde la ficha de la escena.')}
          </p>
        ) : (
          <>
            <ul className="space-y-1">
              {[...beats]
                .sort((a, b) => a.narrativeOrder - b.narrativeOrder)
                .map((beat) => (
                  <li key={beat.sceneId} className="flex items-baseline gap-2 text-xs">
                    <span className="w-8 shrink-0 text-neutral-500 dark:text-neutral-600">{beat.narrativeOrder + 1}</span>
                    <span className="shrink-0 rounded bg-neutral-200 dark:bg-neutral-800 px-1 text-[10px] text-neutral-600 dark:text-neutral-400">
                      {t(BEAT_MARK_LABEL[beat.mark])}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{beat.sceneTitle}</span>
                    {beat.mark === 'breaks' && (
                      <span
                        className={`shrink-0 text-[10px] ${
                          beat.paid === false ? 'text-amber-700 dark:text-amber-500' : beat.paid ? 'text-neutral-500 dark:text-neutral-600' : 'text-neutral-400 dark:text-neutral-700'
                        }`}
                      >
                        {beat.paid === false
                          ? t('sin pagar')
                          : beat.paid
                            ? t('pagado')
                            : t('sin mirar')}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
            {/* Three states, and only the explicit zero is a problem. */}
            {tally.unjudged > 0 && (
              <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-600">
                {tx('{count} roturas sin juzgar: márcalas en la escena para saber si el precio está en la página.', {
                  count: String(tally.unjudged),
                })}
              </p>
            )}
          </>
        )}
      </section>

      {exceptions.length > 0 && (
        <section className={PERSON_DOSSIER_SECTION_CLASS} data-testid="rule-exceptions">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-500">{t('Excepciones')}</h3>
          <ul className="space-y-0.5">
            {exceptions.map((exception) => (
              <li key={exception.ruleId} className="truncate text-xs text-neutral-700 dark:text-neutral-300">
                · {exception.title}
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        className="btn btn-ghost w-full border border-neutral-300 dark:border-neutral-700 text-xs"
        onClick={() => onNavigate?.('scenes')}
      >
        {t('Ir a Escenas para ponerla a prueba')}
      </button>
    </div>
  );
}

export { RULE_SUGGESTIONS, marksFor };
