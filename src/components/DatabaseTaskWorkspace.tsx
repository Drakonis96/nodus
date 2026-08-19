import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DatabaseColumn } from '@shared/databases';
import type { DatabaseRowDependency, DatabaseRowHierarchyItem, DatabaseRowTemplate, DatabaseSprint, DatabaseTaskConfig, DatabaseTemplateRecurrence } from '@shared/databaseTasks';
import { Icon } from './ui';
import { t, tx } from '../i18n';
import { toast } from './feedback';

type Tab = 'templates' | 'subitems' | 'dependencies' | 'sprints';
const recurrenceLabels = { none: 'Ninguna', daily: 'Diaria', weekly: 'Semanal', monthly: 'Mensual', yearly: 'Anual' } as const;
const subitemViewLabels = { nested: 'Anidada', flat: 'Plana' } as const;
const sprintStateLabels = { planned: 'Planificado', active: 'Activo', completed: 'Completado' } as const;

function localIso(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

export function DatabaseTaskWorkspace({ databaseId, columns, onClose, onChanged }: {
  databaseId: string;
  columns: DatabaseColumn[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>('templates');
  const [templates, setTemplates] = useState<DatabaseRowTemplate[]>([]);
  const [hierarchy, setHierarchy] = useState<DatabaseRowHierarchyItem[]>([]);
  const [dependencies, setDependencies] = useState<DatabaseRowDependency[]>([]);
  const [sprints, setSprints] = useState<DatabaseSprint[]>([]);
  const [config, setConfig] = useState<DatabaseTaskConfig | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState(''); const [templateTitle, setTemplateTitle] = useState('');
  const [templateIcon, setTemplateIcon] = useState('📋'); const [templateContent, setTemplateContent] = useState('');
  const [templateRecurrence, setTemplateRecurrence] = useState<DatabaseTemplateRecurrence>('none');
  const [templateNextRun, setTemplateNextRun] = useState(''); const [templateStatus, setTemplateStatus] = useState('');
  const [templateRelationColumn, setTemplateRelationColumn] = useState(''); const [templateRelationTarget, setTemplateRelationTarget] = useState('');
  const [childId, setChildId] = useState(''); const [parentId, setParentId] = useState('');
  const [duplicateId, setDuplicateId] = useState(''); const [duplicateContent, setDuplicateContent] = useState(true); const [duplicateChildren, setDuplicateChildren] = useState(false);
  const [predecessorId, setPredecessorId] = useState(''); const [successorId, setSuccessorId] = useState(''); const [lagDays, setLagDays] = useState(0);
  const [shiftRowId, setShiftRowId] = useState('');
  const [sprintName, setSprintName] = useState(''); const [sprintStart, setSprintStart] = useState(''); const [sprintEnd, setSprintEnd] = useState('');
  const [sprintId, setSprintId] = useState(''); const [sprintRowId, setSprintRowId] = useState('');

  const titleColumn = columns.find((column) => column.type === 'title');
  const statusColumn = columns.find((column) => column.id === config?.statusColumnId) ?? columns.find((column) => column.type === 'status' || column.type === 'select');
  const relationColumns = columns.filter((column) => column.type === 'relation' && column.config.relationTargetKind === 'db_row'
    && (!column.config.relationTargetDatabaseId || column.config.relationTargetDatabaseId === databaseId));
  const rowLabel = useCallback((rowId: string) => hierarchy.find((item) => item.rowId === rowId)?.title || rowId.slice(0, 12), [hierarchy]);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextTemplates, nextHierarchy, nextDependencies, nextSprints, nextConfig] = await Promise.all([
        window.nodus.listDatabaseRowTemplates(databaseId), window.nodus.listDatabaseRowHierarchy(databaseId, 500),
        window.nodus.listDatabaseRowDependencies(databaseId), window.nodus.listDatabaseSprints(databaseId),
        window.nodus.getDatabaseTaskConfig(databaseId),
      ]);
      setTemplates(nextTemplates); setHierarchy(nextHierarchy); setDependencies(nextDependencies); setSprints(nextSprints); setConfig(nextConfig);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, [databaseId]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);

  const run = async (action: () => Promise<unknown>, message?: string) => {
    setBusy(true); setError(null);
    try { await action(); await reload(); onChanged(); if (message) toast(message); }
    catch (cause) { setError((cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': Error:\s*/, '')); }
    finally { setBusy(false); }
  };

  const createTemplate = () => run(async () => {
    const properties: Record<string, string | null> = {};
    if (titleColumn && templateTitle.trim()) properties[titleColumn.id] = templateTitle.trim();
    if (statusColumn && templateStatus) properties[statusColumn.id] = templateStatus;
    await window.nodus.createDatabaseRowTemplate(databaseId, {
      name: templateName, icon: templateIcon.trim() || null, properties,
      blocks: templateContent.trim() ? [{ type: 'paragraph', content: { text: templateContent.trim() } }] : [],
      defaultRelations: templateRelationColumn && templateRelationTarget ? [{ columnId: templateRelationColumn, targetKind: 'db_row', targetId: templateRelationTarget }] : [],
      recurrence: templateRecurrence, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      nextRunAt: templateRecurrence === 'none' ? null : localIso(templateNextRun),
    });
    setTemplateName(''); setTemplateTitle(''); setTemplateContent(''); setTemplateStatus(''); setTemplateRelationTarget('');
  }, t('Plantilla creada.'));

  const updateConfig = (patch: Parameters<typeof window.nodus.updateDatabaseTaskConfig>[1]) => run(async () => {
    setConfig(await window.nodus.updateDatabaseTaskConfig(databaseId, patch));
  }, t('Configuración de tareas guardada.'));

  const tabs: Array<[Tab, string]> = [['templates', t('Plantillas')], ['subitems', t('Subtareas')], ['dependencies', t('Dependencias')], ['sprints', t('Sprints')]];
  const rowOptions = (exclude = '') => <>{hierarchy.filter((row) => row.rowId !== exclude).map((row) => <option key={row.rowId} value={row.rowId}>{row.title || t('Sin título')}</option>)}</>;
  const field = 'grid gap-1 text-xs';

  return createPortal(<div className="fixed inset-0 z-[180] grid place-items-center bg-black/60 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="database-task-workspace-title" className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-neutral-300 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950" data-testid="database-task-workspace">
      <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-4 sm:px-5 dark:border-neutral-800">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><Icon name="check" /></span>
        <div className="min-w-0 flex-1"><h2 id="database-task-workspace-title" className="truncate font-semibold">{t('Proyectos, plantillas y sprints')}</h2><p className="text-xs text-neutral-600 dark:text-neutral-400">{t('Organiza trabajo repetible sin abandonar tu base de datos.')}</p></div>
        <button type="button" className="btn btn-ghost h-10 w-10 p-0" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" /></button>
      </header>
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-neutral-200 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-neutral-800" role="tablist" aria-label={t('Áreas de proyectos')}>
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={`min-h-10 shrink-0 rounded-lg px-3 text-sm ${tab === id ? 'bg-emerald-100 font-semibold text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5" tabIndex={0}>
        {loading && <div role="status" data-testid="database-task-loading" className="grid min-h-64 place-items-center text-sm text-neutral-600 dark:text-neutral-300"><span className="flex items-center gap-2"><Icon name="sync" className="animate-spin" />{t('Cargando configuración de proyectos…')}</span></div>}
        {error && <div role="alert" data-testid="database-task-error" className="mb-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}

        {!loading && tab === 'templates' && <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,.85fr)]" data-testid="database-template-panel">
          <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800"><h3 className="font-semibold">{t('Nueva plantilla de fila y página')}</h3><p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{t('Guarda propiedades, contenido, icono y relaciones predeterminadas.')}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className={field}><span>{t('Nombre de la plantilla')}</span><input className="input h-10" value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></label>
              <label className={field}><span>{t('Icono')}</span><input className="input h-10" value={templateIcon} onChange={(event) => setTemplateIcon(event.target.value)} /></label>
              <label className={field}><span>{t('Título predeterminado')}</span><input className="input h-10" value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} /></label>
              <label className={field}><span>{t('Estado predeterminado')}</span><select className="input h-10" value={templateStatus} onChange={(event) => setTemplateStatus(event.target.value)}><option value="">{t('Sin valor')}</option>{statusColumn?.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              <label className={`${field} sm:col-span-2`}><span>{t('Contenido inicial de la página')}</span><textarea className="input min-h-24 resize-y p-3" value={templateContent} onChange={(event) => setTemplateContent(event.target.value)} /></label>
              <label className={field}><span>{t('Relación predeterminada')}</span><select className="input h-10" value={templateRelationColumn} onChange={(event) => setTemplateRelationColumn(event.target.value)}><option value="">{t('Sin relación')}</option>{relationColumns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
              <label className={field}><span>{t('Fila relacionada')}</span><select className="input h-10" disabled={!templateRelationColumn} value={templateRelationTarget} onChange={(event) => setTemplateRelationTarget(event.target.value)}><option value="">{t('Selecciona una fila')}</option>{rowOptions()}</select></label>
              <label className={field}><span>{t('Recurrencia')}</span><select className="input h-10" value={templateRecurrence} onChange={(event) => setTemplateRecurrence(event.target.value as DatabaseTemplateRecurrence)}>{(['none','daily','weekly','monthly','yearly'] as const).map((value) => <option key={value} value={value}>{t(recurrenceLabels[value])}</option>)}</select></label>
              <label className={field}><span>{t('Próxima ejecución')}</span><input className="input h-10" type="datetime-local" disabled={templateRecurrence === 'none'} value={templateNextRun} onChange={(event) => setTemplateNextRun(event.target.value)} /></label>
            </div><button type="button" data-testid="create-database-template" className="btn btn-primary mt-4 min-h-10 gap-2" disabled={busy || !templateName.trim() || (templateRecurrence !== 'none' && !templateNextRun)} onClick={() => void createTemplate()}><Icon name="plus" />{t('Crear plantilla')}</button>
          </section>
          <section><h3 className="mb-3 font-semibold">{t('Plantillas disponibles')}</h3><div className="grid gap-2">
            {templates.map((item) => <article key={item.id} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800" data-testid="database-template-card"><div className="flex items-start gap-2"><span className="text-xl">{item.icon || '📄'}</span><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.name}</strong><span className="text-xs text-neutral-600 dark:text-neutral-400">{item.recurrence === 'none' ? t('Sin recurrencia') : tx('Repite: {value}', { value: t(recurrenceLabels[item.recurrence]) })}</span></div><button type="button" className="btn btn-ghost h-9 w-9 p-0 text-rose-700 dark:text-rose-300" aria-label={`${t('Eliminar')} ${item.name}`} onClick={() => void run(() => window.nodus.deleteDatabaseRowTemplate(item.id))}><Icon name="trash" /></button></div><button type="button" className="btn btn-ghost mt-3 min-h-9 w-full justify-center border border-neutral-200 dark:border-neutral-800" disabled={busy} onClick={() => void run(() => window.nodus.instantiateDatabaseRowTemplate(item.id), t('Página creada desde plantilla.'))}>{t('Crear página ahora')}</button></article>)}
            {!templates.length && <div data-testid="database-template-empty" className="grid min-h-40 place-items-center rounded-xl border border-dashed border-neutral-300 p-5 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">{t('Todavía no hay plantillas en esta base.')}</div>}
          </div></section>
        </div>}

        {!loading && tab === 'subitems' && <div className="grid gap-5 lg:grid-cols-2" data-testid="database-subitems-panel">
          <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800"><h3 className="font-semibold">{t('Jerarquía de subtareas')}</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className={field}><span>{t('Subtarea')}</span><select className="input h-10" value={childId} onChange={(event) => setChildId(event.target.value)}><option value="">{t('Selecciona una fila')}</option>{rowOptions()}</select></label><label className={field}><span>{t('Tarea principal')}</span><select className="input h-10" value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">{t('Sin tarea principal')}</option>{rowOptions(childId)}</select></label></div><button type="button" className="btn btn-primary mt-3 min-h-10" disabled={busy || !childId} onClick={() => void run(() => window.nodus.setDatabaseSubitemParent(childId, parentId || null), t('Jerarquía actualizada.'))}>{t('Guardar jerarquía')}</button>
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-neutral-50 p-3 text-xs dark:bg-neutral-900"><span className="font-medium">{t('Visualización')}</span>{(['nested','flat'] as const).map((value) => <label key={value} className="flex items-center gap-1"><input type="radio" name="subitem-view" checked={config?.subitemView === value} onChange={() => void updateConfig({ subitemView: value })} />{t(subitemViewLabels[value])}</label>)}</div>
            <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800">{hierarchy.map((row) => <div key={row.rowId} className="flex min-h-10 items-center gap-2 border-b border-neutral-200 px-3 last:border-0 dark:border-neutral-800" style={{ paddingLeft: `${12 + (config?.subitemView === 'nested' ? Math.min(8, row.depth) * 18 : 0)}px` }}><button type="button" className="grid h-8 w-8 place-items-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={row.collapsed ? t('Expandir subtareas') : t('Plegar subtareas')} onClick={() => void run(() => window.nodus.setDatabaseSubitemCollapsed(row.rowId, !row.collapsed))}><Icon name={row.collapsed ? 'chevronRight' : 'chevronDown'} size={13} /></button><span className="min-w-0 flex-1 truncate text-sm">{row.title || t('Sin título')}</span><span className="text-[10px] text-neutral-600 dark:text-neutral-400">{tx('Nivel {n}', { n: row.depth })}</span></div>)}</div>
          </section>
          <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800"><h3 className="font-semibold">{t('Duplicado profundo')}</h3><p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{t('Las propiedades siempre se copian; decide si incluir la página y sus subtareas.')}</p><label className={`${field} mt-4`}><span>{t('Fila original')}</span><select className="input h-10" value={duplicateId} onChange={(event) => setDuplicateId(event.target.value)}><option value="">{t('Selecciona una fila')}</option>{rowOptions()}</select></label><label className="mt-3 flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={duplicateContent} onChange={(event) => setDuplicateContent(event.target.checked)} />{t('Incluir contenido, icono y archivos')}</label><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={duplicateChildren} onChange={(event) => setDuplicateChildren(event.target.checked)} />{t('Duplicar también las subtareas')}</label><button type="button" data-testid="duplicate-database-row" className="btn btn-primary mt-3 min-h-10 gap-2" disabled={busy || !duplicateId} onClick={() => void run(() => window.nodus.duplicateDatabaseRow({ rowId: duplicateId, includeContent: duplicateContent, includeChildren: duplicateChildren }), t('Fila duplicada.'))}><Icon name="copy" />{t('Duplicar fila')}</button></section>
        </div>}

        {!loading && tab === 'dependencies' && <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,.9fr)]" data-testid="database-dependencies-panel">
          <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800"><h3 className="font-semibold">{t('Grafo de dependencias')}</h3><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_7rem]"><label className={field}><span>{t('Predecesora')}</span><select className="input h-10" value={predecessorId} onChange={(event) => setPredecessorId(event.target.value)}><option value="">{t('Selecciona una fila')}</option>{rowOptions(successorId)}</select></label><label className={field}><span>{t('Sucesora')}</span><select className="input h-10" value={successorId} onChange={(event) => setSuccessorId(event.target.value)}><option value="">{t('Selecciona una fila')}</option>{rowOptions(predecessorId)}</select></label><label className={field}><span>{t('Días de espera')}</span><input className="input h-10" type="number" min="-3650" max="3650" value={lagDays} onChange={(event) => setLagDays(Number(event.target.value))} /></label></div><button type="button" data-testid="add-database-dependency" className="btn btn-primary mt-3 min-h-10" disabled={busy || !predecessorId || !successorId} onClick={() => void run(() => window.nodus.addDatabaseRowDependency(predecessorId, successorId, lagDays), t('Dependencia creada.'))}>{t('Añadir dependencia')}</button>
            <div className="mt-4 grid gap-2">{dependencies.map((edge) => <div key={edge.id} className="flex min-h-11 items-center gap-2 rounded-xl bg-neutral-50 px-3 text-sm dark:bg-neutral-900"><span className="min-w-0 flex-1 truncate">{rowLabel(edge.predecessorRowId)} → {rowLabel(edge.successorRowId)}</span><span className="text-xs text-neutral-600 dark:text-neutral-400">{tx('{n} días', { n: edge.lagDays })}</span><button type="button" className="btn btn-ghost h-9 w-9 p-0 text-rose-700 dark:text-rose-300" aria-label={t('Quitar dependencia')} onClick={() => void run(() => window.nodus.removeDatabaseRowDependency(edge.id))}><Icon name="x" /></button></div>)}{!dependencies.length && <div className="rounded-xl border border-dashed border-neutral-300 p-5 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">{t('No hay dependencias configuradas.')}</div>}</div>
          </section>
          <section className="space-y-4"><div className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800"><h3 className="font-semibold">{t('Desplazar fechas')}</h3><label className={`${field} mt-3`}><span>{t('Tarea')}</span><select className="input h-10" value={shiftRowId} onChange={(event) => setShiftRowId(event.target.value)}><option value="">{t('Selecciona una fila')}</option>{rowOptions()}</select></label><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" className="btn btn-ghost min-h-10 justify-center border border-neutral-200 dark:border-neutral-800" disabled={!shiftRowId || !config?.dateColumnId} onClick={() => void run(() => window.nodus.shiftDatabaseTaskDates(shiftRowId, -1), t('Fechas desplazadas.'))}>−1 {t('día')}</button><button type="button" className="btn btn-ghost min-h-10 justify-center border border-neutral-200 dark:border-neutral-800" disabled={!shiftRowId || !config?.dateColumnId} onClick={() => void run(() => window.nodus.shiftDatabaseTaskDates(shiftRowId, 1), t('Fechas desplazadas.'))}>+1 {t('día')}</button></div></div>
            <div className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800"><h3 className="font-semibold">{t('Configuración de tareas')}</h3><div className="mt-3 grid gap-3"><label className={field}><span>{t('Propiedad de fecha')}</span><select className="input h-10" value={config?.dateColumnId ?? ''} onChange={(event) => void updateConfig({ dateColumnId: event.target.value || null })}><option value="">{t('Sin propiedad')}</option>{columns.filter((column) => column.type === 'date').map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><label className={field}><span>{t('Propiedad de estado')}</span><select className="input h-10" value={config?.statusColumnId ?? ''} onChange={(event) => void updateConfig({ statusColumnId: event.target.value || null })}><option value="">{t('Sin propiedad')}</option>{columns.filter((column) => column.type === 'status' || column.type === 'select').map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={config?.avoidWeekends ?? false} onChange={(event) => void updateConfig({ avoidWeekends: event.target.checked })} />{t('Evitar fines de semana')}</label><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={config?.shiftDependents ?? true} onChange={(event) => void updateConfig({ shiftDependents: event.target.checked })} />{t('Desplazar tareas dependientes')}</label></div></div>
          </section>
        </div>}

        {!loading && tab === 'sprints' && <div className="grid gap-5 lg:grid-cols-2" data-testid="database-sprints-panel">
          <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800"><h3 className="font-semibold">{t('Nuevo sprint')}</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className={`${field} sm:col-span-2`}><span>{t('Propiedad de sprint')}</span><select className="input h-10" value={config?.sprintColumnId ?? ''} onChange={(event) => void updateConfig({ sprintColumnId: event.target.value || null })}><option value="">{t('Sin propiedad')}</option>{columns.filter((column) => column.type === 'status' || column.type === 'select').map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><label className={`${field} sm:col-span-2`}><span>{t('Nombre del sprint')}</span><input className="input h-10" value={sprintName} onChange={(event) => setSprintName(event.target.value)} /></label><label className={field}><span>{t('Inicio')}</span><input className="input h-10" type="date" value={sprintStart} onChange={(event) => setSprintStart(event.target.value)} /></label><label className={field}><span>{t('Fin')}</span><input className="input h-10" type="date" value={sprintEnd} onChange={(event) => setSprintEnd(event.target.value)} /></label></div><button type="button" data-testid="create-database-sprint" className="btn btn-primary mt-3 min-h-10" disabled={busy || !sprintName.trim() || !sprintStart || !sprintEnd} onClick={() => void run(async () => { await window.nodus.createDatabaseSprint(databaseId, { name: sprintName, startAt: `${sprintStart}T00:00:00.000Z`, endAt: `${sprintEnd}T23:59:59.999Z` }); setSprintName(''); }, t('Sprint creado.'))}>{t('Crear sprint')}</button>
            <div className="mt-5 border-t border-neutral-200 pt-4 dark:border-neutral-800"><h4 className="text-sm font-semibold">{t('Asignar tarea')}</h4><div className="mt-3 grid gap-3 sm:grid-cols-2"><select aria-label={t('Sprint')} className="input h-10" value={sprintId} onChange={(event) => setSprintId(event.target.value)}><option value="">{t('Selecciona un sprint')}</option>{sprints.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label={t('Tarea')} className="input h-10" value={sprintRowId} onChange={(event) => setSprintRowId(event.target.value)}><option value="">{t('Selecciona una fila')}</option>{rowOptions()}</select></div><button type="button" className="btn btn-ghost mt-3 min-h-10 border border-neutral-200 dark:border-neutral-800" disabled={!sprintId || !sprintRowId} onClick={() => void run(() => window.nodus.assignDatabaseRowToSprint(sprintId, sprintRowId), t('Tarea asignada al sprint.'))}>{t('Asignar')}</button></div>
          </section>
          <section><h3 className="mb-3 font-semibold">{t('Sprints de esta base')}</h3><div className="grid gap-2">{sprints.map((item) => <article key={item.id} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.name}</strong><span className="text-xs text-neutral-600 dark:text-neutral-400">{item.startAt.slice(0,10)} → {item.endAt.slice(0,10)} · {tx('{n} tareas', { n: item.rowCount })}</span></div><span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-medium dark:bg-neutral-800">{t(sprintStateLabels[item.state])}</span></div><div className="mt-3 grid grid-cols-3 gap-1">{(['planned','active','completed'] as const).map((state) => <button key={state} type="button" className={`min-h-9 rounded-lg px-2 text-xs ${item.state === state ? 'bg-emerald-100 font-semibold text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'}`} onClick={() => void run(() => window.nodus.updateDatabaseSprintState(item.id, state))}>{t(sprintStateLabels[state])}</button>)}</div></article>)}{!sprints.length && <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-neutral-300 p-5 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">{t('Todavía no hay sprints.')}</div>}</div></section>
        </div>}
      </main>
      <footer className="flex items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3 text-xs text-neutral-600 sm:px-5 dark:border-neutral-800 dark:text-neutral-400"><span>{tx('{n} filas · {m} plantillas', { n: hierarchy.length, m: templates.length })}</span><button type="button" className="btn btn-ghost min-h-9" onClick={onClose}>{t('Cerrar')}</button></footer>
    </div>
  </div>, document.body);
}
