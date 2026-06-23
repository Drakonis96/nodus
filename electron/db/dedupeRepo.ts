// Electron-side wrappers around the pure dedupe logic, bound to the app database.
import { getDb } from './database';
import { findDuplicateWorkGroups as findGroups, mergeWorks as mergeIn } from './dedupe';
import type { DuplicateWorkGroup } from '@shared/types';

export function listDuplicateWorks(): DuplicateWorkGroup[] {
  return findGroups(getDb());
}

export function mergeWorks(canonicalId: string, duplicateIds: string[]): { merged: number } {
  return { merged: mergeIn(getDb(), canonicalId, duplicateIds) };
}
