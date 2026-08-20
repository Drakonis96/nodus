import { createHash, randomUUID } from 'node:crypto';
import { getDb } from './database';
import { createRow, getColumn, getColumns, getRow, listRelations, setCell } from './databasesRepo';
import { getPageDocumentForRow, savePageDocument } from './pagesRepo';
import { matchesCondition } from '@shared/databaseFilters';
import { assertFilterNode, type FilterNode } from '@shared/databaseQuery';
import { isReadOnlyDatabaseProperty } from '@shared/databaseProperties';
import { nextDatabaseTemplateRun } from '@shared/databaseTasks';
import {
  DATABASE_AUTOMATION_VERSION,
  assertAutomationValue,
  normalizeDatabaseFormSlug,
  type AutomationAction,
  type AutomationEvent,
  type AutomationRule,
  type AutomationRuleMutationResult,
  type AutomationRun,
  type AutomationTrigger,
  type AutomationValue,
  type CreateAutomationRuleInput,
  type CreateFormDefinitionInput,
  type DatabaseFormField,
  type DatabaseFormSubmission,
  type FormDefinition,
  type FormDefinitionMutationResult,
} from '@shared/databaseAutomations';
import type { DatabaseColumn, DatabaseRow } from '@shared/databases';

type SqlRow = Record<string, unknown>;
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const json = <T>(value: unknown, fallback: T): T => { if (typeof value !== 'string') return fallback; try { return JSON.parse(value) as T; } catch { return fallback; } };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function automationRule(row: SqlRow): AutomationRule {
  return { id: String(row.id), databaseId: String(row.database_id), version: DATABASE_AUTOMATION_VERSION, name: String(row.name), enabled: Boolean(row.enabled),
    trigger: json(row.trigger_json, { type: 'row_created' }) as AutomationTrigger, condition: json<FilterNode | null>(row.condition_json, null),
    actions: json<AutomationAction[]>(row.actions_json, []), variables: json<Record<string, AutomationValue>>(row.variables_json, {}),
    maxDepth: Number(row.max_depth), maxAttempts: Number(row.max_attempts), retryDelayMs: Number(row.retry_delay_ms), revision: Number(row.revision),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function automationRun(row: SqlRow): AutomationRun {
  return { id: String(row.id), ruleId: String(row.rule_id), databaseId: String(row.database_id), rowId: row.row_id == null ? null : String(row.row_id),
    eventKey: String(row.event_key), status: String(row.status) as AutomationRun['status'], depth: Number(row.depth), attempt: Number(row.attempt),
    actionsCompleted: Number(row.actions_completed), output: json(row.output_json, null), error: row.error == null ? null : String(row.error),
    startedAt: String(row.started_at), finishedAt: row.finished_at == null ? null : String(row.finished_at) };
}

function formField(row: SqlRow): DatabaseFormField {
  return { id: String(row.id), formId: String(row.form_id), columnId: String(row.column_id), label: String(row.label),
    description: row.description == null ? null : String(row.description), required: Boolean(row.required), position: Number(row.position),
    width: String(row.width) as DatabaseFormField['width'] };
}

function formDefinition(row: SqlRow): FormDefinition {
  const fields = (getDb().prepare('SELECT * FROM database_form_fields WHERE form_id=? ORDER BY position,id').all(String(row.id)) as SqlRow[]).map(formField);
  return { id: String(row.id), databaseId: String(row.database_id), version: 1, name: String(row.name), slug: String(row.slug), title: String(row.title),
    description: String(row.description), access: String(row.access) as FormDefinition['access'], requiresAuth: row.auth_token_hash != null, fields,
    confirmationTitle: String(row.confirmation_title), confirmationBody: String(row.confirmation_body), rateLimitCount: Number(row.rate_limit_count),
    rateLimitMinutes: Number(row.rate_limit_minutes), enabled: Boolean(row.enabled), revision: Number(row.revision), submissionCount: Number(row.submission_count ?? 0),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function databaseExists(databaseId: string): void {
  if (!getDb().prepare('SELECT 1 FROM db_databases WHERE id=?').get(databaseId)) throw new Error('Base de datos no encontrada.');
}

function triggerColumnIds(trigger: AutomationTrigger): string[] {
  return trigger.type === 'property_changed' && trigger.columnId ? [trigger.columnId] : trigger.type === 'button' ? [trigger.columnId] : [];
}

function actionColumnIds(action: AutomationAction): string[] {
  if (action.type === 'set_property') return [action.columnId];
  if (action.type === 'update_related') return [action.relationColumnId, ...action.changes.map((change) => change.columnId)];
  return action.type === 'create_page' ? Object.keys(action.properties) : [];
}

function validateRuleInput(databaseId: string, input: CreateAutomationRuleInput): void {
  databaseExists(databaseId); if (!input.name?.trim()) throw new Error('La automatización necesita un nombre.');
  if (!input.trigger || !['row_created','property_changed','schedule','button'].includes(input.trigger.type)) throw new Error('Trigger de automatización no válido.');
  if (!Array.isArray(input.actions) || input.actions.length < 1 || input.actions.length > 25) throw new Error('La automatización debe contener entre 1 y 25 acciones.');
  if (input.condition) assertFilterNode(input.condition);
  const columns = new Map(getColumns(databaseId).map((column) => [column.id, column]));
  for (const columnId of triggerColumnIds(input.trigger)) if (!columns.has(columnId)) throw new Error('El trigger usa una propiedad ajena a la base.');
  if (input.trigger.type === 'button' && columns.get(input.trigger.columnId)?.type !== 'button') throw new Error('El trigger Botón necesita una propiedad Botón.');
  if (input.trigger.type === 'schedule' && (!Number.isFinite(Date.parse(input.trigger.nextRunAt)) || !['daily','weekly','monthly','yearly'].includes(input.trigger.recurrence))) throw new Error('Programación no válida.');
  for (const action of input.actions) {
    if (!action || !['set_property','create_page','update_related','notify','webhook'].includes(action.type)) throw new Error('Acción de automatización no válida.');
    for (const columnId of actionColumnIds(action)) {
      const targetDatabaseId = action.type === 'create_page' && action.databaseId ? action.databaseId : databaseId;
      const column = getColumn(columnId); if (!column || column.databaseId !== targetDatabaseId) throw new Error('Una acción usa una propiedad ajena a su base.');
      if (action.type !== 'update_related' && isReadOnlyDatabaseProperty(column.type)) throw new Error('Una acción no puede modificar una propiedad automática.');
    }
    if (action.type === 'update_related' && columns.get(action.relationColumnId)?.type !== 'relation') throw new Error('Actualizar relacionadas necesita una propiedad Relación.');
    if (action.type === 'webhook') { const url = new URL(action.url); if (!['http:','https:'].includes(url.protocol)) throw new Error('El webhook debe usar HTTP o HTTPS.'); }
    if (action.type === 'set_property') assertAutomationValue(action.value);
    if (action.type === 'create_page') for (const value of Object.values(action.properties)) assertAutomationValue(value);
    if (action.type === 'update_related') for (const change of action.changes) assertAutomationValue(change.value);
  }
  for (const value of Object.values(input.variables ?? {})) assertAutomationValue(value);
}

export function listAutomationRules(databaseId: string): AutomationRule[] {
  return (getDb().prepare('SELECT * FROM automation_rules WHERE database_id=? ORDER BY name COLLATE NOCASE,id').all(databaseId) as SqlRow[]).map(automationRule);
}

export function getAutomationRule(ruleId: string): AutomationRule | null {
  const row = getDb().prepare('SELECT * FROM automation_rules WHERE id=?').get(ruleId) as SqlRow | undefined; return row ? automationRule(row) : null;
}

export function createAutomationRule(databaseId: string, input: CreateAutomationRuleInput): AutomationRule {
  validateRuleInput(databaseId, input); const key = id('auto'); const timestamp = now();
  getDb().prepare(`INSERT INTO automation_rules
    (id,database_id,version,name,enabled,trigger_json,condition_json,actions_json,variables_json,max_depth,max_attempts,retry_delay_ms,revision,created_by,updated_by,created_at,updated_at)
    VALUES (?,?,1,?,?,?,?,?,?,?,?,?,1,'local','local',?,?)`).run(key,databaseId,input.name.trim(),input.enabled === false ? 0 : 1,JSON.stringify(input.trigger),
      input.condition ? JSON.stringify(input.condition) : null,JSON.stringify(input.actions),JSON.stringify(input.variables ?? {}),
      Math.min(20,Math.max(1,input.maxDepth ?? 5)),Math.min(10,Math.max(1,input.maxAttempts ?? 3)),Math.min(60_000,Math.max(0,input.retryDelayMs ?? 250)),timestamp,timestamp);
  return getAutomationRule(key)!;
}

export function updateAutomationRule(ruleId: string, patch: Partial<CreateAutomationRuleInput>, expectedRevision: number): AutomationRuleMutationResult {
  const current = getAutomationRule(ruleId); if (!current) throw new Error('Automatización no encontrada.'); if (current.revision !== expectedRevision) return { ok: false, conflict: true, current };
  const input: CreateAutomationRuleInput = { name: patch.name ?? current.name, enabled: patch.enabled ?? current.enabled, trigger: patch.trigger ?? current.trigger,
    condition: patch.condition === undefined ? current.condition : patch.condition, actions: patch.actions ?? current.actions, variables: patch.variables ?? current.variables,
    maxDepth: patch.maxDepth ?? current.maxDepth, maxAttempts: patch.maxAttempts ?? current.maxAttempts, retryDelayMs: patch.retryDelayMs ?? current.retryDelayMs };
  validateRuleInput(current.databaseId,input); const result = getDb().prepare(`UPDATE automation_rules SET name=?,enabled=?,trigger_json=?,condition_json=?,actions_json=?,variables_json=?,
    max_depth=?,max_attempts=?,retry_delay_ms=?,revision=revision+1,updated_by='local',updated_at=? WHERE id=? AND revision=?`).run(input.name.trim(),input.enabled === false ? 0 : 1,
      JSON.stringify(input.trigger),input.condition ? JSON.stringify(input.condition) : null,JSON.stringify(input.actions),JSON.stringify(input.variables ?? {}),
      input.maxDepth,input.maxAttempts,input.retryDelayMs,now(),ruleId,expectedRevision);
  if (!result.changes) return { ok: false, conflict: true, current: getAutomationRule(ruleId)! }; return { ok: true, rule: getAutomationRule(ruleId)! };
}

export function deleteAutomationRule(ruleId: string, expectedRevision: number): boolean {
  return getDb().prepare('DELETE FROM automation_rules WHERE id=? AND revision=?').run(ruleId,expectedRevision).changes > 0;
}

export function listAutomationRuns(databaseId: string, limit = 100): AutomationRun[] {
  const bounded = Math.min(500,Math.max(1,Math.trunc(limit))); return (getDb().prepare('SELECT * FROM automation_runs WHERE database_id=? ORDER BY started_at DESC,id DESC LIMIT ?').all(databaseId,bounded) as SqlRow[]).map(automationRun);
}

export function listAutomationNotifications(databaseId: string, limit = 100): Array<{ id: string; ruleId: string | null; runId: string | null; rowId: string | null; title: string; body: string; isRead: boolean; createdAt: string }> {
  return (getDb().prepare('SELECT * FROM automation_notifications WHERE database_id=? ORDER BY created_at DESC LIMIT ?').all(databaseId,Math.min(500,Math.max(1,limit))) as SqlRow[])
    .map((row) => ({ id:String(row.id),ruleId:row.rule_id == null ? null : String(row.rule_id),runId:row.run_id == null ? null : String(row.run_id),rowId:row.row_id == null ? null : String(row.row_id),title:String(row.title),body:String(row.body),isRead:Boolean(row.is_read),createdAt:String(row.created_at) }));
}

function matchesFilter(node: FilterNode | null, row: DatabaseRow, columns: Map<string, DatabaseColumn>): boolean {
  if (!node) return true; if (node.type === 'group') { const values = node.children.map((child) => matchesFilter(child,row,columns)); return node.operator === 'or' ? values.some(Boolean) : values.every(Boolean); }
  const column = columns.get(node.columnId); if (!column) return false; return matchesCondition(column,row,{ id:'automation',columnId:node.columnId,op:node.op,value:node.value });
}

function renderText(template: string, row: DatabaseRow | null, databaseId: string, variables: Record<string,string | null>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_all,keyValue: string) => { const key=keyValue.trim();
    if (key === 'row.id') return row?.id ?? ''; if (key === 'database.id') return databaseId; if (key === 'row.title') return row ? Object.values(row.cells).find(Boolean) ?? '' : '';
    if (key.startsWith('column:')) return row?.cells[key.slice(7)] ?? ''; if (key.startsWith('variable:')) return variables[key.slice(9)] ?? ''; return ''; });
}

function resolveValue(value: AutomationValue, row: DatabaseRow | null, databaseId: string, variables: Record<string,string | null>): string | null {
  if (value.type === 'literal') return value.value; if (value.type === 'column') return row?.cells[value.columnId] ?? null;
  return renderText(value.template,row,databaseId,variables) || null;
}

function ruleMatchesEvent(rule: AutomationRule, event: AutomationEvent): boolean {
  if (!rule.enabled || rule.databaseId !== event.databaseId || rule.trigger.type !== event.type) return false;
  if (rule.trigger.type === 'property_changed') return !rule.trigger.columnId || rule.trigger.columnId === event.columnId;
  if (rule.trigger.type === 'button') return rule.trigger.columnId === event.columnId; return true;
}

async function executeRule(rule: AutomationRule, event: AutomationEvent): Promise<AutomationRun> {
  const db=getDb(); const existing=db.prepare('SELECT * FROM automation_runs WHERE rule_id=? AND event_key=?').get(rule.id,event.eventKey) as SqlRow|undefined;
  if (existing) return automationRun(existing); const depth=event.depth ?? 0; const runId=id('arun'); const timestamp=now();
  db.prepare(`INSERT INTO automation_runs (id,rule_id,database_id,row_id,event_key,status,depth,attempt,actions_completed,output_json,error,started_at)
    VALUES (?,?,?,?,?,'running',?,1,0,'null',NULL,?)`).run(runId,rule.id,rule.databaseId,event.rowId ?? null,event.eventKey,depth,timestamp);
  let row=event.rowId ? getRow(event.rowId) : null; const columns=new Map(getColumns(rule.databaseId).map((column)=>[column.id,column]));
  if (depth >= rule.maxDepth || (event.visitedRuleIds ?? []).includes(rule.id) || (row && !matchesFilter(rule.condition,row,columns))) {
    db.prepare("UPDATE automation_runs SET status='skipped',finished_at=?,output_json=? WHERE id=?").run(now(),JSON.stringify({ reason:depth>=rule.maxDepth?'max_depth':'condition_or_loop' }),runId);
    return automationRun(db.prepare('SELECT * FROM automation_runs WHERE id=?').get(runId) as SqlRow);
  }
  const variables:Record<string,string|null>={}; for (const [name,value] of Object.entries(rule.variables)) variables[name]=resolveValue(value,row,rule.databaseId,variables);
  const outputs:unknown[]=[]; let completed=0; let lastAttempt=1;
  try {
    for (const action of rule.actions) {
      if (action.type === 'set_property') {
        if (!row) throw new Error('Modificar propiedad necesita una fila de contexto.'); const raw=resolveValue(action.value,row,rule.databaseId,variables); setCell(row.id,action.columnId,raw);
        row=getRow(row.id); outputs.push({ type:action.type,columnId:action.columnId });
        await dispatchAutomationEvent({ type:'property_changed',databaseId:rule.databaseId,rowId:row!.id,columnId:action.columnId,eventKey:`${event.eventKey}:set:${completed}`,
          depth:depth+1,visitedRuleIds:[...(event.visitedRuleIds ?? []),rule.id] });
      } else if (action.type === 'create_page') {
        const targetDatabaseId=action.databaseId ?? rule.databaseId; const created=createRow(targetDatabaseId);
        for (const [columnId,value] of Object.entries(action.properties)) setCell(created.id,columnId,resolveValue(value,row,rule.databaseId,variables));
        const document=getPageDocumentForRow(created.id); if (document && action.blocks.length) { const saved=savePageDocument({ pageId:document.page.id,expectedRevision:document.revision,blocks:action.blocks,reason:'automation' }); if (!saved.ok) throw new Error('Conflicto al crear la página automática.'); }
        outputs.push({ type:action.type,rowId:created.id }); await dispatchAutomationEvent({ type:'row_created',databaseId:targetDatabaseId,rowId:created.id,
          eventKey:`${event.eventKey}:create:${completed}`,depth:depth+1,visitedRuleIds:[...(event.visitedRuleIds ?? []),rule.id] });
      } else if (action.type === 'update_related') {
        if (!row) throw new Error('Actualizar relacionadas necesita una fila de contexto.'); const relations=listRelations(row.id,action.relationColumnId).filter((relation)=>relation.targetKind==='db_row'&&!relation.broken);
        for (const relation of relations) for (const change of action.changes) setCell(relation.targetId,change.columnId,resolveValue(change.value,row,rule.databaseId,variables));
        outputs.push({ type:action.type,rows:relations.length });
      } else if (action.type === 'notify') {
        const key=id('anote'); db.prepare(`INSERT INTO automation_notifications (id,rule_id,run_id,database_id,row_id,title,body,is_read,created_at) VALUES (?,?,?,?,?,?,?,0,?)`)
          .run(key,rule.id,runId,rule.databaseId,row?.id ?? null,renderText(action.title,row,rule.databaseId,variables),renderText(action.body,row,rule.databaseId,variables),now()); outputs.push({ type:action.type,id:key });
      } else {
        let response:Response|null=null; let error:unknown=null;
        for (let attempt=1;attempt<=rule.maxAttempts;attempt+=1) { lastAttempt=attempt; try { response=await fetch(action.url,{ method:action.method,headers:Object.fromEntries(Object.entries(action.headers).map(([key,value])=>[key,renderText(value,row,rule.databaseId,variables)])),body:renderText(action.body,row,rule.databaseId,variables) });
            if (response.ok) break; throw new Error(`HTTP ${response.status}`); } catch (cause) { error=cause; if (attempt<rule.maxAttempts) await sleep(rule.retryDelayMs); } }
        if (!response?.ok) throw error instanceof Error ? error : new Error('El webhook no respondió correctamente.'); outputs.push({ type:action.type,status:response.status });
      }
      completed+=1; db.prepare('UPDATE automation_runs SET actions_completed=?,attempt=?,output_json=? WHERE id=?').run(completed,lastAttempt,JSON.stringify(outputs),runId);
    }
    db.prepare("UPDATE automation_runs SET status='succeeded',actions_completed=?,attempt=?,output_json=?,finished_at=? WHERE id=?").run(completed,lastAttempt,JSON.stringify(outputs),now(),runId);
  } catch (cause) { db.prepare("UPDATE automation_runs SET status='failed',actions_completed=?,attempt=?,output_json=?,error=?,finished_at=? WHERE id=?")
      .run(completed,lastAttempt,JSON.stringify(outputs),cause instanceof Error?cause.message:String(cause),now(),runId); }
  return automationRun(db.prepare('SELECT * FROM automation_runs WHERE id=?').get(runId) as SqlRow);
}

export async function dispatchAutomationEvent(event: AutomationEvent): Promise<AutomationRun[]> {
  const rules=listAutomationRules(event.databaseId).filter((rule)=>ruleMatchesEvent(rule,event)); const runs:AutomationRun[]=[];
  for (const rule of rules) runs.push(await executeRule(rule,event)); return runs;
}

export async function runAutomationRule(ruleId: string, rowId: string | null = null, eventKey = `manual:${randomUUID()}`): Promise<AutomationRun> {
  const rule=getAutomationRule(ruleId); if (!rule) throw new Error('Automatización no encontrada.');
  return executeRule(rule,{ type:rule.trigger.type,databaseId:rule.databaseId,rowId,eventKey,columnId:rule.trigger.type==='button'?rule.trigger.columnId:null });
}

export async function runDatabaseButtonAutomation(columnId: string, rowId: string): Promise<AutomationRun[]> {
  const column=getColumn(columnId); const row=getRow(rowId); if (!column||column.type!=='button'||!row||row.databaseId!==column.databaseId) throw new Error('Botón de base de datos no válido.');
  const prior=json<{clicks?:number}>(row.cells[columnId],{}); setCell(rowId,columnId,JSON.stringify({ clicks:Math.max(0,Number(prior.clicks??0))+1,lastClickedAt:now(),lastClickedBy:'local' }));
  return dispatchAutomationEvent({ type:'button',databaseId:row.databaseId,rowId,columnId,eventKey:`button:${columnId}:${rowId}:${randomUUID()}` });
}

export async function runDueAutomationRules(at = now(), limit = 25): Promise<AutomationRun[]> {
  const instant=new Date(at); if (!Number.isFinite(instant.getTime())) throw new Error('Fecha de ejecución no válida.');
  const due=listAllScheduledRules().filter((rule)=>rule.trigger.type==='schedule'&&rule.trigger.nextRunAt<=instant.toISOString()).slice(0,Math.min(100,Math.max(1,limit)));
  const runs:AutomationRun[]=[]; for (const rule of due) { if (rule.trigger.type!=='schedule') continue; const scheduledAt=rule.trigger.nextRunAt;
    const next=nextDatabaseTemplateRun(scheduledAt,rule.trigger.recurrence,rule.trigger.timeZone)!; const mutation=updateAutomationRule(rule.id,{ trigger:{...rule.trigger,nextRunAt:next} },rule.revision);
    if (!mutation.ok) continue; runs.push(await executeRule(mutation.rule,{ type:'schedule',databaseId:rule.databaseId,eventKey:`schedule:${rule.id}:${scheduledAt}` })); }
  return runs;
}

function listAllScheduledRules(): AutomationRule[] {
  return (getDb().prepare("SELECT * FROM automation_rules WHERE enabled=1 AND json_extract(trigger_json,'$.type')='schedule' ORDER BY json_extract(trigger_json,'$.nextRunAt')").all() as SqlRow[]).map(automationRule);
}

export function listDatabaseForms(databaseId: string): FormDefinition[] {
  return (getDb().prepare(`SELECT form.*,(SELECT COUNT(*) FROM database_form_submissions submission WHERE submission.form_id=form.id) AS submission_count
    FROM database_forms form WHERE database_id=? ORDER BY name COLLATE NOCASE,id`).all(databaseId) as SqlRow[]).map(formDefinition);
}

export function getDatabaseFormBySlug(slug: string): FormDefinition | null {
  const row=getDb().prepare(`SELECT form.*,(SELECT COUNT(*) FROM database_form_submissions submission WHERE submission.form_id=form.id) AS submission_count FROM database_forms form WHERE slug=?`).get(slug) as SqlRow|undefined;
  return row?formDefinition(row):null;
}

export function getDatabaseForm(formId: string): FormDefinition | null {
  const row=getDb().prepare(`SELECT form.*,(SELECT COUNT(*) FROM database_form_submissions submission WHERE submission.form_id=form.id) AS submission_count FROM database_forms form WHERE id=?`).get(formId) as SqlRow|undefined;
  return row?formDefinition(row):null;
}

function validateFormInput(databaseId:string,input:CreateFormDefinitionInput,currentId:string|null=null):string {
  databaseExists(databaseId); if(!input.name?.trim()) throw new Error('El formulario necesita un nombre.'); const slug=normalizeDatabaseFormSlug(input.slug); if(!slug) throw new Error('La URL del formulario no es válida.');
  const duplicate=getDb().prepare('SELECT id FROM database_forms WHERE slug=? AND id<>COALESCE(?,\'\')').get(slug,currentId) as {id:string}|undefined; if(duplicate) throw new Error('La URL del formulario ya está en uso.');
  if(!Array.isArray(input.fields)||input.fields.length<1||input.fields.length>100) throw new Error('El formulario debe contener entre 1 y 100 campos.');
  const columns=new Map(getColumns(databaseId).map((column)=>[column.id,column])); const seen=new Set<string>(); for(const field of input.fields){ const column=columns.get(field.columnId);
    if(!column||seen.has(field.columnId)||isReadOnlyDatabaseProperty(column.type)||['formula','rollup','button','ai','ai_image','comparison','relation','attachment','files'].includes(column.type)) throw new Error('El formulario contiene un campo no editable.'); seen.add(field.columnId); }
  if((input.access??'public')==='authenticated'&&!input.authToken?.trim()&&!currentId) throw new Error('El formulario autenticado necesita un token.'); return slug;
}

export function createDatabaseForm(databaseId:string,input:CreateFormDefinitionInput):FormDefinition {
  const slug=validateFormInput(databaseId,input); const key=id('form'); const timestamp=now(); const access=input.access??'public'; const db=getDb(); db.transaction(()=>{
    db.prepare(`INSERT INTO database_forms (id,database_id,version,name,slug,title,description,access,auth_token_hash,confirmation_title,confirmation_body,rate_limit_count,rate_limit_minutes,enabled,revision,created_by,updated_by,created_at,updated_at)
      VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?,?,1,'local','local',?,?)`).run(key,databaseId,input.name.trim(),slug,(input.title??input.name).trim(),input.description??'',access,
        access==='authenticated'?hash(input.authToken!.trim()):null,input.confirmationTitle?.trim()||'Enviado',input.confirmationBody?.trim()||'Tu respuesta se ha guardado.',
        Math.min(1000,Math.max(1,input.rateLimitCount??10)),Math.min(10080,Math.max(1,input.rateLimitMinutes??60)),input.enabled===false?0:1,timestamp,timestamp);
    input.fields.forEach((field,index)=>db.prepare(`INSERT INTO database_form_fields (id,form_id,column_id,label,description,required,position,width,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?, ?,1,?,?)`)
      .run(id('ffield'),key,field.columnId,field.label.trim()||getColumn(field.columnId)!.name,field.description??null,field.required?1:0,index,field.width??'full',timestamp,timestamp)); })(); return getDatabaseForm(key)!;
}

export function updateDatabaseForm(formId:string,input:CreateFormDefinitionInput,expectedRevision:number):FormDefinitionMutationResult {
  const current=getDatabaseForm(formId); if(!current) throw new Error('Formulario no encontrado.'); if(current.revision!==expectedRevision) return {ok:false,conflict:true,current};
  const slug=validateFormInput(current.databaseId,input,formId); const access=input.access??current.access; const timestamp=now(); const db=getDb(); db.transaction(()=>{
    const result=db.prepare(`UPDATE database_forms SET name=?,slug=?,title=?,description=?,access=?,auth_token_hash=CASE WHEN ? IS NOT NULL THEN ? WHEN ?='public' THEN NULL ELSE auth_token_hash END,
      confirmation_title=?,confirmation_body=?,rate_limit_count=?,rate_limit_minutes=?,enabled=?,revision=revision+1,updated_by='local',updated_at=? WHERE id=? AND revision=?`).run(input.name.trim(),slug,(input.title??input.name).trim(),input.description??'',access,
        input.authToken?.trim()||null,input.authToken?.trim()?hash(input.authToken.trim()):null,access,input.confirmationTitle?.trim()||current.confirmationTitle,input.confirmationBody?.trim()||current.confirmationBody,
        Math.min(1000,Math.max(1,input.rateLimitCount??current.rateLimitCount)),Math.min(10080,Math.max(1,input.rateLimitMinutes??current.rateLimitMinutes)),input.enabled===false?0:1,timestamp,formId,expectedRevision);
    if(!result.changes) throw new Error('FORM_CONFLICT'); db.prepare('DELETE FROM database_form_fields WHERE form_id=?').run(formId); input.fields.forEach((field,index)=>db.prepare(`INSERT INTO database_form_fields (id,form_id,column_id,label,description,required,position,width,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?, ?,1,?,?)`)
      .run(id('ffield'),formId,field.columnId,field.label.trim()||getColumn(field.columnId)!.name,field.description??null,field.required?1:0,index,field.width??'full',timestamp,timestamp)); })(); return {ok:true,form:getDatabaseForm(formId)!};
}

export function deleteDatabaseForm(formId:string,expectedRevision:number):boolean { return getDb().prepare('DELETE FROM database_forms WHERE id=? AND revision=?').run(formId,expectedRevision).changes>0; }
export function authenticateDatabaseForm(formId:string,token:string|null):boolean { const row=getDb().prepare('SELECT access,auth_token_hash FROM database_forms WHERE id=?').get(formId) as {access:string;auth_token_hash:string|null}|undefined;
  return Boolean(row&&(row.access==='public'||(token&&row.auth_token_hash===hash(token)))); }

function rateWindow(minutes:number,at:Date):string { const ms=minutes*60_000; return new Date(Math.floor(at.getTime()/ms)*ms).toISOString(); }
export async function submitDatabaseForm(formId:string,values:Record<string,string|null>,source='local-http',fingerprint='local'):Promise<DatabaseFormSubmission> {
  const form=getDatabaseForm(formId); if(!form||!form.enabled) throw new Error('El formulario no está disponible.'); const allowed=new Map(form.fields.map((field)=>[field.columnId,field]));
  for(const field of form.fields) if(field.required&&!String(values[field.columnId]??'').trim()) throw new Error(`El campo “${field.label}” es obligatorio.`);
  for(const columnId of Object.keys(values)) if(!allowed.has(columnId)) throw new Error('La respuesta contiene un campo no permitido.'); const timestamp=now(); const windowStart=rateWindow(form.rateLimitMinutes,new Date(timestamp)); const db=getDb();
  const result=db.transaction(()=>{ db.prepare(`INSERT INTO database_form_rate_limits (form_id,fingerprint,window_start,submissions) VALUES (?,?,?,1)
      ON CONFLICT(form_id,fingerprint,window_start) DO UPDATE SET submissions=submissions+1`).run(formId,fingerprint,windowStart);
    const count=(db.prepare('SELECT submissions FROM database_form_rate_limits WHERE form_id=? AND fingerprint=? AND window_start=?').get(formId,fingerprint,windowStart) as {submissions:number}).submissions;
    if(count>form.rateLimitCount) throw new Error('Se ha alcanzado el límite temporal de envíos.'); const row=createRow(form.databaseId); for(const [columnId,value] of Object.entries(values)) setCell(row.id,columnId,value);
    const key=id('fsub'); db.prepare(`INSERT INTO database_form_submissions (id,form_id,row_id,status,source,values_json,created_at) VALUES (?,?,?,'accepted',?,?,?)`).run(key,formId,row.id,source,JSON.stringify(values),timestamp);
    return { id:key,formId,rowId:row.id,status:'accepted' as const,source,values:{...values},createdAt:timestamp }; })();
  await dispatchAutomationEvent({type:'row_created',databaseId:form.databaseId,rowId:result.rowId,eventKey:`form:${result.id}`}); return result;
}

export function listDatabaseFormSubmissions(formId:string,limit=100):DatabaseFormSubmission[] { return (getDb().prepare('SELECT * FROM database_form_submissions WHERE form_id=? ORDER BY created_at DESC LIMIT ?').all(formId,Math.min(500,Math.max(1,limit))) as SqlRow[])
  .map((row)=>({id:String(row.id),formId:String(row.form_id),rowId:String(row.row_id),status:String(row.status) as 'accepted'|'rejected',source:String(row.source),values:json(row.values_json,{}),createdAt:String(row.created_at)})); }
