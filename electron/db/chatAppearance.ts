/** The icon and colour a research chat project or notebook shows in the history. */
export function cleanAppearanceIcon(icon: unknown): string | null {
  if (icon == null) return null;
  if (typeof icon !== 'string' || !/^[a-zA-Z]{1,40}$/.test(icon)) throw new Error('research_chat_invalid_icon');
  return icon;
}
export function cleanAppearanceColor(color: unknown): string | null {
  if (color == null) return null;
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('research_chat_invalid_color');
  return color.toLowerCase();
}
