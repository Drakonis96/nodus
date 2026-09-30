/**
 * How a guide is put together, measured on its Markdown: how much of it is prose and
 * how much sits inside a box, how many boxes of each kind there are, how much of it the
 * AI wrote and how many times the full AI notice is printed. The live campaign and the
 * docs report it so that "the guide is a wall of boxes" is a number, not an impression.
 */
export interface GuideShape {
  words: number;
  proseWords: number;
  boxedWords: number;
  aiWords: number;
  /** Shares of all words, 0–1. */
  proseShare: number;
  boxedShare: number;
  aiShare: number;
  callouts: number;
  byKind: Record<string, number>;
  /** How many times the full AI notice sentence appears. */
  aiNotices: number;
  aiCallouts: number;
}

const wordsOf = (line: string) => line.replace(/\(nodus:\/\/[^)]*\)/g, '').split(/\s+/).filter(Boolean).length;

/** `notice` is the sentence the guide prints on its first AI block (`labels.aiNote`). */
export function guideShape(markdown: string, notice?: string): GuideShape {
  const byKind: Record<string, number> = {};
  let inBox = false;
  let inAi = false;
  let words = 0;
  let boxedWords = 0;
  let aiWords = 0;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const head = line.match(/^>\s?\[!([a-z][a-z-]*)\]/);
    if (head) {
      inBox = true;
      inAi = head[1].startsWith('ai-');
      byKind[head[1]] = (byKind[head[1]] ?? 0) + 1;
    } else if (!line.startsWith('>')) {
      inBox = false;
      inAi = false;
    }
    const count = wordsOf(line);
    words += count;
    if (inBox) boxedWords += count;
    if (inAi) aiWords += count;
  }
  const share = (value: number) => (words ? Math.round((value / words) * 1000) / 1000 : 0);
  return {
    words,
    proseWords: words - boxedWords,
    boxedWords,
    aiWords,
    proseShare: share(words - boxedWords),
    boxedShare: share(boxedWords),
    aiShare: share(aiWords),
    callouts: Object.values(byKind).reduce((sum, count) => sum + count, 0),
    byKind,
    aiNotices: notice ? markdown.split(notice).length - 1 : 0,
    aiCallouts: Object.entries(byKind).filter(([kind]) => kind.startsWith('ai-')).reduce((sum, [, count]) => sum + count, 0),
  };
}
