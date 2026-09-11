import type { ChemistryNotice } from '@shared/chatSkills';

/**
 * Append-only local record of what Chemistry Studio could not fully draw.
 *
 * Nodus ships no telemetry and this changes nothing about that: the file never
 * leaves the machine and is written only when NODUS_CHEMFIG_QA_LOG is set. Its
 * purpose is to replace working a textbook by hand with the requests real use
 * actually produced, so the next thing to fix is chosen from evidence.
 */
export function recordChemistryOutcome(question: string, notices: ChemistryNotice[]): void {
  if (process.env.NODUS_CHEMFIG_QA_LOG !== '1') return;
  const degraded = notices.filter(notice => ['not-drawn', 'partial-validation', 'unverified-svg', 'conflicting-intents'].includes(notice.code));
  if (!degraded.length) return;
  void (async () => {
    try {
      const [{ app }, fs, path] = await Promise.all([import('electron'), import('node:fs/promises'), import('node:path')]);
      const line = JSON.stringify({
        at: new Date().toISOString(),
        // The question is the user's own text and stays on this device, like the rest
        // of the vault. Truncate it so the log stays readable rather than complete.
        question: question.slice(0, 300),
        outcomes: degraded.map(notice => ({ code: notice.code, detail: notice.detail?.slice(0, 300) })),
      });
      await fs.appendFile(path.join(app.getPath('userData'), 'chemistry-outcomes.jsonl'), line + '\n', 'utf8');
    } catch { /* A diagnostic log must never affect the reply. */ }
  })();
}
