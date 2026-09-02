/**
 * Nodus colour themes.
 *
 * A "theme" is a palette family; light/dark/system is an orthogonal *mode*.
 *
 * The neutral scale (`--n-50` … `--n-950`) is **monotonic and mode-independent** —
 * `--n-50` is always the palest surface, `--n-950` always the deepest — exactly like
 * Tailwind's `neutral-*`. Components keep expressing light/dark through their own
 * `dark:` variants (`text-neutral-900 dark:text-neutral-100`), so a theme only
 * re-tints the scale toward its palette; it never inverts it.
 *
 * The accent scale (`--a-50` … `--a-950`) IS mode-split: `text-indigo-300`-style
 * utilities need a lighter accent on dark surfaces and a darker one on pale surfaces.
 *
 * Each theme is defined by three anchor colours (an accent plus a deep and a pale
 * surface) and a deterministic derivation expands those into the ramps consumed by
 * `tokens.generated.css`. Adding a theme = one entry here + `npm run gen:theme`.
 *
 * `default` is special: no ramps, no generated utility block — it renders through
 * raw Tailwind + the hand-written `.light` rules in index.css and stays the
 * recovery-safe baseline.
 *
 * Anchor colours are drawn from curated ColorHunt palettes
 * (https://colorhunt.co/palettes/popular).
 */

/** @typedef {Record<50|100|200|300|400|500|600|700|800|900|950, string>} Ramp */

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Neutral interpolation position for each shade (0 = pale surface, 1 = deep surface),
 *  shaped to roughly track Tailwind's own neutral luminance curve. */
const N_STOPS = {
  50: 0.0, 100: 0.035, 200: 0.09, 300: 0.17, 400: 0.36, 500: 0.56,
  600: 0.7, 700: 0.81, 800: 0.89, 900: 0.95, 950: 1.0,
};

function clamp8(n) { return Math.max(0, Math.min(255, Math.round(n))); }

function parseHex(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function toHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => clamp8(c).toString(16).padStart(2, '0')).join('');
}

/** Linear sRGB mix. `amount` is the weight of `b` (0 = all a, 1 = all b). */
export function mix(a, b, amount) {
  const ca = parseHex(a); const cb = parseHex(b);
  return toHex(ca.map((v, i) => v + (cb[i] - v) * amount));
}

const WHITE = '#ffffff';
const BLACK = '#0a0a0a';

/** WCAG relative luminance. */
function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hexes. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Darken `hex` toward black until it clears `min` contrast against `against`. */
function ensureContrast(hex, against, min) {
  let c = hex;
  for (let i = 0; i < 24 && contrast(c, against) < min; i++) c = mix(c, BLACK, 0.08);
  return c;
}

/** Monotonic pale→deep neutral ramp, lightly tinted with the accent in the mids. */
function neutralRamp(pale, deep, accent, tint) {
  /** @type {Ramp} */ const ramp = /** @type {any} */ ({});
  for (const shade of SHADES) {
    let c = mix(pale, deep, N_STOPS[shade]);
    if (tint > 0 && shade >= 200 && shade <= 900) c = mix(c, accent, tint * 0.35);
    ramp[shade] = c;
  }
  return ramp;
}

/**
 * Accent ramp.
 *
 * 500 is the raw brand hue (focus rings, borders — never a text/background pair).
 * 600–950 run progressively dark so white text on 700 (the primary-button
 * background) is legible for every hue, matching Tailwind's own indigo curve.
 * Light mode pushes 300/400 dark enough to read as accent text on pale surfaces.
 */
