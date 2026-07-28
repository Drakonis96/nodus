/**
 * The world bible: the encyclopedia as one document you can hand to somebody.
 *
 * Pure, so the part that actually decides whether the artifact is any good — which entries
 * go in, and what happens to a link whose target did not — is testable without a dialog
 * box or a PDF renderer.
 *
 * The rule that governs the whole file: **exporting is handing the file to somebody else.**
 * Spoilers, private notes and unaccepted AI drafts stay out unless the author says
 * otherwise, and a link is never left as a `nodus://` URL — in a Markdown reader that
 * renders as a live broken link, and in a PDF as unclickable blue text.
 */

import { normalizeTitle } from './worldEncyclopedia';
import type { WorldBibleOptions, WorldEntry, WorldEntryKey, WorldEntryRef } from './types';

export interface WorldBibleEntry {
  entry: WorldEntry;
  body: string;
  facts: { label: string; value: string }[];
  backlinks: { key: WorldEntryKey; title: string }[];
  notes: string | null;
  proposedBody: string | null;
}

export interface WorldBibleDoc {
  title: string;
  generatedAt: string;
  entries: WorldBibleEntry[];
}

/** Which entries the options let through, in the requested order. */
export function selectBibleEntries(entries: WorldEntry[], options: WorldBibleOptions): WorldEntry[] {
  const kinds = options.kinds?.length ? new Set(options.kinds) : null;
  const categories = options.categories?.length ? new Set(options.categories) : null;
  const keys = options.entryKeys?.length ? new Set(options.entryKeys) : null;

  const selected = entries.filter((entry) => {
    if (keys) return keys.has(entry.key);
    if (kinds && !kinds.has(entry.kind)) return false;
    if (categories && !(entry.category && categories.has(entry.category))) return false;
    if (entry.spoiler && !options.includeSpoilers) return false;
    return true;
  });

  if (options.order === 'category') {
    return selected.sort(
      (a, b) =>
        (a.category ?? '￿').localeCompare(b.category ?? '￿') || a.titleKey.localeCompare(b.titleKey)
    );
  }
  return selected.sort((a, b) => a.titleKey.localeCompare(b.titleKey));
}

/**
 * The anchor an entry gets in the exported document.
 *
 * The id suffix is not decoration: two entries in different sections can legitimately
 * share a title, and an anchor built from the title alone would send half the links in the
 * document to the wrong entry.
 */
export function bibleAnchor(ref: WorldEntryRef, title: string): string {
  const slug = normalizeTitle(title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entrada';
  return `${ref.kind}-${slug}-${ref.id.replace(/[^A-Za-z0-9]/g, '').slice(-6)}`;
}

const RESOLVED_LINK = /\[([^\]\n]*)\]\(nodus:\/\/world\/([a-z]+)\/([^)\s]+)\)/g;
const PENDING_LINK = /\[\[([^\][\n]+)\]\]/g;

/**
 * Turn the stored links into something an offline reader can follow.
 *
 * Three cases, and the middle one is the one that matters: a target that was filtered out
 * of this export (a different category, a spoiler) becomes plain bold text. Leaving it as
 * a `nodus://` URL would produce a document full of links that look real and go nowhere.
 */
export function rewriteLinksForExport(
  body: string,
  resolve: (ref: WorldEntryRef) => string | null
): string {
  return (body ?? '')
    .replace(RESOLVED_LINK, (whole, label: string, kind: string, id: string) => {
      let decoded = id;
      try {
        decoded = decodeURIComponent(id);
      } catch {
        // A hand-edited body must not take the export down.
      }
      const anchor = resolve({ kind: kind as WorldEntryRef['kind'], id: decoded });
      const text = label || decoded;
      return anchor ? `[${text}](#${anchor})` : `**${text}**`;
    })
    .replace(PENDING_LINK, (whole, text: string) => text.trim() || whole);
}

