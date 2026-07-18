import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  AGGREGATIONS,
  ROUNDING_MODES,
  validatePlan,
  type Aggregation,
  type AssessmentItem,
  type AssessmentPlan,
  type PlanRules,
  type RoundingMode,
} from '@shared/assessment';
import { Icon, ModalBackdrop, Spinner } from '../components/ui';
import { proposedWeightTotal, countProposedItems, type ProposedPlan } from '@shared/assessmentImport';
import { t, tx } from '../i18n';

/**
 * Editor for the assessment plan — the programación didáctica / guía docente.
 *
 * Everything here is editable on purpose. No state norm prescribes how a grade is
 * computed, so a tool that hardcoded one institution's arithmetic would be wrong at
 * the next one. Where a well-documented institutional limit exists it appears as a
 * WARNING that quotes its own source, and the teacher can proceed regardless: real
 * published programaciones contain weights that do not add up, and refusing to open
 * them would make the tool useless for the documents teachers actually have.
 *
 * The audience is a teacher, not a spreadsheet author, so the vocabulary is plain
 * ("Media ponderada", "Mejores N de M") and the fiddly options stay collapsed until
 * asked for.
 */

/** Plain-language names for each aggregation, with the caveat where one matters. */
const AGGREGATION_LABELS: Record<Aggregation, string> = {
  weighted: 'Media ponderada',
  mean: 'Media aritmética',
  sum: 'Suma de puntos',
  normalizeGroupMax: 'Escala sobre el máximo del grupo',
  normalizeTarget: 'Escala sobre un objetivo fijo',
  bestOf: 'Mejores N de M',
  mode: 'Valor más repetido',
  max: 'Nota más alta',
  last: 'Última nota',
  conditionalMean: 'Media solo si todo llega al mínimo',
  manual: 'Lo fija el docente',
};

const ROUNDING_LABELS: Record<RoundingMode, string> = {
  none: 'Sin redondear',
  halfUp: 'Al más cercano (0,5 sube)',
  halfDown: 'Al más cercano (0,5 baja)',
  truncate: 'Truncar',
  threshold: 'Subir solo a partir de un umbral',
  integer: 'Al entero más cercano',
};

