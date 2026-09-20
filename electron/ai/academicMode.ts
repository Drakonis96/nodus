import { getSettings } from '../db/settingsRepo';

/** Reads the scoped database, never the foreground vault, so background jobs stay isolated. */
export function isManualAcademic(): boolean { return getSettings().academicMode === 'manual'; }
export function assertAcademicAutomation(): void {
  if (isManualAcademic()) throw new Error('En modo Manual, las ideas, citas y relaciones las creas tú.');
}
