import type { AudioSegment } from '@shared/types';

// Pure text helpers that turn rendered report / immersion content into clean
// prose for narration. Kept free of any Electron/DB imports so the citation- and
// markdown-stripping rules can be unit-tested in isolation. The guiding rule from
// the product spec: narrate only the prose — never the citation "buttons".

/**
 * Convert a markdown string into plain, speakable prose:
 *  - drops citation links `[label](nodus://kind/id)` entirely (label included),
 *    since those render as inline citation buttons the user does not want read;
 *  - drops any stray bare `nodus://…` url;
 *  - unwraps ordinary links `[text](url)` to just their text;
 *  - removes images, code fences, tables, blockquote/list markers and emphasis;
 *  - keeps heading text as a sentence (so the narrator announces the section)
 *    and normalises whitespace so sentence splitting downstream is clean.
 */
export function markdownToSpeech(md: string): string {
  if (!md) return '';
  let text = md.replace(/\r\n/g, '\n');

  // 1) Remove fenced code blocks wholesale — never narratable.
  text = text.replace(/```[\s\S]*?```/g, '');

  // 2) Remove images ![alt](url).
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  // 3) Citation buttons: [label](nodus://kind/id) → removed entirely (label + link).
  text = text.replace(/\[[^\]]*\]\(nodus:\/\/[^)]*\)/g, '');

  // 4) Ordinary links [text](url) → text.
  text = text.replace(/\[([^\]]*)\]\((?!nodus:\/\/)[^)]*\)/g, '$1');

  // 5) Any leftover bare nodus:// url in prose.
  text = text.replace(/nodus:\/\/[^\s)\]]+/g, '');

  // 6) Line-oriented cleanup: headings, lists, blockquotes, tables, rules.
  const lines = text.split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) {
      out.push('');
      continue;
    }
    // Markdown tables and horizontal rules: skip — they do not narrate well.
    if (/^\|.*\|$/.test(line)) continue;
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) continue;
    // Headings: keep the text, ensure it ends as its own sentence for a pause.
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      const h = heading[1].replace(/[#*_`~]/g, '').trim();
      if (h) out.push(/[.!?:]$/.test(h) ? h : `${h}.`);
      continue;
    }
    // Blockquote marker.
    line = line.replace(/^>\s?/, '');
    // Ordered / unordered list markers → sentence with terminal punctuation.
    const li = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const item = stripInline(li[1]);
      if (item) out.push(/[.!?:;]$/.test(item) ? item : `${item}.`);
      continue;
    }
    out.push(stripInline(line));
  }

  return out
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** Remove inline emphasis / code markers and footnote refs, keep the words. */
function stripInline(s: string): string {
  return s
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .trim();
}

/** Rough character budget above which a segment is split so no single synthesis
 *  call runs unboundedly long. Sentence-aware so we never cut mid-sentence. */
const SEGMENT_SPLIT_CHARS = 2600;

