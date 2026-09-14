import type { ThemeMode } from '@shared/types';

/** Keep legacy `.light` styles and Tailwind `dark:` variants in sync.
 * Call again when the OS preference changes while using the system theme. */
export function applyThemeClasses(theme: ThemeMode): boolean {
  const dark = theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : theme === 'dark';
  document.documentElement.classList.toggle('light', !dark);
  document.documentElement.classList.toggle('dark', dark);
  return dark;
}