function accentRamp(accent, mode) {
  const light = mode === 'light';
  const ramp = /** @type {Ramp} */ ({
    50: mix(accent, WHITE, 0.9),
    100: mix(accent, WHITE, 0.8),
    200: mix(accent, WHITE, 0.6),
    300: light ? mix(accent, BLACK, 0.35) : mix(accent, WHITE, 0.38),
    400: light ? mix(accent, BLACK, 0.24) : mix(accent, WHITE, 0.16),
    500: accent,
    600: mix(accent, BLACK, 0.26),
    700: mix(accent, BLACK, 0.46),
    800: mix(accent, BLACK, 0.6),
    900: mix(accent, BLACK, 0.72),
    950: mix(accent, BLACK, 0.84),
  });
  // ColorHunt accents are mid-lightness hues that fail white-on-colour at their
  // raw value. `.btn-primary` (`@apply bg-indigo-600`) and every `bg-indigo-{500,600}`
  // fill in the app pairs these shades with white text, so force them to clear WCAG,
  // darkening toward black as needed. 500 matches Tailwind indigo-500's ~3.5:1 floor;
  // 600+ clear AA.
  ramp[500] = ensureContrast(ramp[500], WHITE, 3.5);
  ramp[600] = ensureContrast(ramp[600], WHITE, 4.6);
  ramp[700] = ensureContrast(ramp[700], WHITE, 5.6);
  ramp[800] = ensureContrast(ramp[800], WHITE, 7.0);
  ramp[900] = ensureContrast(ramp[900], WHITE, 9.0);
  ramp[950] = ensureContrast(ramp[950], WHITE, 12.0);
  if (light) {
    ramp[300] = ensureContrast(ramp[300], WHITE, 4.6); // accent text on white
    ramp[400] = ensureContrast(ramp[400], WHITE, 3.6);
  }
  return ramp;
}

/**
 * @typedef {Object} ThemeAnchors
 * @property {string} accent   accent hue (maps to --a-500)
 * @property {string} deep     deepest surface (maps to --n-950)
 * @property {string} [pale]   palest surface (maps to --n-50); defaults to a faint accent-tinted white
 * @property {number} [tint]   0–1, how much accent bleeds into the mid neutrals
 */

/** @type {Array<{ id:string, label:string, anchors:ThemeAnchors }>} */
const THEME_DEFS = [
  { id: 'teal-noir', label: 'Teal Noir', anchors: { accent: '#00adb5', deep: '#1b2126', pale: '#f6f8f9', tint: 0.05 } },
  { id: 'deep-ocean', label: 'Deep Ocean', anchors: { accent: '#3f72af', deep: '#101c2e', pale: '#f9f7f7', tint: 0.06 } },
  { id: 'forest-pine', label: 'Forest Pine', anchors: { accent: '#00a389', deep: '#121815', pale: '#f2f6f4', tint: 0.05 } },
  { id: 'sunset-coral', label: 'Sunset Coral', anchors: { accent: '#e8734f', deep: '#241a16', pale: '#fbf1ec', tint: 0.06 } },
  { id: 'royal-violet', label: 'Royal Violet', anchors: { accent: '#9b4dd6', deep: '#1b1430', pale: '#f7f2fb', tint: 0.06 } },
  { id: 'mint-slate', label: 'Mint Slate', anchors: { accent: '#0e8388', deep: '#1a2222', pale: '#eff5f4', tint: 0.05 } },
  { id: 'amber-ember', label: 'Amber Ember', anchors: { accent: '#f08a00', deep: '#1f1913', pale: '#fdf6ec', tint: 0.06 } },
  { id: 'berry-wine', label: 'Berry Wine', anchors: { accent: '#bd5579', deep: '#241320', pale: '#fdf2f5', tint: 0.06 } },
  { id: 'indigo-night', label: 'Indigo Night', anchors: { accent: '#5566e8', deep: '#0d1230', pale: '#f2f5ff', tint: 0.06 } },
  { id: 'rose-quartz', label: 'Rose Quartz', anchors: { accent: '#c0849b', deep: '#241f21', pale: '#fdf6f6', tint: 0.05 } },
];

/** Build the full token set for one theme: one neutral ramp + a per-mode accent ramp. */
export function deriveThemeTokens(def) {
  const { accent, deep, tint = 0 } = def.anchors;
  const pale = def.anchors.pale ?? mix(WHITE, accent, 0.03);
  return {
    n: neutralRamp(pale, deep, accent, tint),
    a: { dark: accentRamp(accent, 'dark'), light: accentRamp(accent, 'light') },
  };
}

/** Non-default themes, with derived ramps attached. */
export const THEMES = THEME_DEFS.map((def) => ({ ...def, tokens: deriveThemeTokens(def) }));

/** Every selectable theme id, `default` first. */
export const THEME_IDS = ['default', ...THEME_DEFS.map((d) => d.id)];

/** id → display label (default handled by the UI via i18n). */
export const THEME_LABELS = Object.fromEntries(THEME_DEFS.map((d) => [d.id, d.label]));

export { SHADES };
