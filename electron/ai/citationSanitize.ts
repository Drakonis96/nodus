// Pure citation helpers shared by the suggestion pipeline. Kept free of any
// Electron/DB imports so they can be unit-tested in isolation: parsing,
// de-duplicating and — critically — stripping any nodus:// citation that the
// model is not allowed to use, so a hallucinated passage id never reaches the
// rendered text as a broken "⚠" link.
import type { CitationRef } from '@shared/types';

/** Citation kinds a project suggestion may reference (passages are never project materials). */
export const CITATION_KINDS: CitationRef['kind'][] = ['idea', 'work', 'gap', 'contradiction'];

/** Every kind that can appear in a nodus:// URL, used only to find links in text. */
const ALL_LINK_KINDS = '(idea|work|gap|contradiction|passage)';

/** Provider output is untrusted text. A cut-off percent escape must make the
 * citation unverifiable, never abort an otherwise valid chat response. */
function safeDecodeCitationId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function citationUrl(ref: CitationRef): string {
  return `nodus://${ref.kind}/${encodeURIComponent(ref.id)}`;
}

export function dedupeRefs(refs: CitationRef[]): CitationRef[] {
  const seen = new Set<string>();
  const out: CitationRef[] = [];
  for (const ref of refs) {
    if (!ref?.kind || !ref.id) continue;
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: ref.kind, id: ref.id });
  }
  return out;
}

/** Keep only refs of an allowed project-citation kind, de-duplicated. */
export function normalizeRefs(refs: CitationRef[]): CitationRef[] {
  return dedupeRefs((refs ?? []).filter((ref) => ref?.kind && ref.id && CITATION_KINDS.includes(ref.kind)));
}

/** All distinct nodus:// citations referenced in a piece of markdown. */
export function extractCitationRefs(text: string): CitationRef[] {
  const out: CitationRef[] = [];
  const re = new RegExp(`nodus:\\/\\/${ALL_LINK_KINDS}\\/([^\\s)"'<>]+)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({ kind: match[1] as CitationRef['kind'], id: safeDecodeCitationId(match[2]) });
  }
  return dedupeRefs(out);
}

/** Drop any [label](nodus://kind/id) whose `kind:id` isn't allowed, then tidy spacing/punctuation. */
export function stripDisallowedCitations(text: string, allowed: Set<string>): string {
  return (
    text
      // 1) Markdown citation links: keep allowed kind/id, drop everything else.
      .replace(new RegExp(`\\[[^\\]]*\\]\\(nodus:\\/\\/${ALL_LINK_KINDS}\\/([^\\s)]+)\\)`, 'g'), (match, kind, id) => {
        const key = `${kind}:${safeDecodeCitationId(id)}`;
        return allowed.has(key) ? match : '';
      })
      // 2) A provider may stop mid-link or put spaces inside a malformed URL.
      // Such a link cannot be clicked or verified, so remove the whole citation
      // chip (up to the line/end) instead of leaking a broken nodus:// target.
      .replace(/\[[^\]]*\]\(nodus:\/\/[^\n)]*\s+[^\n)]*\)/g, '')
      .replace(/\[[^\]]*\]\(nodus:\/\/[^\n)]*$/gm, '')
      // 3) Any leftover bare nodus:// URL in prose — including malformed ones with
      //    no kind (e.g. `nodus://<uuid>`). The lookbehind protects the `](nodus://…)`
      //    of the allowed links kept above so we only remove stray prose URLs.
      .replace(/(?<!\]\()nodus:\/\/[^\s)\]]+/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,;:)])/g, '$1')
      .replace(/\(\s*\)/g, '')
      .replace(/\[\s*\]/g, '')
      .replace(/[([]\s*$/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Keep only citations that both resolve locally and were actually present in the model's source context. */
export function supportedCitationKeys(
  refs: CitationRef[],
  verified: Record<string, boolean>,
  sourceContext: string,
): Set<string> {
  const allowed = new Set<string>();
  for (const ref of dedupeRefs(refs)) {
    const key = `${ref.kind}:${ref.id}`;
    if (verified[key] !== true) continue;
    const encoded = encodeURIComponent(ref.id);
    if (sourceContext.includes(ref.id) || sourceContext.includes(encoded)) allowed.add(key);
  }
  return allowed;
}

/** Encode citation ids canonically so passage ids containing `#` remain path data, not URL fragments. */
export function canonicalizeCitationLinks(text: string): string {
  const repairedLocators = text.replace(
    new RegExp(`\\[([^\\]]*)\\]\\(nodus:\\/\\/${ALL_LINK_KINDS}\\/([^,\\s)]+),\\s*((?:p(?:á|a)?g?\\.?|page)\\s*\\d+)\\)`, 'gi'),
    (_match, label: string, kind: string, rawId: string, locator: string) => {
      const visible = label.toLocaleLowerCase().includes(locator.toLocaleLowerCase()) ? label : `${label}, ${locator}`;
      return `[${visible}](nodus://${kind}/${rawId})`;
    },
  );
  return repairedLocators.replace(
    new RegExp(`\\[([^\\]]*)\\]\\(nodus:\\/\\/${ALL_LINK_KINDS}\\/([^\\s)]+)\\)`, 'g'),
    (_match, label: string, kind: string, rawId: string) => {
      let id = rawId;
      try { id = decodeURIComponent(rawId); } catch { /* retain the provider text for deterministic encoding */ }
      return `[${label}](nodus://${kind}/${encodeURIComponent(id)})`;
    },
  );
}
