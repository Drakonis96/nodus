import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DatabaseColumn, DatabaseRow } from '@shared/databases';
import type { FilterOp } from '@shared/databaseFilters';
import type { AutomationAction, AutomationRule, AutomationRun, AutomationTriggerType, CreateFormDefinitionInput, FormDefinition } from '@shared/databaseAutomations';
import { isReadOnlyDatabaseProperty } from '@shared/databaseProperties';
import { Icon } from './ui';
import { t, tx } from '../i18n';
import { toast } from './feedback';

type Tab = 'rules' | 'runs' | 'forms';
type ActionType = AutomationAction['type'];
const triggerLabels: Record<AutomationTriggerType, string> = {
  row_created: 'Al crear una página', property_changed: 'Al cambiar una propiedad', schedule: 'Según programación', button: 'Al pulsar un botón',
};
const actionLabels: Record<ActionType, string> = {
  set_property: 'Modificar una propiedad', create_page: 'Crear una página', update_related: 'Modificar páginas relacionadas', notify: 'Enviar una notificación', webhook: 'Enviar un webhook',
};
const statusStyles: Record<AutomationRun['status'], string> = {
  running: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100',
  succeeded: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  failed: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100',
  skipped: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
};

function localIso(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : ''; }
function cleanError(cause: unknown): string { return (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': Error:\s*/, ''); }

export function DatabaseAutomationWorkspace({ databaseId, columns, onClose, onChanged }: {
  databaseId: string; columns: DatabaseColumn[]; onClose: () => void; onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>('rules');
  const [rules, setRules] = useState<AutomationRule[]>([]); const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [forms, setForms] = useState<FormDefinition[]>([]); const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [serverOrigin, setServerOrigin] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(''); const [triggerType, setTriggerType] = useState<AutomationTriggerType>('row_created');
  const [triggerColumnId, setTriggerColumnId] = useState(''); const [scheduleRecurrence, setScheduleRecurrence] = useState<'daily'|'weekly'|'monthly'|'yearly'>('daily');
  const [scheduleAt, setScheduleAt] = useState(''); const [conditionEnabled, setConditionEnabled] = useState(false);
  const [conditionColumnId, setConditionColumnId] = useState(''); const [conditionOp, setConditionOp] = useState<FilterOp>('equals'); const [conditionValue, setConditionValue] = useState('');
  const [actionType, setActionType] = useState<ActionType>('set_property'); const [actionColumnId, setActionColumnId] = useState('');
  const [actionValue, setActionValue] = useState(''); const [relationColumnId, setRelationColumnId] = useState(''); const [notifyTitle, setNotifyTitle] = useState('Nodus');
  const [webhookUrl, setWebhookUrl] = useState(''); const [webhookMethod, setWebhookMethod] = useState<'POST'|'PUT'|'PATCH'>('POST');
  const [maxAttempts, setMaxAttempts] = useState(3); const [retryDelayMs, setRetryDelayMs] = useState(250); const [manualRowId, setManualRowId] = useState('');

  const [formName, setFormName] = useState(''); const [formSlug, setFormSlug] = useState(''); const [formDescription, setFormDescription] = useState('');
  const [formAccess, setFormAccess] = useState<'public'|'authenticated'>('public'); const [formToken, setFormToken] = useState('');
  const [formFieldIds, setFormFieldIds] = useState<string[]>([]); const [requiredFieldIds, setRequiredFieldIds] = useState<string[]>([]);
  const [rateCount, setRateCount] = useState(10); const [rateMinutes, setRateMinutes] = useState(60); const [openSubmissions, setOpenSubmissions] = useState<Record<string, number>>({});

  const editableColumns = useMemo(() => columns.filter((column) => !isReadOnlyDatabaseProperty(column.type)
    && !['formula','rollup','ai','ai_image','comparison'].includes(column.type)), [columns]);
  const formColumns = useMemo(() => editableColumns.filter((column) => !['button','relation','attachment','files'].includes(column.type)), [editableColumns]);
  const buttonColumns = columns.filter((column) => column.type === 'button');
  const relationColumns = columns.filter((column) => column.type === 'relation' && column.config.relationTargetKind === 'db_row');
  const rowTitle = useCallback((rowId: string | null) => rows.find((row) => row.id === rowId)?.cells[columns.find((column) => column.type === 'title')?.id ?? ''] || rowId?.slice(0, 10) || t('Sin fila'), [columns, rows]);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextRules, nextRuns, nextForms, page, status] = await Promise.all([
        window.nodus.listDatabaseAutomationRules(databaseId), window.nodus.listDatabaseAutomationRuns(databaseId, 100),
        window.nodus.listDatabaseForms(databaseId), window.nodus.queryDatabaseRows({ databaseId, limit: 200 }), window.nodus.getDatabaseFormServerStatus(),
      ]);
      setRules(nextRules); setRuns(nextRuns); setForms(nextForms); setRows(page.rows); setServerOrigin(status.origin);
    } catch (cause) { setError(cleanError(cause)); } finally { setLoading(false); }
  }, [databaseId]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);

  const run = async (action: () => Promise<unknown>, message?: string) => {
    setBusy(true); setError(null); try { await action(); await reload(); onChanged(); if (message) toast(message); }
    catch (cause) { setError(cleanError(cause)); } finally { setBusy(false); }
  };

  const buildAction = (): AutomationAction => {
    if (actionType === 'set_property') return { type: actionType, columnId: actionColumnId, value: { type: 'template', template: actionValue } };
    if (actionType === 'create_page') return { type: actionType, databaseId, properties: actionColumnId ? { [actionColumnId]: { type: 'template', template: actionValue } } : {}, blocks: actionValue ? [{ type: 'paragraph', content: { text: actionValue } }] : [] };
    if (actionType === 'update_related') return { type: actionType, relationColumnId, changes: [{ columnId: actionColumnId, value: { type: 'template', template: actionValue } }] };
    if (actionType === 'notify') return { type: actionType, title: notifyTitle, body: actionValue };
    return { type: actionType, url: webhookUrl, method: webhookMethod, headers: { 'content-type': 'application/json' }, body: actionValue || '{"rowId":"{{row.id}}"}' };
  };
  const createRule = () => run(async () => {
    const trigger = triggerType === 'property_changed' ? { type: triggerType, columnId: triggerColumnId || null } as const
      : triggerType === 'button' ? { type: triggerType, columnId: triggerColumnId } as const
      : triggerType === 'schedule' ? { type: triggerType, recurrence: scheduleRecurrence, nextRunAt: localIso(scheduleAt), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } as const
      : { type: 'row_created' as const };
    await window.nodus.createDatabaseAutomationRule(databaseId, {
      name, trigger, condition: conditionEnabled && conditionColumnId ? { type: 'condition', columnId: conditionColumnId, op: conditionOp, value: conditionValue } : null,
      actions: [buildAction()], maxAttempts, retryDelayMs, maxDepth: 5,
    });
    setName(''); setActionValue(''); setWebhookUrl('');
  }, t('Automatización creada.'));

  const toggleRule = (rule: AutomationRule) => run(async () => {
    const result = await window.nodus.updateDatabaseAutomationRule(rule.id, { enabled: !rule.enabled }, rule.revision);
    if (!result.ok) throw new Error(t('La automatización cambió en otro cliente. Recarga e inténtalo de nuevo.'));
  });
  const deleteRule = (rule: AutomationRule) => run(async () => {
    if (!await window.nodus.deleteDatabaseAutomationRule(rule.id, rule.revision)) throw new Error(t('La automatización cambió antes de eliminarla.'));
  }, t('Automatización eliminada.'));
  const manualRun = (rule: AutomationRule) => run(async () => {
    const result = await window.nodus.runDatabaseAutomationRule(rule.id, manualRowId || null);
    if (result.status === 'failed') throw new Error(result.error || t('La ejecución ha fallado.'));
  }, t('Automatización ejecutada.'));

  const toggleField = (columnId: string) => setFormFieldIds((current) => current.includes(columnId) ? current.filter((id) => id !== columnId) : [...current, columnId]);
  const createForm = () => run(async () => {
    const input: CreateFormDefinitionInput = {
      name: formName, slug: formSlug, title: formName, description: formDescription, access: formAccess,
      authToken: formAccess === 'authenticated' ? formToken : null, rateLimitCount: rateCount, rateLimitMinutes: rateMinutes,
      confirmationTitle: t('Respuesta enviada'), confirmationBody: t('Gracias. Tu respuesta se ha guardado.'),
      fields: formFieldIds.map((columnId, position) => ({ columnId, label: columns.find((column) => column.id === columnId)?.name ?? columnId,
        description: null, required: requiredFieldIds.includes(columnId), width: position % 3 === 1 ? 'half' : 'full' })),
    };
    await window.nodus.createDatabaseForm(databaseId, input); setFormName(''); setFormSlug(''); setFormDescription(''); setFormToken(''); setFormFieldIds([]); setRequiredFieldIds([]);
  }, t('Formulario publicado.'));

  const tabs: Array<[Tab,string]> = [['rules', t('Automatizaciones')], ['runs', t('Ejecuciones')], ['forms', t('Formularios')]];
  const field = 'grid gap-1 text-xs';
  const needsColumn = actionType === 'set_property' || actionType === 'create_page' || actionType === 'update_related';
  const ruleReady = Boolean(name.trim() && (triggerType !== 'button' || triggerColumnId) && (triggerType !== 'schedule' || scheduleAt)
    && (!needsColumn || actionColumnId) && (actionType !== 'update_related' || relationColumnId) && (actionType !== 'webhook' || webhookUrl));

  return createPortal(<div className="fixed inset-0 z-[185] grid place-items-center bg-black/60 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="database-automation-title" data-testid="database-automation-workspace" className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-neutral-300 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
      <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-4 sm:px-5 dark:border-neutral-800">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"><Icon name="wand" /></span>
        <div className="min-w-0 flex-1"><h2 id="database-automation-title" className="truncate font-semibold">{t('Automatizaciones y formularios')}</h2><p className="text-xs text-neutral-600 dark:text-neutral-400">{t('Convierte cambios, horarios y respuestas en flujos de trabajo seguros.')}</p></div>
        <button type="button" className="btn btn-ghost h-10 w-10 p-0" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" /></button>
      </header>
      <div role="tablist" aria-label={t('Áreas de automatización')} className="flex shrink-0 gap-1 overflow-x-auto border-b border-neutral-200 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-neutral-800">
        {tabs.map(([id,label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={`min-h-10 shrink-0 rounded-lg px-3 text-sm ${tab === id ? 'bg-violet-100 font-semibold text-violet-950 dark:bg-violet-950 dark:text-violet-100' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5" tabIndex={0}>
        {loading && <div role="status" data-testid="database-automation-loading" className="grid min-h-64 place-items-center text-sm text-neutral-600 dark:text-neutral-300"><span className="flex items-center gap-2"><Icon name="sync" className="animate-spin" />{t('Cargando automatizaciones…')}</span></div>}
        {error && <div role="alert" data-testid="database-automation-error" className="mb-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}

        {!loading && tab === 'rules' && <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]" data-testid="database-automation-rules-panel">
          <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800"><h3 className="font-semibold">{t('Nueva automatización')}</h3><p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{t('Combina un disparador, una condición opcional y una acción idempotente.')}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className={`${field} sm:col-span-2`}><span>{t('Nombre')}</span><input data-testid="automation-name" className="input h-10" value={name} onChange={(event) => setName(event.target.value)} /></label>
              <label className={field}><span>{t('Cuando ocurra')}</span><select data-testid="automation-trigger" className="input h-10" value={triggerType} onChange={(event) => { setTriggerType(event.target.value as AutomationTriggerType); setTriggerColumnId(''); }}>{Object.entries(triggerLabels).map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
              {(triggerType === 'property_changed' || triggerType === 'button') && <label className={field}><span>{t('Propiedad del disparador')}</span><select className="input h-10" value={triggerColumnId} onChange={(event) => setTriggerColumnId(event.target.value)}><option value="">{triggerType === 'property_changed' ? t('Cualquier propiedad') : t('Selecciona una propiedad')}</option>{(triggerType === 'button' ? buttonColumns : columns).map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>}
              {triggerType === 'schedule' && <><label className={field}><span>{t('Recurrencia')}</span><select className="input h-10" value={scheduleRecurrence} onChange={(event) => setScheduleRecurrence(event.target.value as typeof scheduleRecurrence)}>{['daily','weekly','monthly','yearly'].map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></label><label className={field}><span>{t('Primera ejecución')}</span><input className="input h-10" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /></label></>}
              <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={conditionEnabled} onChange={(event) => setConditionEnabled(event.target.checked)} />{t('Ejecutar sólo si se cumple una condición')}</label>
              {conditionEnabled && <><label className={field}><span>{t('Propiedad')}</span><select data-testid="automation-condition-column" className="input h-10" value={conditionColumnId} onChange={(event) => setConditionColumnId(event.target.value)}><option value="">{t('Selecciona una propiedad')}</option>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><label className={field}><span>{t('Operador')}</span><select data-testid="automation-condition-operator" className="input h-10" value={conditionOp} onChange={(event) => setConditionOp(event.target.value as FilterOp)}>{(['equals','notEquals','contains','notContains','isEmpty','notEmpty'] as FilterOp[]).map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></label><label className={`${field} sm:col-span-2`}><span>{t('Valor de la condición')}</span><input data-testid="automation-condition-value" className="input h-10" disabled={conditionOp === 'isEmpty' || conditionOp === 'notEmpty'} value={conditionValue} onChange={(event) => setConditionValue(event.target.value)} /></label></>}
            </div>
            <div className="my-5 border-t border-neutral-200 dark:border-neutral-800" />
            <div className="grid gap-3 sm:grid-cols-2"><label className={field}><span>{t('Entonces')}</span><select data-testid="automation-action" className="input h-10" value={actionType} onChange={(event) => setActionType(event.target.value as ActionType)}>{Object.entries(actionLabels).map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
              {actionType === 'update_related' && <label className={field}><span>{t('Relación')}</span><select className="input h-10" value={relationColumnId} onChange={(event) => setRelationColumnId(event.target.value)}><option value="">{t('Selecciona una relación')}</option>{relationColumns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>}
              {needsColumn && <label className={field}><span>{actionType === 'create_page' ? t('Propiedad inicial') : t('Propiedad que se modificará')}</span><select data-testid="automation-action-column" className="input h-10" value={actionColumnId} onChange={(event) => setActionColumnId(event.target.value)}><option value="">{t('Selecciona una propiedad')}</option>{editableColumns.filter((column) => column.type !== 'button' && column.type !== 'relation').map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>}
              {actionType === 'notify' && <label className={field}><span>{t('Título de la notificación')}</span><input className="input h-10" value={notifyTitle} onChange={(event) => setNotifyTitle(event.target.value)} /></label>}
              {actionType === 'webhook' && <><label className={field}><span>{t('Método')}</span><select className="input h-10" value={webhookMethod} onChange={(event) => setWebhookMethod(event.target.value as typeof webhookMethod)}><option>POST</option><option>PUT</option><option>PATCH</option></select></label><label className={`${field} sm:col-span-2`}><span>{t('URL del webhook')}</span><input className="input h-10" type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="http://127.0.0.1:…" /></label></>}
              <label className={`${field} sm:col-span-2`}><span>{actionType === 'webhook' ? t('Cuerpo JSON') : actionType === 'notify' ? t('Mensaje') : t('Valor o plantilla')}</span><textarea className="input min-h-20 resize-y p-3" value={actionValue} onChange={(event) => setActionValue(event.target.value)} placeholder="{{row.title}}" /></label>
              <label className={field}><span>{t('Intentos máximos')}</span><input className="input h-10" type="number" min="1" max="10" value={maxAttempts} onChange={(event) => setMaxAttempts(Number(event.target.value))} /></label><label className={field}><span>{t('Espera entre intentos (ms)')}</span><input className="input h-10" type="number" min="0" max="60000" value={retryDelayMs} onChange={(event) => setRetryDelayMs(Number(event.target.value))} /></label>
            </div><button type="button" data-testid="create-database-automation" className="btn btn-primary mt-4 min-h-10 gap-2" disabled={busy || !ruleReady} onClick={() => void createRule()}><Icon name="plus" />{t('Crear automatización')}</button>
          </section>
          <section><h3 className="mb-3 font-semibold">{t('Reglas activas')}</h3><label className={`${field} mb-3`}><span>{t('Fila para ejecución manual')}</span><select className="input h-10" value={manualRowId} onChange={(event) => setManualRowId(event.target.value)}><option value="">{t('Sin fila')}</option>{rows.map((row) => <option key={row.id} value={row.id}>{rowTitle(row.id)}</option>)}</select></label><div className="grid gap-2">
            {rules.map((rule) => <article key={rule.id} data-testid="database-automation-card" className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="flex items-start gap-2"><span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${rule.enabled ? 'bg-emerald-500' : 'bg-neutral-400'}`} /><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{rule.name}</strong><span className="text-xs text-neutral-600 dark:text-neutral-400">{t(triggerLabels[rule.trigger.type])} · {tx('{n} acciones', { n: rule.actions.length })}</span></div><button type="button" className="btn btn-ghost h-9 w-9 p-0 text-rose-700 dark:text-rose-300" aria-label={`${t('Eliminar')} ${rule.name}`} onClick={() => void deleteRule(rule)}><Icon name="trash" /></button></div><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" className="btn btn-ghost min-h-9 justify-center border border-neutral-200 dark:border-neutral-800" disabled={busy} onClick={() => void toggleRule(rule)}>{rule.enabled ? t('Pausar') : t('Activar')}</button><button type="button" className="btn btn-ghost min-h-9 justify-center border border-neutral-200 dark:border-neutral-800" disabled={busy || (rule.trigger.type !== 'schedule' && !manualRowId)} onClick={() => void manualRun(rule)}><Icon name="play" size={12} />{t('Ejecutar')}</button></div></article>)}
            {!rules.length && <div data-testid="database-automation-empty" className="grid min-h-44 place-items-center rounded-xl border border-dashed border-neutral-300 p-5 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">{t('Todavía no hay automatizaciones en esta base.')}</div>}
          </div></section>
        </div>}

        {!loading && tab === 'runs' && <section data-testid="database-automation-runs-panel"><div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="font-semibold">{t('Registro de ejecuciones')}</h3><p className="text-xs text-neutral-600 dark:text-neutral-400">{t('Cada evento conserva estado, intentos, acciones y errores.')}</p></div><button className="btn btn-ghost min-h-9 border border-neutral-200 dark:border-neutral-800" onClick={() => void reload()}><Icon name="refresh" />{t('Actualizar')}</button></div><div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-neutral-50 text-xs dark:bg-neutral-900"><tr><th className="p-3">{t('Estado')}</th><th className="p-3">{t('Regla')}</th><th className="p-3">{t('Fila')}</th><th className="p-3">{t('Intentos')}</th><th className="p-3">{t('Acciones')}</th><th className="p-3">{t('Inicio')}</th></tr></thead><tbody>{runs.map((item) => <tr key={item.id} className="border-t border-neutral-200 dark:border-neutral-800"><td className="p-3"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusStyles[item.status]}`}>{t(item.status)}</span></td><td className="max-w-48 truncate p-3">{rules.find((rule) => rule.id === item.ruleId)?.name ?? item.ruleId.slice(0,10)}</td><td className="max-w-44 truncate p-3">{rowTitle(item.rowId)}</td><td className="p-3 font-mono">{item.attempt}</td><td className="p-3 font-mono">{item.actionsCompleted}</td><td className="whitespace-nowrap p-3 text-xs">{new Date(item.startedAt).toLocaleString()}</td></tr>)}</tbody></table>{!runs.length && <div className="grid min-h-44 place-items-center text-sm text-neutral-600 dark:text-neutral-300">{t('Aún no se ha ejecutado ninguna regla.')}</div>}</div></section>}

        {!loading && tab === 'forms' && <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(20rem,.95fr)]" data-testid="database-forms-panel">
          <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800"><h3 className="font-semibold">{t('Nuevo formulario')}</h3><p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{serverOrigin ? tx('Servidor local activo en {origin}', { origin: serverOrigin }) : t('El servidor de formularios no está disponible.')}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className={field}><span>{t('Nombre')}</span><input data-testid="form-name" className="input h-10" value={formName} onChange={(event) => { setFormName(event.target.value); if (!formSlug) setFormSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'-')); }} /></label><label className={field}><span>{t('Ruta pública')}</span><input data-testid="form-slug" className="input h-10" value={formSlug} onChange={(event) => setFormSlug(event.target.value)} /></label><label className={`${field} sm:col-span-2`}><span>{t('Descripción')}</span><textarea className="input min-h-20 resize-y p-3" value={formDescription} onChange={(event) => setFormDescription(event.target.value)} /></label><label className={field}><span>{t('Acceso')}</span><select className="input h-10" value={formAccess} onChange={(event) => setFormAccess(event.target.value as typeof formAccess)}><option value="public">{t('Público')}</option><option value="authenticated">{t('Con token')}</option></select></label>{formAccess === 'authenticated' && <label className={field}><span>{t('Token de acceso')}</span><input className="input h-10" type="password" value={formToken} onChange={(event) => setFormToken(event.target.value)} /></label>}<label className={field}><span>{t('Envíos permitidos')}</span><input className="input h-10" type="number" min="1" max="1000" value={rateCount} onChange={(event) => setRateCount(Number(event.target.value))} /></label><label className={field}><span>{t('Ventana de tiempo (min)')}</span><input className="input h-10" type="number" min="1" value={rateMinutes} onChange={(event) => setRateMinutes(Number(event.target.value))} /></label></div>
            <fieldset className="mt-4 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><legend className="px-1 text-xs font-semibold">{t('Campos visibles')}</legend><div className="grid gap-2 sm:grid-cols-2">{formColumns.map((column) => <div key={column.id} className="flex min-h-10 items-center gap-2 rounded-lg bg-neutral-50 px-2 dark:bg-neutral-900"><label className="flex min-w-0 flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={formFieldIds.includes(column.id)} onChange={() => toggleField(column.id)} /><span className="truncate">{column.name}</span></label>{formFieldIds.includes(column.id) && <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={requiredFieldIds.includes(column.id)} onChange={(event) => setRequiredFieldIds((current) => event.target.checked ? [...new Set([...current,column.id])] : current.filter((id) => id !== column.id))} />{t('Obligatorio')}</label>}</div>)}</div></fieldset><button type="button" data-testid="create-database-form" className="btn btn-primary mt-4 min-h-10 gap-2" disabled={busy || !formName.trim() || !formSlug.trim() || !formFieldIds.length || (formAccess === 'authenticated' && !formToken)} onClick={() => void createForm()}><Icon name="plus" />{t('Publicar formulario')}</button>
          </section>
          <section><h3 className="mb-3 font-semibold">{t('Formularios publicados')}</h3><div className="grid gap-2">{forms.map((form) => { const url = serverOrigin ? `${serverOrigin}/forms/${form.slug}` : null; return <article key={form.id} data-testid="database-form-card" className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="flex items-start gap-2"><span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"><Icon name="fileText" size={15} /></span><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{form.name}</strong><span className="text-xs text-neutral-600 dark:text-neutral-400">{form.access === 'public' ? t('Público') : t('Con token')} · {tx('{n} respuestas', { n: form.submissionCount })}</span></div><button type="button" className="btn btn-ghost h-9 w-9 p-0 text-rose-700 dark:text-rose-300" aria-label={`${t('Eliminar')} ${form.name}`} onClick={() => void run(async () => { if (!await window.nodus.deleteDatabaseForm(form.id, form.revision)) throw new Error(t('El formulario cambió antes de eliminarlo.')); }, t('Formulario eliminado.'))}><Icon name="trash" /></button></div>{url && <div className="mt-3 flex gap-2"><a href={url} target="_blank" rel="noreferrer" className="btn btn-ghost min-h-9 flex-1 justify-center border border-neutral-200 text-xs dark:border-neutral-800"><Icon name="external" size={12} />{t('Abrir')}</a><button className="btn btn-ghost min-h-9 flex-1 justify-center border border-neutral-200 text-xs dark:border-neutral-800" onClick={() => void navigator.clipboard.writeText(url).then(() => toast(t('Enlace copiado.')))}><Icon name="copy" size={12} />{t('Copiar enlace')}</button></div>}<button type="button" className="mt-2 min-h-9 w-full rounded-lg text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900" onClick={() => void window.nodus.listDatabaseFormSubmissions(form.id,100).then((items) => setOpenSubmissions((current) => ({...current,[form.id]:items.length})))}>{openSubmissions[form.id] == null ? t('Ver respuestas') : tx('{n} respuestas aceptadas', { n: openSubmissions[form.id] })}</button></article>; })}{!forms.length && <div data-testid="database-form-empty" className="grid min-h-44 place-items-center rounded-xl border border-dashed border-neutral-300 p-5 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">{t('Todavía no hay formularios publicados.')}</div>}</div></section>
        </div>}
      </main>
      <footer className="flex items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3 text-xs text-neutral-600 sm:px-5 dark:border-neutral-800 dark:text-neutral-400"><span>{tx('{n} reglas · {m} formularios · {r} ejecuciones', { n: rules.length, m: forms.length, r: runs.length })}</span><button type="button" className="btn btn-ghost min-h-9" onClick={onClose}>{t('Cerrar')}</button></footer>
    </div>
  </div>, document.body);
}
