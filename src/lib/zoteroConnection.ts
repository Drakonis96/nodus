import type { ZoteroPingResult } from '@shared/types';
import { t, tx } from '../i18n';

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