export function renderWorldBibleMarkdown(doc: WorldBibleDoc, options: WorldBibleOptions): string {
  const anchors = new Map<WorldEntryKey, string>(
    doc.entries.map((item) => [item.entry.key, bibleAnchor(item.entry, item.entry.title)])
  );
  const resolve = (ref: WorldEntryRef) => anchors.get(`${ref.kind}:${ref.id}`) ?? null;

  const lines: string[] = [`# ${doc.title}`, ''];
  lines.push(`_${doc.generatedAt}_`, '');

  lines.push('## Índice', '');
  let currentGroup: string | null = null;
  for (const item of doc.entries) {
    if (options.order === 'category' && item.entry.category !== currentGroup) {
      currentGroup = item.entry.category ?? null;
      lines.push(`- **${currentGroup ?? 'Sin clase'}**`);
    }
    const indent = options.order === 'category' ? '  ' : '';
    lines.push(`${indent}- [${item.entry.title}](#${anchors.get(item.entry.key)})`);
  }
  lines.push('');

  for (const item of doc.entries) {
    lines.push(`## ${item.entry.title} {#${anchors.get(item.entry.key)}}`, '');
    const subtitle = [item.entry.category, item.entry.aliases.join(', ')].filter(Boolean).join(' · ');
    if (subtitle) lines.push(`_${subtitle}_`, '');
    if (item.facts.length) {
      for (const fact of item.facts) lines.push(`- **${fact.label}:** ${fact.value}`);
      lines.push('');
    }
    if (item.body.trim()) lines.push(rewriteLinksForExport(item.body, resolve), '');
    if (options.includeNotes && item.notes?.trim()) {
      lines.push('> ' + rewriteLinksForExport(item.notes, resolve).split('\n').join('\n> '), '');
    }
    if (options.includeProposals && item.proposedBody?.trim()) {
      lines.push('> **Propuesta sin aceptar**', '>', '> ' + item.proposedBody.split('\n').join('\n> '), '');
    }
    if (item.backlinks.length) {
      const mentions = item.backlinks
        .filter((backlink) => anchors.has(backlink.key))
        .map((backlink) => `[${backlink.title}](#${anchors.get(backlink.key)})`);
      if (mentions.length) lines.push(`Mencionada en: ${mentions.join(', ')}`, '');
    }
  }
  return lines.join('\n');
}

/** Section-per-category input for the styled PDF, with each entry as a TOC child. */
export function renderWorldBibleSections(
  doc: WorldBibleDoc,
  options: WorldBibleOptions,
  toHtml: (markdown: string) => string
): { id: string; number: string; title: string; html: string; tocChildren: { id: string; title: string }[] }[] {
  const anchors = new Map<WorldEntryKey, string>(
    doc.entries.map((item) => [item.entry.key, bibleAnchor(item.entry, item.entry.title)])
  );
  const resolve = (ref: WorldEntryRef) => anchors.get(`${ref.kind}:${ref.id}`) ?? null;

  const groups = new Map<string, WorldBibleEntry[]>();
  for (const item of doc.entries) {
    const key = options.order === 'category' ? item.entry.category ?? 'Sin clase' : 'Entradas';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.entries()].map(([group, items], index) => ({
    id: `grupo-${index + 1}`,
    number: String(index + 1),
    title: group,
    tocChildren: items.map((item) => ({ id: anchors.get(item.entry.key) as string, title: item.entry.title })),
    html: items
      .map((item) => {
        const parts: string[] = [
          `<h3 id="${anchors.get(item.entry.key)}">${escapeHtmlText(item.entry.title)}</h3>`,
        ];
        const subtitle = [item.entry.category, item.entry.aliases.join(', ')].filter(Boolean).join(' · ');
        if (subtitle) parts.push(`<p class="eyebrow">${escapeHtmlText(subtitle)}</p>`);
        if (item.facts.length) {
          parts.push(
            `<dl>${item.facts
              .map((fact) => `<dt>${escapeHtmlText(fact.label)}</dt><dd>${escapeHtmlText(fact.value)}</dd>`)
              .join('')}</dl>`
          );
        }
        if (item.body.trim()) parts.push(toHtml(rewriteLinksForExport(item.body, resolve)));
        if (options.includeNotes && item.notes?.trim()) {
          parts.push(`<blockquote>${toHtml(rewriteLinksForExport(item.notes, resolve))}</blockquote>`);
        }
        return parts.join('\n');
      })
      .join('\n'),
  }));
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
