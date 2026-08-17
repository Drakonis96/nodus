/**
 * The project's public accounts, in one place because two surfaces show them —
 * the What's New modal and Settings → About Nodus. PayPal and Ko-fi were copied
 * into both by hand and drifted (Ko-fi reached the modal a release after the
 * About card), so these live in a single table both surfaces map over.
 *
 * `icon` is a key of the renderer's ICON_PATHS catalogue; `label` is a brand
 * name and is deliberately NOT translated.
 */

export interface SocialLink {
  id: 'reddit' | 'youtube' | 'x';
  label: string;
  url: string;
  icon: string;
  /**
   * The glyph IS the brand's name, so printing the label beside it reads "𝕏 X".
   * The label still goes on the button as its accessible name.
   */
  glyphIsWordmark?: true;
}

export const NODUS_SOCIAL_LINKS: readonly SocialLink[] = [
  { id: 'reddit', label: 'Reddit', url: 'https://www.reddit.com/r/NodusApp/', icon: 'reddit' },
  { id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@nodus_app', icon: 'youtube' },
  // The close button already owns the name `x` in ICON_PATHS, so the brand mark
  // is `brandX` — an icon name collision would silently render the wrong glyph.
  { id: 'x', label: 'X', url: 'https://x.com/nodusresearch', icon: 'brandX', glyphIsWordmark: true },
];
