/** Canonical list of built-in colour themes, dependency-free for the Nodus Server
 *  build. Keep in sync with the built-in union in shared/types.ts. Custom theme IDs
 *  are validated separately at the profile boundary. */
export const APP_THEME_IDS = [
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

export const DEFAULT_APP_THEME = 'default';

const CUSTOM_THEME_ID_RE = /^custom-[a-z0-9][a-z0-9-]{0,47}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

function boundedText(value, fallback, max) {
  const text = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return text || fallback;
}

function colour(value) {
  return typeof value === 'string' && HEX_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}

/** Validate and normalize user-created themes at the persistence boundary. */
export function sanitizeCustomThemes(value) {
  if (!Array.isArray(value)) return [];
  const used = new Set(APP_THEME_IDS);
  const result = [];
  for (const candidate of value.slice(0, 24)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const id = typeof candidate.id === 'string' ? candidate.id.trim().toLowerCase() : '';
    if (!CUSTOM_THEME_ID_RE.test(id) || used.has(id)) continue;
    const accent = colour(candidate.accent);
    const deep = colour(candidate.deep);
    const pale = colour(candidate.pale);
    const lightText = colour(candidate.lightText);
    const darkText = colour(candidate.darkText);
    if (!accent || !deep || !pale || !lightText || !darkText) continue;
    used.add(id);
    result.push({
      id,
      label: boundedText(candidate.label, id.slice(7).replace(/-/g, ' '), 48),
      accent,
      deep,
      pale,
      lightText,
      darkText,
      tint: Math.max(0, Math.min(1, Number.isFinite(Number(candidate.tint)) ? Number(candidate.tint) : 0.05)),
    });
  }
  return result;
}

export function isCustomAppTheme(value) {
  return typeof value === 'string' && CUSTOM_THEME_ID_RE.test(value);
}

/** @param {unknown} value */
export function isAppTheme(value) {
  return typeof value === 'string' && APP_THEME_IDS.includes(value);
}

/** @param {unknown} value */
export function coerceAppTheme(value) {
  return isAppTheme(value) ? value : DEFAULT_APP_THEME;
}
