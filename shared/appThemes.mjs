/** Canonical list of selectable colour themes, dependency-free for the Nodus Server
 *  build. Keep in sync with `AppTheme` in shared/types.ts and `THEME_IDS` in
 *  src/theme/themes.mjs (enforced by scripts/test-theme-token-completeness.mjs). */
export const APP_THEME_IDS = [
  'default',
  'teal-noir',
  'deep-ocean',
  'forest-pine',
  'sunset-coral',
  'royal-violet',
  'mint-slate',
  'amber-ember',
  'berry-wine',
  'indigo-night',
  'rose-quartz',
];

export const DEFAULT_APP_THEME = 'default';

/** @param {unknown} value */
export function isAppTheme(value) {
  return typeof value === 'string' && APP_THEME_IDS.includes(value);
}

/** @param {unknown} value */
export function coerceAppTheme(value) {
  return isAppTheme(value) ? value : DEFAULT_APP_THEME;
}
