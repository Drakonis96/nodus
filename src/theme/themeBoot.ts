/**
 * Applies the persisted colour theme class before the first paint.
 *
 * The renderer's real source of truth is `settings.appTheme` (desktop) or the
 * portable profile (server web), but those load asynchronously; this mirrors the
 * last value into `localStorage` so a reload doesn't flash the default theme.
 * The app CSP forbids inline `<script>`, so this must be a module imported first
 * in every renderer entry (before `index.css`).
 */
export const APP_THEME_STORAGE_KEY = 'nodus-app-theme';

/** Toggle the single `theme-<id>` class on <html>, clearing any stale one. */
export function applyAppThemeClass(id: string | null | undefined): void {
  const root = document.documentElement;
  const next = `theme-${id || 'default'}`;
  for (const cls of Array.from(root.classList)) {
    if (cls.startsWith('theme-') && cls !== next) root.classList.remove(cls);
  }
  if (!root.classList.contains(next)) root.classList.add(next);
}

try {
  applyAppThemeClass(localStorage.getItem(APP_THEME_STORAGE_KEY));
} catch {
  applyAppThemeClass('default');
}
