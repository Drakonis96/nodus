/** Shared visual contract for every section and add action in a person dossier. */
export const PERSON_DOSSIER_SECTION_CLASS = 'rounded-md border border-neutral-800 bg-neutral-900/40 p-3';

/**
 * Add actions are icon-only squares: a translated label inside the button wrapped into a
 * vertical stack and squeezed the section description next to it, so the wording moved to
 * the tooltip and the button keeps a fixed, language-independent footprint.
 */
export const PERSON_DOSSIER_ADD_BUTTON_CLASS =
  'btn btn-ghost h-8 w-8 shrink-0 justify-center border border-neutral-700 p-0';

/** Add actions whose label carries state (busy, regenerate…) and cannot collapse to an icon. */
export const PERSON_DOSSIER_ACTION_BUTTON_CLASS =
  'btn btn-ghost h-auto min-h-9 min-w-44 shrink-0 justify-center gap-1.5 whitespace-normal border border-neutral-700 px-4 py-2 text-center text-[11px] leading-snug';