/** Split a long prose block into sentence-aligned chunks under the char budget. */
export function splitForNarration(text: string, limit = SEGMENT_SPLIT_CHARS): string[] {
  const clean = text.trim();
  if (clean.length <= limit) return clean ? [clean] : [];
  const sentences = clean.match(/[^.!?]+[.!?]+(?:["')\]]+)?|\S+$/g) ?? [clean];
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if (current && current.length + s.length > limit) {
      chunks.push(current.trim());
      current = '';
    }
    current += s;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ── Deep Research ────────────────────────────────────────────────────────────

interface DeepResearchDraftLike {
  title?: string;
  abstract?: string;
  draftMarkdown?: string;
}

/**
 * Segment a Deep Research report for narration: an opening segment (title +
 * abstract) followed by one segment per top-level section of the body. Long
 * sections are further split so each clip stays a manageable length.
 */
export function deepResearchSegments(draft: DeepResearchDraftLike): AudioSegment[] {
  const segments: AudioSegment[] = [];
  const title = (draft.title ?? '').trim();
  const abstract = markdownToSpeech(draft.abstract ?? '');
  const intro = [title ? `${title}.` : '', abstract].filter(Boolean).join('\n\n').trim();
  if (intro) segments.push({ index: 0, label: 'Resumen', text: intro });

  for (const section of splitMarkdownSections(draft.draftMarkdown ?? '')) {
    const body = markdownToSpeech(section.body);
    if (!body) continue;
    const parts = splitForNarration([section.heading ? `${section.heading}.` : '', body].filter(Boolean).join('\n\n'));
    parts.forEach((part, i) => {
      segments.push({
        index: segments.length,
        label: sectionLabel(section.heading, i, parts.length),
        text: part,
      });
    });
  }

  // A report with no headings still narrates as a single body segment.
  if (segments.length === 0) {
    const body = markdownToSpeech(draft.draftMarkdown ?? '');
    splitForNarration(body).forEach((part, i, arr) =>
      segments.push({ index: i, label: arr.length > 1 ? `Parte ${i + 1}` : 'Informe', text: part })
    );
  }
  return segments.map((s, i) => ({ ...s, index: i }));
}

function sectionLabel(heading: string | null, part: number, total: number): string {
  const base = heading || 'Sección';
  return total > 1 ? `${base} (${part + 1}/${total})` : base;
}

interface MarkdownSection {
  heading: string | null;
  body: string;
}

/** Split markdown into sections on the shallowest heading level actually used
 *  (usually `##`). Content before the first heading becomes a leading section. */
export function splitMarkdownSections(md: string): MarkdownSection[] {
  const text = (md ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) return [];
  // Find the shallowest heading level present (1–6); default to no splitting.
  let level = 0;
  for (let l = 1; l <= 6; l++) {
    if (new RegExp(`^#{${l}}\\s+`, 'm').test(text)) {
      level = l;
      break;
    }
  }
  if (level === 0) return [{ heading: null, body: text }];
  const re = new RegExp(`^#{${level}}\\s+(.*)$`, 'gm');
  const sections: MarkdownSection[] = [];
  let lastIndex = 0;
  let lastHeading: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const body = text.slice(lastIndex, match.index).trim();
    if (lastIndex === 0 && !lastHeading) {
      if (body) sections.push({ heading: null, body });
    } else if (body || lastHeading) {
      sections.push({ heading: lastHeading, body });
    }
    lastHeading = match[1].replace(/[#*_`~]/g, '').trim() || null;
    lastIndex = re.lastIndex;
  }
  const tail = text.slice(lastIndex).trim();
  if (tail || lastHeading) sections.push({ heading: lastHeading, body: tail });
  return sections.filter((s) => s.body || s.heading);
}

// ── Immersion ────────────────────────────────────────────────────────────────

interface ImmersionStationLike {
  title?: string;
  question?: string;
  context?: string;
  synthesis?: string;
  takeaways?: string[];
}

interface ImmersionPlanLike {
  title?: string;
  topic?: string;
  overview?: string;
  stations?: ImmersionStationLike[];
}

/**
 * Segment an immersion into one narratable clip per stage: a panorama segment
 * from the overview, then one per station (its framing context, the lesson, and
 * the takeaways). Contrasts/exam are interactive/tabular and intentionally not
 * narrated. Long stations are split so each clip stays a reasonable length.
 */
export function immersionSegments(plan: ImmersionPlanLike): AudioSegment[] {
  const segments: AudioSegment[] = [];
  const overview = markdownToSpeech(plan.overview ?? '');
  if (overview) {
    const title = (plan.title ?? plan.topic ?? '').trim();
    const text = [title ? `${title}.` : '', overview].filter(Boolean).join('\n\n');
    splitForNarration(text).forEach((part, i, arr) =>
      segments.push({ index: segments.length, label: arr.length > 1 ? `Panorama (${i + 1}/${arr.length})` : 'Panorama', text: part })
    );
  }

  (plan.stations ?? []).forEach((station, si) => {
    const context = markdownToSpeech(station.context ?? '');
    const lesson = markdownToSpeech(station.synthesis ?? '');
    const takeaways = (station.takeaways ?? []).map((t) => markdownToSpeech(t)).filter(Boolean);
    const takeawayText = takeaways.length ? `Para recordar. ${takeaways.map(ensureStop).join(' ')}` : '';
    const stationTitle = (station.title ?? station.question ?? `Estación ${si + 1}`).trim();
    const body = [context, lesson, takeawayText].filter(Boolean).join('\n\n');
    if (!body) return;
    const full = `${stationTitle}.\n\n${body}`;
    const parts = splitForNarration(full);
    parts.forEach((part, i) =>
      segments.push({
        index: segments.length,
        label: parts.length > 1 ? `Estación ${si + 1} · ${stationTitle} (${i + 1}/${parts.length})` : `Estación ${si + 1} · ${stationTitle}`,
        text: part,
      })
    );
  });

  return segments.map((s, i) => ({ ...s, index: i }));
}

function ensureStop(s: string): string {
  return /[.!?]$/.test(s) ? s : `${s}.`;
}
