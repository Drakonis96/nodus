import { getDb } from '../db/database';
import { fullQuoteMatchLength, passageForQuote, quoteMatchLength, type StoredPassageRow } from './documentProfile';

const REPAIR_FLAG = 'document_support_passages_v1';

/**
 * Profiles published before passageForQuote required the quote chose a support's passage
 * by word overlap across the whole document, so a citation could open a passage pages
 * away that merely shared the quote's words (3 of 247 supports in a real vault). Once per
 * vault, re-point every support whose passage lacks its quote at the passage that holds
 * it; a support no current passage holds is left as it is. Returns how many moved, or
 * null when it already ran or failed (then it is retried at the next start).
 */
export function repairDocumentSupportPassagesOnce(): number | null {
  const db = getDb();
  const done = db.prepare('SELECT value FROM settings WHERE key = ?').get(REPAIR_FLAG) as { value: string } | undefined;
  if (done?.value === '1') return null;
  try {
    return db.transaction(() => {
      let repaired = 0;
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'document_profile_support'").get()) {
        const supports = db.prepare(
          `SELECT s.support_id, s.nodus_id, s.passage_id, s.quote, s.page_start, s.source_ref, s.page_start_number, p.text
             FROM document_profile_support s JOIN passages p ON p.passage_id = s.passage_id AND p.nodus_id = s.nodus_id
            WHERE s.quote IS NOT NULL AND s.quote <> ''`
        ).all() as Array<{ support_id: string; nodus_id: string; passage_id: string; quote: string; page_start: string | null; source_ref: string | null; page_start_number: number | null; text: string }>;
        const passageText = db.prepare('SELECT text FROM passages WHERE passage_id = ? AND nodus_id = ?');
        const move = db.prepare('UPDATE document_profile_support SET passage_id = ? WHERE support_id = ?');
        // Each book's passages are read once, not once per support: 7,447 supports over 48 books
        // re-read whole books ~13.5 million passage-times before the window opened, for longer
        // than ten minutes.
        const passagesOf = new Map<string, StoredPassageRow[]>();
        const bookPassages = db.prepare('SELECT passage_id, text, source_ref, page_number FROM passages WHERE nodus_id = ? ORDER BY chunk_index');
        for (const support of supports) {
          const current = quoteMatchLength(support.text, support.quote);
          // A support moves only to a passage holding strictly more of the quote's opening, so
          // one whose passage already holds all of it — nearly every support — cannot move.
          if (current >= fullQuoteMatchLength(support.quote)) continue;
          let stored = passagesOf.get(support.nodus_id);
          if (!stored) {
            stored = bookPassages.all(support.nodus_id) as StoredPassageRow[];
            passagesOf.set(support.nodus_id, stored);
          }
          const better = passageForQuote(support.nodus_id, support.quote,
            { label: support.page_start, sourceRef: support.source_ref, pageNumber: support.page_start_number }, null, stored);
          if (!better || better === support.passage_id) continue;
          const text = (passageText.get(better, support.nodus_id) as { text: string } | undefined)?.text;
          // Move only to a passage that holds strictly more of the quote's opening. A quote
          // crossing the end of its chunk keeps its passage: nothing holds more of it.
          if (text == null || quoteMatchLength(text, support.quote) <= current) continue;
          move.run(better, support.support_id);
          repaired += 1;
        }
      }
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(REPAIR_FLAG, '1');
      return repaired;
    })();
  } catch (error) {
    console.error(`[documents] support passage repair failed, will retry on next start: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
