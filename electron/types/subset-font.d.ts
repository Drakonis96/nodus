/**
 * `subset-font` ships no type declarations. Only the subset entry point, used by the PDF
 * exporters to shrink the bundled CJK font to the glyphs a document actually draws, is
 * declared here.
 */
declare module 'subset-font' {
  interface SubsetFontOptions {
    /** Output container. `truetype` (a bare sfnt/TTF) is what pdf-lib embeds. */
    targetFormat?: 'sfnt' | 'truetype' | 'woff' | 'woff2';
    /** Name ids to keep; the default keeps the family name. */
    preserveNameIds?: number[];
    /** Pin variable-font axes, e.g. `{ wght: 400 }`. */
    variationAxes?: Record<string, number>;
  }
  function subsetFont(
    font: Buffer | ArrayBuffer | Uint8Array,
    text: string,
    options?: SubsetFontOptions
  ): Promise<Buffer>;
  export default subsetFont;
}
