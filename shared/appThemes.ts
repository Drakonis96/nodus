import type { AppTheme, CustomAppTheme } from './types';

/** TypeScript entry point for Desktop and Server Web. Keep the runtime-only
 * `appThemes.mjs` copy in sync for the dependency-free Server container. */
export const APP_THEME_IDS: AppTheme[] = [
  'default',
  'amethyst-iris',
  'deep-ocean',
  'plum-lilac',
  'sage-stone',
  'azure-night',
  'slate-gray',
  'mint-slate',
  'amber-ember',
  'berry-wine',
  'burnt-sun',
  'rose-quartz',
  'pine-grove',
  'golden-hour',
  'plum-noir',
  'sea-glass',
  'lagoon',
];

export const DEFAULT_APP_THEME: AppTheme = 'default';

const CUSTOM_THEME_ID_RE = /^custom-[a-z0-9][a-z0-9-]{0,47}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

function boundedText(value: unknown, fallback: string, max: number): string {
  const text = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return text || fallback;
}

function colour(value: unknown): string | null {
  return typeof value === 'string' && HEX_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}

/** Validate and normalize user-created themes at the persistence boundary. */
export function sanitizeCustomThemes(value: unknown): CustomAppTheme[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>(APP_THEME_IDS);
  const result: CustomAppTheme[] = [];
  for (const candidate of value.slice(0, 24)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const input = candidate as Record<string, unknown>;
    const id = typeof input.id === 'string' ? input.id.trim().toLowerCase() : '';
    if (!CUSTOM_THEME_ID_RE.test(id) || used.has(id)) continue;
    const accent = colour(input.accent);
    const deep = colour(input.deep);
    const pale = colour(input.pale);
    const lightText = colour(input.lightText);
    const darkText = colour(input.darkText);
    if (!accent || !deep || !pale || !lightText || !darkText) continue;
    used.add(id);
    result.push({
      id,
      label: boundedText(input.label, id.slice(7).replace(/-/g, ' '), 48),
      accent,
      deep,
      pale,
      lightText,
      darkText,
      tint: Math.max(0, Math.min(1, Number.isFinite(Number(input.tint)) ? Number(input.tint) : 0.05)),
    });
  }
  return result;
}

export function isCustomAppTheme(value: unknown): boolean {
  return typeof value === 'string' && CUSTOM_THEME_ID_RE.test(value);
}

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && APP_THEME_IDS.includes(value as AppTheme);
}

export function coerceAppTheme(value: unknown): AppTheme {
  return isAppTheme(value) ? value : DEFAULT_APP_THEME;
}
