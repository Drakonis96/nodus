import type { ZoteroPingResult } from '@shared/types';
import { t, tr, tx } from '../i18n';

/**
 * The line every Zotero connection check shows when it fails, plus what to do about it.
 *
 * A closed Zotero — or one whose local API is switched off — answers nothing at all, so
 * the check only has a bare transport error to report ("The operation could not be
 * completed."). That names neither the cause nor the fix, which is why the hint travels
 * with the failure instead of living in one screen's copy.
 */

/** "Unavailable: <technical detail>", the detail being the transport error or HTTP status. */
export function zoteroPingErrorText(status: Pick<ZoteroPingResult, 'message'> | null | undefined): string {
  return tx('No disponible: {msg}', { msg: status?.message?.trim() || t('sin respuesta') });
}

/**
 * The one setting that explains both a refused connection and a 403. An HTTP failure
 * with any other status came from a Zotero that IS running, so it gets no hint.
 */
export function zoteroConnectionHint(status: Pick<ZoteroPingResult, 'reason'> | null | undefined): string | null {
  if (status?.reason === 'http') return null;
  return t('Comprueba que Zotero esté abierto y que «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero» esté activado en los ajustes Avanzados de Zotero.');
}

/**
 * A Zotero failure as the user should read it, wherever it surfaced.
 *
 * Electron prefixes a rejected `invoke` with its own channel name ("Error invoking
 * remote method 'library:zoteroLibraries': Error: …"), which puts an IPC channel
 * where the cause belongs and pushes the sentence that matters off the end of the
 * line. The class name goes with it: the localized path rethrows a plain `Error`,
 * but a message already in the interface's language is rethrown as itself, and
 * Electron serializes that one as `ZoteroRequestError: …`. What remains is
 * translated — these sentences are written in Spanish in the main process, and `tr`
 * is what carries them into the interface's language.
 */
export function zoteroFailureText(cause: unknown): string {
  const message = (cause instanceof Error ? cause.message : String(cause))
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^\w*Error:\s*/, '');
  return tr(message);
}
