export type ThemeShade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export type Ramp = Record<ThemeShade, string>;

export interface ThemeAnchors {
  accent: string;
  deep: string;
  pale: string;
  lightText: string;
  darkText: string;
  tint?: number;
}

export interface ThemeTokens {
  /** Neutral ramp — monotonic pale→deep, mode-independent. */
  n: Ramp;
  /** Accent ramp — mode-split. */
  a: { dark: Ramp; light: Ramp };
  /** Explicit mode-specific foreground colours. */
  text: { dark: string; light: string };
}

export interface ThemeDef {
  id: string;
  label: string;
  anchors: ThemeAnchors;
  tokens: ThemeTokens;
}

export const THEMES: ThemeDef[];
export const SHADES: ThemeShade[];

export function mix(a: string, b: string, amount: number): string;
export function contrast(a: string, b: string): number;
export function deriveThemeTokens(def: { anchors: ThemeAnchors }): ThemeTokens;
