/** Callout kinds the guide renderer writes (`> [!kind] Label`), shared by every renderer. */
export const GUIDE_CALLOUT_TYPES: ReadonlySet<string> = new Set([
  'definition', 'formula', 'rule', 'procedure', 'example', 'ai-example', 'ai-analogy',
  'mistake', 'ai-mistake', 'memorize', 'selfcheck', 'web',
]);
