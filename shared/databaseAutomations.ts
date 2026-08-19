import type { DatabaseColumnType } from './databases';
import type { FilterNode } from './databaseQuery';
import type { PageBlockDraft } from './pages';

export const DATABASE_AUTOMATION_VERSION = 1 as const;
export type AutomationTriggerType = 'row_created' | 'property_changed' | 'schedule' | 'button';
export type AutomationRunStatus = 'running' | 'succeeded' | 'failed' | 'skipped';
export type AutomationValue =
  | { type: 'literal'; value: string | null }
  | { type: 'column'; columnId: string }
  | { type: 'template'; template: string };

export type AutomationTrigger =
  | { type: 'row_created' }
  | { type: 'property_changed'; columnId: string | null }
  | { type: 'button'; columnId: string }
  | { type: 'schedule'; recurrence: 'daily' | 'weekly' | 'monthly' | 'yearly'; nextRunAt: string; timeZone: string };

export type AutomationAction =
  | { type: 'set_property'; columnId: string; value: AutomationValue }
  | { type: 'create_page'; databaseId: string | null; properties: Record<string, AutomationValue>; blocks: PageBlockDraft[] }
  | { type: 'update_related'; relationColumnId: string; changes: Array<{ columnId: string; value: AutomationValue }> }
  | { type: 'notify'; title: string; body: string }
  | { type: 'webhook'; url: string; method: 'POST' | 'PUT' | 'PATCH'; headers: Record<string, string>; body: string };

export interface AutomationRule {
  id: string;
  databaseId: string;
  version: typeof DATABASE_AUTOMATION_VERSION;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  condition: FilterNode | null;
  actions: AutomationAction[];
  variables: Record<string, AutomationValue>;
  maxDepth: number;
  maxAttempts: number;
  retryDelayMs: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutomationRuleInput {
  name: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  condition?: FilterNode | null;
  actions: AutomationAction[];
  variables?: Record<string, AutomationValue>;
  maxDepth?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface AutomationRun {
  id: string;
  ruleId: string;
  databaseId: string;
  rowId: string | null;
  eventKey: string;
  status: AutomationRunStatus;
  depth: number;
  attempt: number;
  actionsCompleted: number;
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type AutomationRuleMutationResult =
  | { ok: true; rule: AutomationRule }
  | { ok: false; conflict: true; current: AutomationRule };

export interface AutomationEvent {
  type: Exclude<AutomationTriggerType, 'schedule'> | 'schedule';
  databaseId: string;
  rowId?: string | null;
  columnId?: string | null;
  eventKey: string;
  depth?: number;
  visitedRuleIds?: string[];
}

export type DatabaseFormAccess = 'public' | 'authenticated';
export interface DatabaseFormField {
  id: string;
  formId: string;
  columnId: string;
  label: string;
  description: string | null;
  required: boolean;
  position: number;
  width: 'full' | 'half';
}

export interface FormDefinition {
  id: string;
  databaseId: string;
  version: 1;
  name: string;
  slug: string;
  title: string;
  description: string;
  access: DatabaseFormAccess;
  requiresAuth: boolean;
  fields: DatabaseFormField[];
  confirmationTitle: string;
  confirmationBody: string;
  rateLimitCount: number;
  rateLimitMinutes: number;
  enabled: boolean;
  revision: number;
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
}

export type FormDefinitionMutationResult =
  | { ok: true; form: FormDefinition }
  | { ok: false; conflict: true; current: FormDefinition };

export interface CreateFormDefinitionInput {
  name: string;
  slug: string;
  title?: string;
  description?: string;
  access?: DatabaseFormAccess;
  authToken?: string | null;
  fields: Array<Omit<DatabaseFormField, 'id' | 'formId' | 'position'> & { position?: number }>;
  confirmationTitle?: string;
  confirmationBody?: string;
  rateLimitCount?: number;
  rateLimitMinutes?: number;
  enabled?: boolean;
}

export interface DatabaseFormSubmission {
  id: string;
  formId: string;
  rowId: string;
  status: 'accepted' | 'rejected';
  source: string;
  values: Record<string, string | null>;
  createdAt: string;
}

export interface DatabaseFormServerStatus {
  running: boolean;
  port: number | null;
  origin: string | null;
}

export function normalizeDatabaseFormSlug(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

export function assertAutomationValue(value: AutomationValue): void {
  if (!value || typeof value !== 'object' || !['literal','column','template'].includes(value.type)) throw new Error('Valor de automatización no válido.');
  if (value.type === 'column' && !value.columnId) throw new Error('El valor de columna no indica una propiedad.');
  if (value.type === 'template' && typeof value.template !== 'string') throw new Error('La plantilla de automatización no es válida.');
}

export function formInputType(type: DatabaseColumnType): 'text' | 'number' | 'date' | 'time' | 'email' | 'url' | 'tel' | 'checkbox' | 'select' | 'textarea' {
  if (type === 'number') return 'number'; if (type === 'date') return 'date'; if (type === 'time') return 'time';
  if (type === 'email') return 'email'; if (type === 'url') return 'url'; if (type === 'phone') return 'tel'; if (type === 'checkbox') return 'checkbox';
  if (type === 'select' || type === 'status' || type === 'multi_select') return 'select';
  if (type === 'rich_text' || type === 'text') return 'textarea'; return 'text';
}