export function AssessmentPlanEditor({
  plan, items, onClose, onChanged,
}: {
  plan: AssessmentPlan;
  items: AssessmentItem[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<'structure' | 'rules'>('structure');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [picking, setPicking] = useState<'exam' | 'rubric' | null>(null);

  const warnings = useMemo(() => validatePlan(plan, items), [plan, items]);
  const byParent = useMemo(() => {
    const map = new Map<string | null, AssessmentItem[]>();
    for (const item of items) {
      const list = map.get(item.parentId) ?? [];
      list.push(item);
      map.set(item.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [items]);

  const run = async (fn: () => Promise<unknown>) => {
    // `busy` drives a subtle indicator only — it must neither disable a control nor
    // gate this function. A save fired by leaving one field overlaps the click on the
    // next one, and either form of blocking makes that click vanish in silence.
    setBusy(true);
    try { await fn(); await onChanged(); setError(''); }
    catch (cause) { setError(String((cause as Error)?.message ?? cause)); }
    finally { setBusy(false); }
  };

  const patchItem = (id: string, patch: Partial<AssessmentItem>) =>
    run(() => window.nodus.updateAssessmentItem(id, patch));
  // Send ONLY the changed fields: the repo merges them against the stored row, so two
  // edits in flight at once compose instead of the later one clobbering the earlier.
  const patchRules = (patch: Partial<PlanRules>) =>
    run(() => window.nodus.updateAssessmentPlan(plan.id, { rules: patch }));

  const published = !!plan.publishedAt;

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="card-modal flex max-h-[86vh] w-full max-w-3xl flex-col p-5" role="dialog" aria-modal="true"
        aria-label={t('Plan de evaluación')} data-testid="plan-editor">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              {t('Plan de evaluación')}
              {busy && <span className="text-[10px] font-normal text-neutral-500">{t('Guardando…')}</span>}
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              {published
                ? t('Publicado: para cambiarlo se creará una versión nueva y esta quedará intacta.')
                : t('Así se calcula la nota. Todo se puede ajustar a tu programación o guía docente.')}
            </p>
          </div>
          {published ? (
            <button className="btn btn-ghost h-8" data-testid="plan-revise"
              onClick={() => void run(() => window.nodus.reviseAssessmentPlan(plan.id))}>
              <Icon name="copy" size={13} />{t('Crear versión nueva')}
            </button>
          ) : (
            <button className="btn btn-ghost h-8" data-testid="plan-publish" disabled={items.length === 0}
              title={t('Congela el plan para poder justificar las notas dadas con él.')}
              onClick={() => void run(() => window.nodus.publishAssessmentPlan(plan.id))}>
              <Icon name="lock" size={13} />{t('Publicar')}
            </button>
          )}
        </div>

        <div className="mt-3 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
          {(['structure', 'rules'] as const).map((id) => (
            <button key={id} data-testid={`plan-tab-${id}`}
              className={`px-3 py-1.5 text-xs font-medium ${tab === id ? 'border-b-2 border-indigo-400 text-indigo-300' : 'text-neutral-500'}`}
              onClick={() => setTab(id)}>
              {id === 'structure' ? t('Estructura') : t('Reglas')}
            </button>
          ))}
        </div>

        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        {warnings.length > 0 && (
          <div data-testid="editor-warnings"
            className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
            <p className="font-medium">{t('Avisos: puedes guardar igualmente.')}</p>
            {warnings.slice(0, 4).map((warning, index) => (
              <p key={index} className="mt-0.5">
                {warning.code === 'weights_not_100'
                  ? tx('Unos pesos suman {sum} en lugar de 100.', { sum: Math.round(Number(warning.detail.sum) * 100) / 100 })
                  : warning.code === 'unequal_sibling_weights' ? t('Hay criterios hermanos con pesos distintos.')
                  : warning.code === 'min_above_cap' ? t('Una nota mínima para promediar supera el límite que has configurado.')
                  : warning.code === 'non_recoverable_above_cap' ? t('La parte no recuperable supera el límite que has configurado.')
                  : t('Este cuaderno todavía no tiene bloques de evaluación.')}
                {warning.source ? ` ${warning.source}` : ''}
              </p>
            ))}
          </div>
        )}

        <div className="mt-3 min-h-0 flex-1 overflow-auto">
          {tab === 'structure' ? (
            <StructureTab
              plan={plan} items={items} byParent={byParent} expanded={expanded}
              onExpand={setExpanded} onPatch={patchItem}
              onAdd={(parentId) => run(() => window.nodus.createAssessmentItem(plan.id, {
                parentId, name: t('Nuevo elemento'), weight: 0,
              }))}
              onDelete={(id) => run(() => window.nodus.deleteAssessmentItem(id))}
              onFromExam={async () => setPicking('exam')}
              onFromRubric={async () => setPicking('rubric')}
            />
          ) : (
            <RulesTab rules={plan.rules} onPatch={patchRules} />
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="btn btn-ghost mr-auto" data-testid="plan-import-open" onClick={() => setImporting(true)}>
            <Icon name="bulb" size={13} />{t('Importar de mi guía docente')}
          </button>
          <button className="btn btn-primary" data-testid="plan-editor-close" onClick={onClose}>{t('Hecho')}</button>
        </div>
      </section>
      {picking && (
        <SourcePicker
          kind={picking}
          onCancel={() => setPicking(null)}
          onPick={async (id, weight) => {
            await run(() => picking === 'exam'
              ? window.nodus.addExamBlock(plan.id, id, weight)
              : window.nodus.addRubricItem(plan.id, id, weight));
            setPicking(null);
          }}
        />
      )}
      {importing && (
        <ImportModal
          planId={plan.id}
          onCancel={() => setImporting(false)}
          onApplied={async () => { setImporting(false); await onChanged(); }}
        />
      )}
    </ModalBackdrop>
  );
}

/* ------------------------------------------------------------------ source --- */

/**
 * Builds a block from something the teacher already made.
 *
 * An exam already carries the numbering and the points per question, and a rubric
 * already carries its own maximum — retyping either is work the app can spare them,
 * and a column that keeps its source id can always be traced back to it.
 */
function SourcePicker({
  kind, onCancel, onPick,
}: {
  kind: 'exam' | 'rubric';
  onCancel: () => void;
  onPick: (id: string, weight: number) => Promise<void>;
}) {
  const [options, setOptions] = useState<{ id: string; title: string }[]>([]);
  const [chosen, setChosen] = useState('');
  const [weight, setWeight] = useState('0');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const list = kind === 'exam'
        ? (await window.nodus.listTeachingExams()).map((e) => ({ id: e.id, title: e.title }))
        : (await window.nodus.listTeachingRubrics()).map((r) => ({ id: r.id, title: r.title }));
      if (!active) return;
      setOptions(list);
      setChosen(list[0]?.id ?? '');
      setLoading(false);
    })();
    return () => { active = false; };
  }, [kind]);

  return (
    <ModalBackdrop onClose={onCancel} zIndex={140}>
      <section className="card-modal w-full max-w-md p-5" role="dialog" aria-modal="true"
        aria-label={kind === 'exam' ? t('Desde un examen') : t('Desde una rúbrica')} data-testid="source-picker">
        <h2 className="text-base font-semibold">{kind === 'exam' ? t('Desde un examen') : t('Desde una rúbrica')}</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {kind === 'exam'
            ? t('Se creará una columna por pregunta, con su numeración y su puntuación.')
            : t('Se creará una columna que se evalúa abriendo la rúbrica.')}
        </p>
        {loading ? <Spinner label={t('Cargando…')} /> : options.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">
            {kind === 'exam' ? t('Todavía no has creado ningún examen.') : t('Todavía no has creado ninguna rúbrica.')}
          </p>
        ) : (
          <>
            <select className="input mt-4 w-full" data-testid="source-select" value={chosen} onChange={(e) => setChosen(e.target.value)}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
            <label className="mt-3 block text-xs font-medium">{t('Peso')}</label>
            <input type="number" className="input mt-1 w-full" data-testid="source-weight" value={weight}
              onChange={(e) => setWeight(e.target.value)} />
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onCancel}>{t('Cancelar')}</button>
          <button className="btn btn-primary" data-testid="source-add" disabled={!chosen}
            onClick={() => void onPick(chosen, Number(weight) || 0)}>{t('Añadir')}</button>
        </div>
      </section>
    </ModalBackdrop>
  );
}

/* ------------------------------------------------------------------ import --- */

/**
 * Paste the evaluation section of your own guía docente or programación; the model
 * proposes a structure and YOU confirm it before anything is written. It proposes
 * structure only — the grade is always computed by the engine, never by the model.
 */
function ImportModal({
  planId, onCancel, onApplied,
}: {
  planId: string;
  onCancel: () => void;
  onApplied: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState<ProposedPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const analyse = async () => {
    setBusy(true); setError('');
    try { setProposal(await window.nodus.importAssessmentPlan({ planId, text })); }
    catch (cause) { setError(String((cause as Error)?.message ?? cause)); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (!proposal) return;
    setBusy(true);
    try { await window.nodus.applyProposedPlan(planId, proposal); await onApplied(); }
    catch (cause) { setError(String((cause as Error)?.message ?? cause)); setBusy(false); }
  };

  const renderProposed = (items: ProposedPlan['items'], depth = 0) => items.map((item, index) => (
    <div key={`${depth}-${index}`} style={{ paddingLeft: depth * 14 }} className="border-b border-neutral-200 py-1 dark:border-neutral-800/60">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        <span className="shrink-0 text-[10px] text-neutral-500">{item.weight}%</span>
      </div>
      {item.minToAverage != null && (
        <p className="text-[10px] text-amber-700 dark:text-amber-400">
          {tx('Nota mínima para promediar: {min}', { min: item.minToAverage })}
        </p>
      )}
      {item.evidence && <p className="truncate text-[10px] text-neutral-500">“{item.evidence}”</p>}
      {item.children && renderProposed(item.children, depth + 1)}
    </div>
  ));

  return (
    <ModalBackdrop onClose={onCancel} zIndex={140}>
      <section className="card-modal flex max-h-[80vh] w-full max-w-xl flex-col p-5" role="dialog" aria-modal="true"
        aria-label={t('Importar de mi guía docente')} data-testid="plan-import-modal">
        <h2 className="text-base font-semibold">{t('Importar de mi guía docente')}</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {t('Pega el apartado de evaluación. La IA propone la estructura; tú la confirmas. Nunca calcula notas.')}
        </p>

        {error && <p className="mt-2 text-sm text-red-500" data-testid="import-error">{error}</p>}

        {!proposal ? (
          <>
            <textarea className="input mt-3 min-h-[180px] flex-1 text-xs" data-testid="import-text" value={text}
              placeholder={t('Prueba final 50 %, trabajos 30 %, participación 20 %…')}
              onChange={(e) => setText(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={onCancel}>{t('Cancelar')}</button>
              <button className="btn btn-primary" data-testid="import-run" disabled={busy || !text.trim()} onClick={() => void analyse()}>
                {busy ? <Spinner label={t('Analizando…')} /> : t('Analizar')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 min-h-0 flex-1 overflow-auto text-xs" data-testid="import-proposal">
              {renderProposed(proposal.items)}
            </div>
            <p className="mt-2 text-[11px] text-neutral-500">
              {tx('{n} elementos · los pesos suman {sum}', { n: countProposedItems(proposal), sum: proposedWeightTotal(proposal) })}
            </p>
            {proposal.notes && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{proposal.notes}</p>}
            <p className="mt-2 text-[11px] text-neutral-500">{t('Al aplicarlo se reemplazará la estructura actual del cuaderno.')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-ghost" data-testid="import-back" onClick={() => setProposal(null)}>{t('Volver')}</button>
              <button className="btn btn-primary" data-testid="import-apply" disabled={busy} onClick={() => void apply()}>
                {t('Aplicar')}
              </button>
            </div>
          </>
        )}
      </section>
    </ModalBackdrop>
  );
}

/* --------------------------------------------------------------- structure --- */

function StructureTab({
  plan, items, byParent, expanded, onExpand, onPatch, onAdd, onDelete, onFromExam, onFromRubric,
}: {
  plan: AssessmentPlan;
  items: AssessmentItem[];
  byParent: Map<string | null, AssessmentItem[]>;
  expanded: string | null;
  onExpand: (id: string | null) => void;
  onPatch: (id: string, patch: Partial<AssessmentItem>) => Promise<void>;
  onAdd: (parentId: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onFromExam: () => Promise<void>;
  onFromRubric: () => Promise<void>;
}) {
  const renderLevel = (parentId: string | null, depth: number) => {
    const siblings = byParent.get(parentId) ?? [];
    if (siblings.length === 0) return null;
    const sum = siblings.reduce((total, s) => total + s.weight, 0);
    return (
      <div>
        {siblings.map((item) => {
          const children = byParent.get(item.id) ?? [];
          const isOpen = expanded === item.id;
          return (
            <div key={item.id} style={{ paddingLeft: depth * 16 }} className="border-b border-neutral-200 py-1.5 dark:border-neutral-800/60">
              <div className="flex items-center gap-2">
                <input
                  className="input h-7 min-w-0 flex-1 text-xs" data-testid={`item-name-${item.id}`}
                  defaultValue={item.name}
                  onBlur={(e) => { if (e.target.value !== item.name) void onPatch(item.id, { name: e.target.value }); }}
                />
                <label className="flex shrink-0 items-center gap-1 text-[10px] text-neutral-500">
                  {t('Peso')}
                  <input type="number" className="input h-7 w-16 text-right text-xs" data-testid={`item-weight-${item.id}`}
                    defaultValue={item.weight}
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== item.weight) void onPatch(item.id, { weight: v }); }} />
                </label>
                <button className="btn btn-ghost h-7 w-7 shrink-0 p-0" title={t('Más opciones')} aria-label={t('Más opciones')}
                  data-testid={`item-more-${item.id}`} onClick={() => onExpand(isOpen ? null : item.id)}>
                  <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={12} />
                </button>
                <button className="btn btn-ghost h-7 w-7 shrink-0 p-0 text-red-500" title={t('Eliminar')} aria-label={t('Eliminar')}
                  data-testid={`item-delete-${item.id}`} onClick={() => void onDelete(item.id)}>
                  <Icon name="trash" size={12} />
                </button>
              </div>

              {isOpen && <ItemOptions item={item} plan={plan} hasChildren={children.length > 0} onPatch={onPatch} />}
              {renderLevel(item.id, depth + 1)}
              {isOpen && (
                <button className="btn btn-ghost mt-1 h-7 text-xs" data-testid={`item-add-child-${item.id}`}
                  onClick={() => void onAdd(item.id)}>
                  <Icon name="plus" size={12} />{t('Añadir dentro')}
                </button>
              )}
            </div>
          );
        })}
        {/* Live feedback rather than validation-on-save: a teacher fixing weights wants
            to see the total move as they type. */}
        <p className="py-1 text-[10px] text-neutral-500" style={{ paddingLeft: depth * 16 }}>
          {tx('Suma de pesos: {sum}', { sum: Math.round(sum * 100) / 100 })}
        </p>
      </div>
    );
  };

  return (
    <div className="text-xs" data-testid="plan-structure">
      {items.length === 0 && <p className="py-4 text-neutral-500">{t('Este cuaderno todavía no tiene bloques de evaluación.')}</p>}
      {renderLevel(null, 0)}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn btn-primary h-8" data-testid="item-add-root" onClick={() => void onAdd(null)}>
          <Icon name="plus" size={13} />{t('Añadir bloque')}
        </button>
        <button className="btn btn-ghost h-8" data-testid="item-from-exam" onClick={() => void onFromExam()}>
          <Icon name="notebook" size={13} />{t('Desde un examen')}
        </button>
        <button className="btn btn-ghost h-8" data-testid="item-from-rubric" onClick={() => void onFromRubric()}>
          <Icon name="table" size={13} />{t('Desde una rúbrica')}
        </button>
      </div>
    </div>
  );
}

function ItemOptions({
  item, plan, hasChildren, onPatch,
}: {
  item: AssessmentItem;
  plan: AssessmentPlan;
  hasChildren: boolean;
  onPatch: (id: string, patch: Partial<AssessmentItem>) => Promise<void>;
}) {
  const num = (value: number | null) => (value == null ? '' : String(value));
  return (
    <div className="mt-2 grid gap-2 rounded-lg bg-neutral-100 p-2 dark:bg-neutral-900/40 md:grid-cols-2">
      <label className="text-[10px] text-neutral-500">
        {t('Cómo se combina')}
        <select className="input mt-0.5 h-7 w-full text-xs" data-testid={`item-agg-${item.id}`}
          value={item.aggregation}
          onChange={(e) => void onPatch(item.id, { aggregation: e.target.value as Aggregation })}>
          {AGGREGATIONS.map((a) => <option key={a} value={a}>{t(AGGREGATION_LABELS[a])}</option>)}
        </select>
      </label>

      <label className="text-[10px] text-neutral-500">
        {t('Peso en evaluación no continua')}
        <input type="number" className="input mt-0.5 h-7 w-full text-xs" data-testid={`item-weightalt-${item.id}`}
          defaultValue={item.weightAlt}
          onBlur={(e) => void onPatch(item.id, { weightAlt: Number(e.target.value) })} />
      </label>

      {!hasChildren && (
        <label className="text-[10px] text-neutral-500">
          {tx('Puntuación máxima (sobre {max})', { max: plan.rules.scaleMax })}
          <input type="number" className="input mt-0.5 h-7 w-full text-xs" data-testid={`item-max-${item.id}`}
            defaultValue={item.maxPoints}
            onBlur={(e) => void onPatch(item.id, { maxPoints: Number(e.target.value) })} />
        </label>
      )}

      <label className="text-[10px] text-neutral-500">
        {t('Nota mínima para promediar (0–1)')}
        <input type="number" step="0.05" min="0" max="1" className="input mt-0.5 h-7 w-full text-xs"
          data-testid={`item-min-${item.id}`} defaultValue={num(item.minToAverage)}
          onBlur={(e) => void onPatch(item.id, { minToAverage: e.target.value === '' ? null : Number(e.target.value) })} />
      </label>

      {item.aggregation === 'normalizeTarget' && (
        <label className="text-[10px] text-neutral-500">
          {t('Objetivo que vale el máximo')}
          <input type="number" className="input mt-0.5 h-7 w-full text-xs" data-testid={`item-target-${item.id}`}
            defaultValue={num(item.target)}
            onBlur={(e) => void onPatch(item.id, { target: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
      )}
      {item.aggregation === 'bestOf' && (
        <label className="text-[10px] text-neutral-500">
          {t('Cuántas cuentan')}
          <input type="number" min="1" className="input mt-0.5 h-7 w-full text-xs" data-testid={`item-bestof-${item.id}`}
            defaultValue={num(item.bestOf)}
            onBlur={(e) => void onPatch(item.id, { bestOf: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
      )}
      {item.aggregation === 'conditionalMean' && (
        <label className="text-[10px] text-neutral-500">
          {t('Mínimo que debe alcanzar cada parte (0–1)')}
          <input type="number" step="0.05" min="0" max="1" className="input mt-0.5 h-7 w-full text-xs"
            data-testid={`item-cond-${item.id}`} defaultValue={num(item.conditionalMin)}
            onBlur={(e) => void onPatch(item.id, { conditionalMin: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
      )}

      <label className="flex items-center gap-2 text-[10px] text-neutral-500">
        <input type="checkbox" data-testid={`item-mandatory-${item.id}`} checked={item.isMandatory}
          onChange={(e) => void onPatch(item.id, { isMandatory: e.target.checked })} />
        {t('Hay que superarla para aprobar')}
      </label>
      <label className="flex items-center gap-2 text-[10px] text-neutral-500">
        <input type="checkbox" data-testid={`item-recoverable-${item.id}`} checked={item.isRecoverable}
          onChange={(e) => void onPatch(item.id, { isRecoverable: e.target.checked })} />
        {t('Se puede recuperar')}
      </label>

      {item.aggregation === 'normalizeGroupMax' && (
        <p className="md:col-span-2 rounded-md bg-amber-50 px-2 py-1 text-[10px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          {t('Ojo: con esta opción la nota de un alumno cambia si otro obtiene más.')}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- rules --- */

/**
 * Declared at module scope, NOT inside RulesTab.
 *
 * A component defined inside another component's body is a brand-new type on every
 * render, so React unmounts and remounts the whole subtree instead of updating it —
 * which wipes whatever the user is typing and drops focus mid-edit. It looks harmless
 * and is not.
 */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-neutral-200 py-2 dark:border-neutral-800/60 md:grid-cols-[1.2fr_1fr] md:items-center">
      <div>
        <p className="text-xs">{label}</p>
        {hint && <p className="text-[10px] text-neutral-500">{hint}</p>}
      </div>
      <div className="md:justify-self-end">{children}</div>
    </div>
  );
}

function RulesTab({
  rules, onPatch,
}: {
  rules: PlanRules;
  onPatch: (patch: Partial<PlanRules>) => Promise<void>;
}) {
  return (
    <div data-testid="plan-rules">
      <Row label={t('Qué se registra')} hint={t('Hay sistemas cuyo acta no lleva número, solo un término.')}>
        <select className="input h-7 text-xs" data-testid="rule-record" value={rules.record}
          onChange={(e) => void onPatch({ record: e.target.value as PlanRules['record'] })}>
          <option value="numeric">{t('Solo número')}</option>
          <option value="qualitative">{t('Solo término')}</option>
          <option value="both">{t('Número y término')}</option>
        </select>
      </Row>

      <Row label={t('Escala')}>
        <span className="flex items-center gap-1">
          <input type="number" className="input h-7 w-16 text-xs" data-testid="rule-scale-min" defaultValue={rules.scaleMin} onBlur={(e) => void onPatch({ scaleMin: Number(e.target.value) })} />
          <span className="text-[10px] text-neutral-500">—</span>
          <input type="number" className="input h-7 w-16 text-xs" data-testid="rule-scale-max" defaultValue={rules.scaleMax} onBlur={(e) => void onPatch({ scaleMax: Number(e.target.value) })} />
        </span>
      </Row>

      <Row label={t('Se aprueba a partir de')} hint={t('Como fracción de la escala. Hay centros que aprueban en 4,5.')}>
        <input type="number" step="0.01" min="0" max="1" className="input h-7 w-20 text-xs" data-testid="rule-passat"
          defaultValue={rules.passAt} onBlur={(e) => void onPatch({ passAt: Number(e.target.value) })} />
      </Row>

      <Row label={t('Decimales')}>
        <input type="number" min="0" max="3" className="input h-7 w-16 text-xs" data-testid="rule-decimals"
          defaultValue={rules.decimals} onBlur={(e) => void onPatch({ decimals: Number(e.target.value) })} />
      </Row>

      <Row label={t('Redondeo')}>
        <select className="input h-7 text-xs" data-testid="rule-rounding" value={rules.rounding}
          onChange={(e) => void onPatch({ rounding: e.target.value as RoundingMode })}>
          {ROUNDING_MODES.map((m) => <option key={m} value={m}>{t(ROUNDING_LABELS[m])}</option>)}
        </select>
      </Row>

      {rules.rounding === 'threshold' && (
        <Row label={t('Sube a partir de este decimal')} hint={t('Por ejemplo 0,7: un 6,69 se queda en 6 y un 6,7 pasa a 7.')}>
          <input type="number" step="0.05" min="0" max="1" className="input h-7 w-20 text-xs" data-testid="rule-threshold"
            defaultValue={rules.roundingThreshold}
            onBlur={(e) => void onPatch({ roundingThreshold: Number(e.target.value) })} />
        </Row>
      )}

      <Row label={t('Conservar el valor sin redondear para medias posteriores')}>
        <input type="checkbox" data-testid="rule-keepreal" checked={rules.keepRealForAverage}
          onChange={(e) => void onPatch({ keepRealForAverage: e.target.checked })} />
      </Row>

      <Row label={t('Lo no entregado cuenta como')} hint={t('Déjalo vacío para que no cuente y se repartan los pesos.')}>
        <input type="number" className="input h-7 w-20 text-xs" data-testid="rule-notsubmitted"
          defaultValue={rules.notSubmittedValue == null ? '' : rules.notSubmittedValue}
          onBlur={(e) => void onPatch({ notSubmittedValue: e.target.value === '' ? null : Number(e.target.value) })} />
      </Row>

      <Row label={t('Lo que aún no se ha evaluado penaliza')}
        hint={t('Desactivado, la nota se calcula sobre lo que sí se ha evaluado.')}>
        <input type="checkbox" data-testid="rule-notassessed" checked={rules.notAssessedPenalizes}
          onChange={(e) => void onPatch({ notAssessedPenalizes: e.target.checked })} />
      </Row>

      <Row label={t('Si no se alcanza una nota mínima')}>
        <span className="flex items-center gap-1">
          <select className="input h-7 text-xs" data-testid="rule-minnotmet" value={rules.minNotMet.mode}
            onChange={(e) => void onPatch({ minNotMet: { ...rules.minNotMet, mode: e.target.value as 'raw' | 'cap' } })}>
            <option value="raw">{t('Dejar la media real')}</option>
            <option value="cap">{t('Limitar a')}</option>
          </select>
          {rules.minNotMet.mode === 'cap' && (
            <input type="number" step="0.1" className="input h-7 w-16 text-xs" data-testid="rule-capat"
              defaultValue={rules.minNotMet.capAt}
              onBlur={(e) => void onPatch({ minNotMet: { ...rules.minNotMet, capAt: Number(e.target.value) } })} />
          )}
        </span>
      </Row>

      <Row label={t('No conservar notas más bajas que las ya obtenidas')}
        hint={t('Para evaluación continua y sumativa: lo conseguido no se pierde.')}>
        <input type="checkbox" data-testid="rule-ratchet" checked={rules.ratchet}
          onChange={(e) => void onPatch({ ratchet: e.target.checked })} />
      </Row>

      <Row label={t('Usar «no presentado»')}>
        <input type="checkbox" data-testid="rule-np" checked={rules.np.enabled}
          onChange={(e) => void onPatch({ np: { ...rules.np, enabled: e.target.checked } })} />
      </Row>

      {rules.np.enabled && (
        <>
          <Row label={t('Código en el acta')}>
            <input className="input h-7 w-20 text-xs" data-testid="rule-npcode" defaultValue={rules.np.code}
              onBlur={(e) => void onPatch({ np: { ...rules.np, code: e.target.value } })} />
          </Row>
          <Row label={t('Equivalencia numérica')} hint={t('Déjalo vacío si no debe contar en ninguna media.')}>
            <input type="number" className="input h-7 w-20 text-xs" data-testid="rule-npvalue"
              defaultValue={rules.np.value == null ? '' : rules.np.value}
              onBlur={(e) => void onPatch({ np: { ...rules.np, value: e.target.value === '' ? null : Number(e.target.value) } })} />
          </Row>
          <Row label={t('Se considera no presentado al dejar sin hacer más de')}
            hint={t('Como fracción del total. Vacío para no aplicarlo automáticamente.')}>
            <input type="number" step="0.05" min="0" max="1" className="input h-7 w-20 text-xs" data-testid="rule-nptrigger"
              defaultValue={rules.np.triggerPct == null ? '' : rules.np.triggerPct}
              onBlur={(e) => void onPatch({ np: { ...rules.np, triggerPct: e.target.value === '' ? null : Number(e.target.value) } })} />
          </Row>
        </>
      )}

      <Row label={t('Conceder mención honorífica')} hint={t('El cupo y su redondeo varían entre instituciones.')}>
        <input type="checkbox" data-testid="rule-honours" checked={!!rules.honours?.enabled}
          onChange={(e) => void onPatch({
            honours: e.target.checked
              ? { threshold: 0.9, quotaPct: 0.05, unit: 'group', rounding: 'halfUp', minCohortForOne: 20, ...(rules.honours ?? {}), enabled: true }
              : rules.honours ? { ...rules.honours, enabled: false } : null,
          })} />
      </Row>

      {rules.honours?.enabled && (
        <>
          <Row label={t('Cupo sobre el grupo')}>
            <input type="number" step="0.01" min="0" max="1" className="input h-7 w-20 text-xs" data-testid="rule-quota"
              defaultValue={rules.honours.quotaPct}
              onBlur={(e) => void onPatch({ honours: { ...rules.honours!, quotaPct: Number(e.target.value) } })} />
          </Row>
          <Row label={t('Redondeo del cupo')}>
            <select className="input h-7 text-xs" data-testid="rule-quota-rounding" value={rules.honours.rounding}
              onChange={(e) => void onPatch({ honours: { ...rules.honours!, rounding: e.target.value as 'up' | 'halfUp' | 'down' } })}>
              <option value="up">{t('Hacia arriba')}</option>
              <option value="halfUp">{t('Al más cercano (0,5 sube)')}</option>
              <option value="down">{t('Hacia abajo')}</option>
            </select>
          </Row>
        </>
      )}

      <Row label={t('Avisar si una nota mínima supera')} hint={t('Solo es un aviso: podrás guardar igualmente.')}>
        <input type="number" step="0.05" min="0" max="1" className="input h-7 w-20 text-xs" data-testid="rule-advisory-min"
          defaultValue={rules.advisories.maxMinToAverage == null ? '' : rules.advisories.maxMinToAverage}
          onBlur={(e) => void onPatch({
            advisories: { ...rules.advisories, maxMinToAverage: e.target.value === '' ? null : Number(e.target.value) },
          })} />
      </Row>

      <Row label={t('Avisar si los criterios hermanos tienen pesos distintos')}>
        <input type="checkbox" data-testid="rule-advisory-equal" checked={rules.advisories.equalSiblingWeights}
          onChange={(e) => void onPatch({ advisories: { ...rules.advisories, equalSiblingWeights: e.target.checked } })} />
      </Row>
    </div>
  );
}
