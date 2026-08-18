import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui';
import { t } from '../../i18n';
import type { BrowserConnectorCaptureRequest } from '@shared/browserConnector';

/**
 * Review before a page becomes a Library item.
 *
 * There is a review step at all because a capture WRITES: it creates a real
 * item, downloads attachments and enqueues extraction, OCR and embeddings. On a
 * publisher page the detected metadata is usually excellent; on an ordinary page
 * it is a title and a URL, and silently filing that as a bibliographic record is
 * worse than showing it first.
 *
 * The fields shown are the ones a researcher actually corrects. Everything else
 * the detector found still travels — this edits, it does not replace.
 */
export function BrowserCaptureModal({
  preview, warnings, onClose, onSaved,
}: {
  preview: BrowserConnectorCaptureRequest & { snapshotAvailable?: boolean };
  warnings: string[];
  onClose: () => void;
  onSaved: (result: { title: string; itemId: string }) => void;
}) {
  const [title, setTitle] = useState(preview.metadata.title ?? '');
  const [includeSnapshot, setIncludeSnapshot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The browser page is a native view painting above this HTML, so it has to be
  // hidden while a modal is open or the dialog is drawn underneath it.
  useEffect(() => {
    void window.nodus.setBrowserOverlayVisible(true);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      void window.nodus.setBrowserOverlayVisible(false);
    };
  }, [busy, onClose]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.nodus.saveBrowserCapture(
        { ...preview, metadata: { ...preview.metadata, title: title.trim() || preview.metadata.title } },
        includeSnapshot,
      );
      onSaved({ title: result.title, itemId: result.itemId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const creators = (preview.metadata.creators ?? [])
    .map((entry) => [entry.lastName, entry.firstName].filter(Boolean).join(', ') || entry.name || '')
    .filter(Boolean);

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-6" onClick={() => !busy && onClose()}>
      <div
        data-testid="browser-capture-modal"
        className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-neutral-100">{t('Añadir a la Biblioteca')}</h2>

        <label className="mb-1 block text-xs text-neutral-400">{t('Título')}</label>
        <input
          className="input w-full"
          data-testid="browser-capture-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={busy}
        />

        <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
          <Row label={t('Tipo')} value={preview.metadata.itemType} />
          {creators.length > 0 && <Row label={t('Autoría')} value={creators.slice(0, 4).join(' · ')} />}
          {preview.metadata.date && <Row label={t('Fecha')} value={String(preview.metadata.date)} />}
          {preview.metadata.publicationTitle && <Row label={t('Publicación')} value={preview.metadata.publicationTitle} />}
          {preview.metadata.doi && <Row label="DOI" value={preview.metadata.doi} />}
          <Row label={t('Origen')} value={preview.pageUrl} />
          {/* Access date is always now, and is what makes a web citation citable. */}
          <Row label={t('Consultado')} value={new Date().toLocaleDateString()} />
        </dl>

        {(preview.attachments?.length ?? 0) > 0 && (
          <p className="mt-3 text-xs text-neutral-400">
            {t('Se intentarán adjuntar {n} archivos detectados en la página.')
              .replace('{n}', String(preview.attachments?.length ?? 0))}
          </p>
        )}

        {preview.snapshotAvailable && (
          <label className="mt-3 flex items-center gap-2 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={includeSnapshot}
              disabled={busy}
              onChange={(event) => setIncludeSnapshot(event.target.checked)}
            />
            {t('Guardar también una copia del HTML de la página')}
          </label>
        )}

        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-amber-400">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}

        {error && (
          <p className="mt-3 flex items-start gap-2 text-xs text-red-400">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button
            type="button"
            data-testid="browser-capture-save"
            className="btn btn-ghost border border-indigo-500/60"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? t('Guardando…') : t('Añadir a la Biblioteca')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="min-w-0 break-words text-neutral-300">{value}</dd>
    </>
  );
}
