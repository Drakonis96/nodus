import type { AppTheme, CustomAppTheme } from './types';

export const APP_THEME_IDS: AppTheme[];
export const DEFAULT_APP_THEME: 'default';
export function isAppTheme(value: unknown): value is AppTheme;
export function coerceAppTheme(value: unknown): AppTheme;
export function sanitizeCustomThemes(value: unknown): CustomAppTheme[];
export function isCustomAppTheme(value: unknown): boolean;
