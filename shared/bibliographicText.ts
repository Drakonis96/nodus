// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Convert Zotero's supported rich-text title markup into deterministic plain
 * text for UI, search, prompts, and progress messages.
 *
 * Tags are removed before entities are decoded. That order preserves an encoded
 * literal such as `A &lt; B` instead of reinterpreting it as markup.
 */
export function bibliographicPlainText(value: string | null | undefined): string {
  if (!value) return '';
  return stripBibliographicMarkup(value)
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) => decodeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_match, decimal: string) => decodeCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? _match)
    .replace(/\s+/g, ' ')
    .trim();
}

function stripBibliographicMarkup(value: string): string {
  let output = '';
  for (let index = 0; index < value.length;) {
    if (value.startsWith('<!--', index)) {
      const end = value.indexOf('-->', index + 4);
      if (end < 0) {
        output += value.slice(index);
        break;
      }
      output += ' ';
      index = end + 3;
      continue;
    }
    if (value[index] !== '<') {
      output += value[index];
      index += 1;
      continue;
    }

    const opening = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(value.slice(index));
    if (!opening) {
      output += '<';
      index += 1;
      continue;
    }
    let quote: '"' | "'" | null = null;
    let end = index + opening[0].length;
    for (; end < value.length; end += 1) {
      const character = value[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
    }
    if (end >= value.length) {
      // Preserve malformed/truncated metadata rather than deleting its tail.
      output += value.slice(index);
      break;
    }
    const closing = opening[1] === '/';
    const tag = opening[2].toLowerCase();
    if (tag === 'br' || (closing && BLOCK_TAGS.has(tag))) output += ' ';
    index = end + 1;
  }
  return output;
}

const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li']);

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeCodePoint(value: number): string {
  // Malformed metadata must not abort an entire Zotero page import.
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
    return '\uFFFD';
  }
  return String.fromCodePoint(value);
}
