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
 * Each theme is defined by an accent, deep and pale surfaces, plus explicit
 * foreground colours for light and dark mode. Every theme supplies those
 * foregrounds independently so surface colours never silently become text colours.
 *
 * `default` is special: it keeps the raw Tailwind + hand-written `.light` rules in index.css and stays the
 * recovery-safe baseline.
 *
 * Anchor colours are drawn from curated FreeColorPalettes palettes.
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

/** Lighten a foreground toward white until it reads on a dark surface. */
function ensureLightContrast(hex, against, min) {
  let c = hex;
  for (let i = 0; i < 24 && contrast(c, against) < min; i++) c = mix(c, WHITE, 0.08);
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
 * @property {string} pale      palest surface (maps to --n-50)
 * @property {string} lightText foreground used in light mode
 * @property {string} darkText  foreground used in dark mode
 * @property {number} [tint]   0–1, how much accent bleeds into the mid neutrals
 */

/** @type {Array<{ id:string, label:string, anchors:ThemeAnchors }>} */
const THEME_DEFS = [
  { id: 'amethyst-iris', label: 'Amethyst Iris', anchors: { accent: '#6a0dad', deep: '#0e0019', pale: '#efe3f7', lightText: '#24113a', darkText: '#f7effb', tint: 0.06 } },
  { id: 'deep-ocean', label: 'Deep Ocean', anchors: { accent: '#3f72af', deep: '#101c2e', pale: '#f9f7f7', lightText: '#171717', darkText: '#f5f5f5', tint: 0.06 } },
  { id: 'plum-lilac', label: 'Plum Lilac', anchors: { accent: '#5e548e', deep: '#0a0613', pale: '#e0b1cb', lightText: '#231942', darkText: '#f8f0f6', tint: 0.06 } },
  { id: 'sage-stone', label: 'Sage Stone', anchors: { accent: '#a98467', deep: '#201817', pale: '#f0ead2', lightText: '#3b2d26', darkText: '#fff8e8', tint: 0.05 } },
  { id: 'azure-night', label: 'Azure Night', anchors: { accent: '#1f6feb', deep: '#030d17', pale: '#f0f6fc', lightText: '#0a2540', darkText: '#eef7ff', tint: 0.06 } },
  { id: 'slate-gray', label: 'Slate Gray', anchors: { accent: '#64748b', deep: '#0b111c', pale: '#f1f5f9', lightText: '#1e293b', darkText: '#f8fafc', tint: 0.03 } },
  { id: 'mint-slate', label: 'Mint Slate', anchors: { accent: '#0e8388', deep: '#1a2222', pale: '#eff5f4', lightText: '#171717', darkText: '#f5f5f5', tint: 0.05 } },
  { id: 'amber-ember', label: 'Amber Ember', anchors: { accent: '#f08a00', deep: '#1f1913', pale: '#fdf6ec', lightText: '#171717', darkText: '#f5f5f5', tint: 0.06 } },
  { id: 'berry-wine', label: 'Berry Wine', anchors: { accent: '#bd5579', deep: '#241320', pale: '#fdf2f5', lightText: '#171717', darkText: '#f5f5f5', tint: 0.06 } },
  { id: 'burnt-sun', label: 'Burnt Sun', anchors: { accent: '#c44b1b', deep: '#240a00', pale: '#f0cc6c', lightText: '#3b1608', darkText: '#fff3c4', tint: 0.05 } },
  { id: 'rose-quartz', label: 'Rose Quartz', anchors: { accent: '#c0849b', deep: '#241f21', pale: '#fdf6f6', lightText: '#171717', darkText: '#f5f5f5', tint: 0.05 } },
  { id: 'pine-grove', label: 'Pine Grove', anchors: { accent: '#2e7d32', deep: '#061406', pale: '#f1fbf1', lightText: '#173017', darkText: '#effff0', tint: 0.05 } },
  { id: 'golden-hour', label: 'Golden Hour', anchors: { accent: '#ccb800', deep: '#252000', pale: '#fffde7', lightText: '#3d3500', darkText: '#fffde7', tint: 0.04 } },
  { id: 'plum-noir', label: 'Plum Noir', anchors: { accent: '#7b2d6a', deep: '#160019', pale: '#f0e8ee', lightText: '#32102b', darkText: '#fff3fa', tint: 0.06 } },
  { id: 'sea-glass', label: 'Sea Glass', anchors: { accent: '#3d7a8a', deep: '#051115', pale: '#d4e5e8', lightText: '#173d46', darkText: '#effcff', tint: 0.05 } },
  { id: 'lagoon', label: 'Lagoon', anchors: { accent: '#4ecdc4', deep: '#051215', pale: '#f7fff7', lightText: '#16464c', darkText: '#effffc', tint: 0.05 } },
];

/** Build the full token set for one theme: one neutral ramp + a per-mode accent ramp. */
export function deriveThemeTokens(def) {
  const { accent, deep, pale, lightText, darkText, tint = 0 } = def.anchors;
  const neutralTokens = neutralRamp(pale, deep, accent, tint);
  const accentTokens = { dark: accentRamp(accent, 'dark'), light: accentRamp(accent, 'light') };
  accentTokens.dark[300] = ensureLightContrast(accentTokens.dark[300], neutralTokens[950], 4.5);
  accentTokens.dark[400] = ensureLightContrast(accentTokens.dark[400], neutralTokens[950], 3.5);
  return {
    n: neutralTokens,
    a: accentTokens,
    text: {
      light: lightText,
      dark: darkText,
    },
  };
}

/** Non-default themes, with derived ramps attached. */
export const THEMES = THEME_DEFS.map((def) => ({ ...def, tokens: deriveThemeTokens(def) }));

export { SHADES };
