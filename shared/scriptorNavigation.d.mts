export const SCRIPTOR_SIDEBAR_VERSION: 1;
export function migrateScriptorSidebar(preferences: { sidebarHidden?: string[]; sidebarOrder?: string[]; scriptorSidebarVersion?: number }): {
  changed: boolean; scriptorSidebarVersion: number; sidebarHidden: string[]; sidebarOrder: string[];
};
