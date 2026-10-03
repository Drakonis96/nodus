import type { WorkspaceSnapshot } from './viewSnapshots';
type Preferences = Pick<WorkspaceSnapshot, 'layout' | 'catalogView' | 'contextOpen' | 'focusMode' | 'pinnedActionIds'>;
function sanitize(value: unknown): Preferences {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { pinnedActionIds: Array.isArray(raw.pinnedActionIds) ? [...new Set(raw.pinnedActionIds.filter((id): id is string => typeof id === 'string' && /^[a-z-]{1,40}$/.test(id)))].slice(0, 40) : [], layout: raw.layout === 'navigator' ? 'navigator' : 'editorial', catalogView: raw.catalogView === 'cards' ? 'cards' : 'list', contextOpen: raw.contextOpen === true, focusMode: raw.focusMode === true };
}
export function readWorkspacePreferences(vaultId: string): Preferences {
  try { return sanitize(JSON.parse(localStorage.getItem(`nodus.workspacePreferences.${vaultId}`) ?? '{}')); } catch { return sanitize(null); }
}
export function writeWorkspacePreferences(vaultId: string, patch: Partial<Preferences>): void {
  if (!['layout','catalogView','contextOpen','focusMode','pinnedActionIds'].some(key => key in patch)) return;
  try { localStorage.setItem(`nodus.workspacePreferences.${vaultId}`, JSON.stringify(sanitize({ ...readWorkspacePreferences(vaultId), ...patch }))); } catch { /* disabled local storage uses session defaults */ }
}
