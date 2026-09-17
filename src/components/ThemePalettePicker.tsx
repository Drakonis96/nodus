import type { AppSettings, CustomAppTheme } from '@shared/types';
import { t } from '../i18n';
import { THEMES } from '../theme/themes.mjs';

/** A palette option as the picker renders it: `default` first, then the curated
 *  palettes, then whatever the profile defines. Each swatch shows a light surface,
 *  the accent and a deep surface so the choice reads without applying it. */
export type ThemePickerOption = { id: string; label: string; swatch: string[]; custom?: boolean };

/** The built-in `default` pseudo-palette, which keeps the pre-theme appearance. */
const DEFAULT_OPTION: ThemePickerOption = { id: 'default', label: 'Predeterminado', swatch: ['#fafafa', '#6366f1', '#0a0a0a'] };

const BUILT_IN_OPTIONS: ThemePickerOption[] = THEMES.map((theme) => ({
  id: theme.id as AppSettings['appTheme'],
  label: theme.label,
  swatch: [theme.tokens.appBackground.light, theme.tokens.a.dark[500], theme.tokens.appBackground.dark],
}));

/**
 * Every palette the user can pick, with the profile's own themes appended.
 *
 * Shared by Settings and the new-vault wizard so both offer the same list and the
 * same swatches; a palette added here shows up in both without further wiring.
 */
export function themePickerOptions(customThemes: CustomAppTheme[] = []): ThemePickerOption[] {
  return [
    DEFAULT_OPTION,
    ...BUILT_IN_OPTIONS,
    ...customThemes.map((theme) => ({
      id: theme.id,
      label: theme.label,
      custom: true,
      swatch: [theme.pale, theme.accent, theme.deep],
    })),
  ];
}

export function ThemePalettePicker({
  value,
  onSelect,
  customThemes = [],
  disabled = false,
  onEditCustom,
  onDeleteCustom,
  testId = 'theme-picker',
}: {
  value: AppSettings['appTheme'];
  onSelect: (id: string) => void;
  customThemes?: CustomAppTheme[];
  disabled?: boolean;
  /** Omitted where the palette is only being chosen, as in the new-vault wizard. */
  onEditCustom?: (theme: CustomAppTheme) => void;
  onDeleteCustom?: (id: string) => void;
  testId?: string;
}) {
  const options = themePickerOptions(customThemes);
  return (
    <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2" data-testid={testId}>
      {options.map((option) => {
        const active = (value ?? 'default') === option.id;
        const custom = option.custom ? customThemes.find((theme) => theme.id === option.id) : undefined;
        return (
          <div
            key={option.id}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
              active ? 'border-indigo-500 bg-indigo-500/10 text-neutral-100' : 'border-neutral-800 text-neutral-400'
            }`}
          >
            <button
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onSelect(option.id)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex flex-shrink-0 overflow-hidden rounded-md border border-black/20">
                {option.swatch.map((colour, index) => <span key={index} className="block h-6 w-3" style={{ background: colour }} />)}
              </span>
              <span className="min-w-0 truncate">{option.id === 'default' ? t('Predeterminado') : option.label}</span>
            </button>
            {custom && onEditCustom && (
              <button type="button" className="rounded px-1 text-neutral-500 hover:text-neutral-100" aria-label={t('Editar tema')} onClick={() => onEditCustom(custom)}>✎</button>
            )}
            {custom && onDeleteCustom && (
              <button type="button" className="rounded px-1 text-neutral-500 hover:text-red-300" aria-label={t('Eliminar tema')} onClick={() => onDeleteCustom(custom.id)}>×</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
