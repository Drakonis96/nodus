import type { PageBlockDraft } from './pages';
import { resolveDatabaseZonedDate, shiftDatabaseLocalDate } from './databaseTemporal';

export type DatabaseTemplateRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type DatabaseSubitemView = 'nested' | 'flat';
export type DatabaseSprintState = 'planned' | 'active' | 'completed';

export interface DatabaseTemplateRelationDefault {
  columnId: string;
  targetKind: 'db_row' | 'work' | 'idea' | 'gap' | 'author' | 'person';
  targetId: string;
  targetVaultId?: string | null;
}

export interface DatabaseRowTemplate {
  id: string;
  databaseId: string;
  name: string;
  icon: string | null;
  coverBlobHash: string | null;
  properties: Record<string, string | null>;
  blocks: PageBlockDraft[];
  defaultRelations: DatabaseTemplateRelationDefault[];
  recurrence: DatabaseTemplateRecurrence;
  timeZone: string;
  nextRunAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDatabaseRowTemplateInput {
  name: string;
  icon?: string | null;
  coverBlobHash?: string | null;
  properties?: Record<string, string | null>;
  blocks?: PageBlockDraft[];
  defaultRelations?: DatabaseTemplateRelationDefault[];
  recurrence?: DatabaseTemplateRecurrence;
  timeZone?: string;
  nextRunAt?: string | null;
}

export interface DatabaseTemplateInstantiation {
  templateId: string;
  rowId: string;
  pageId: string;
  occurrenceKey: string | null;
  created: boolean;
}

export interface DatabaseRowHierarchyItem {
  rowId: string;
  parentRowId: string | null;
  depth: number;
  sortOrder: number;
  collapsed: boolean;
  title: string;
  revision: number;
}

export interface DatabaseRowDependency {
  id: string;
  databaseId: string;
  predecessorRowId: string;
  successorRowId: string;
  lagDays: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface DatabaseTaskConfig {
  databaseId: string;
  dateColumnId: string | null;
  statusColumnId: string | null;
  sprintColumnId: string | null;
  subitemView: DatabaseSubitemView;
  avoidWeekends: boolean;
  shiftDependents: boolean;
  revision: number;
  updatedAt: string;
}

export interface DatabaseSprint {
  id: string;
  databaseId: string;
  name: string;
  startAt: string;
  endAt: string;
  state: DatabaseSprintState;
  rowCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseTaskDateChange {
  rowId: string;
  previous: string | null;
  next: string | null;
}

export interface DatabaseDuplicateRowInput {
  rowId: string;
  includeContent: boolean;
  includeChildren?: boolean;
}

export function nextDatabaseTemplateRun(value: string, recurrence: DatabaseTemplateRecurrence, requestedTimeZone = 'UTC'): string | null {
  if (recurrence === 'none') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('La próxima ejecución no contiene una fecha válida.');
  let timeZone = requestedTimeZone;
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(date); } catch { timeZone = 'UTC'; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const unit = recurrence === 'daily' ? 'days' : recurrence === 'weekly' ? 'weeks' : recurrence === 'monthly' ? 'months' : 'years';
  return resolveDatabaseZonedDate(shiftDatabaseLocalDate(local, 1, unit), timeZone).utc;
}

export function databaseTemplateOccurrenceKey(templateId: string, scheduledAt: string): string {
  const date = new Date(scheduledAt);
  if (!Number.isFinite(date.getTime())) throw new Error('La ejecución programada no contiene una fecha válida.');
  return `${templateId}:${date.toISOString()}`;
}

export function shiftTaskDate(date: Date, deltaDays: number, avoidWeekends: boolean): Date {
  const next = new Date(date.getTime());
  const direction = deltaDays < 0 ? -1 : 1;
  let remaining = Math.abs(Math.trunc(deltaDays));
  while (remaining > 0) {
    next.setUTCDate(next.getUTCDate() + direction);
    if (!avoidWeekends || (next.getUTCDay() !== 0 && next.getUTCDay() !== 6)) remaining -= 1;
  }
  if (avoidWeekends && remaining === 0) {
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next.setUTCDate(next.getUTCDate() + direction);
  }
  return next;
}
