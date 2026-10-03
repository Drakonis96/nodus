/** One release migration; manual visibility choices made afterwards survive reads. */
export const SCRIPTOR_SIDEBAR_VERSION = 1;

export function migrateScriptorSidebar(preferences) {
  const sidebarHidden = Array.isArray(preferences.sidebarHidden) ? preferences.sidebarHidden : [];
  const sidebarOrder = Array.isArray(preferences.sidebarOrder) ? preferences.sidebarOrder : [];
  const version = Number.isSafeInteger(preferences.scriptorSidebarVersion) ? preferences.scriptorSidebarVersion : 0;
  const changed = version < SCRIPTOR_SIDEBAR_VERSION;
  const legacyAuthoring = new Set(['workspace', 'notes', 'writing', 'projects']);
  return {
    changed,
    scriptorSidebarVersion: Math.max(version, SCRIPTOR_SIDEBAR_VERSION),
    sidebarHidden: changed ? sidebarHidden.filter(id => !legacyAuthoring.has(id)) : [...sidebarHidden],
    sidebarOrder: changed ? sidebarOrder.filter(id => !legacyAuthoring.has(id)) : [...sidebarOrder],
  };
}
