import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArchiveExcerpt,
  ArchiveFileRole,
  ArchiveItemFile,
  ArchiveTextKind,
  ArchiveTextStatus,
  ArchiveTextVersion,
} from '@shared/archiveTypes';
import type {
  PrimarySourceAnalysis,
  PrimarySourceArchiveRow,
  PrimarySourceArchiveWorkspace,
  PrimarySourceDossier,
  PrimarySourceEntityProposal,
  PrimarySourceEvidenceRole,
  PrimarySourceProposalCandidate,
  PrimarySourceProposalKind,
  PrimarySourceProposalStatus,
} from '@shared/primarySourcesTypes';
import { primarySourceExcerptDeepLink } from '@shared/primarySourceDeepLink';
import { Icon } from '../components/ui';
import { DocumentIconPicker } from '../components/DocumentIconPicker';
import { DocTypeForm, DocTypeSelect } from '../components/DocTypeForm';
import { PlacePicker } from '../components/PlacePicker';
import { archiveFileUrl } from '../lib/archiveFileUrl';
import { archiveDocumentIcon, suggestedArchiveDocumentIcon } from '../lib/archiveDocumentIcon';
import { t } from '../i18n';

type DossierTab = 'source' | 'description' | 'text' | 'evidence' | 'analysis' | 'notes' | 'history';

const TABS: Array<[DossierTab, string]> = [
  ['source', 'Fuente'],
  ['description', 'Descripción'],
  ['text', 'Texto'],
  ['evidence', 'Evidencias'],
  ['analysis', 'Análisis'],
  ['notes', 'Notas'],
  ['history', 'Historial'],
];

const ROLE_LABELS: Record<ArchiveFileRole, string> = {
  master: 'Máster',
  access: 'Copia de acceso',
  thumbnail: 'Miniatura',
  ocr: 'Archivo OCR',
  transcript: 'Transcripción',
  derivative: 'Derivado',
  supplement: 'Suplemento',
};

const STATUS_LABELS: Record<ArchiveItemFile['verificationStatus'], string> = {
  pending: 'Pendiente de verificar',
  verified: 'Verificado',
  mismatch: 'Checksum no coincidente',
  missing: 'Archivo ausente',
  error: 'Error de verificación',
};

const TEXT_KIND_LABELS: Record<ArchiveTextKind, string> = {
  ocr: 'OCR',
  transcription: 'Transcripción',
  diplomatic: 'Texto diplomático',
  normalized: 'Texto normalizado',
  translation: 'Traducción',
};

const TEXT_STATUS_LABELS: Record<ArchiveTextStatus, string> = {
  requested: 'Solicitado',
  automatic: 'Automático sin revisar',
  in_review: 'En revisión',
  reviewed: 'Revisado',
  closed: 'Cerrado',
};

const ACTION_LABELS: Record<PrimarySourceDossier['history'][number]['action'], string> = {
  file_created: 'Representación añadida',
  master_version_added: 'Nueva versión de máster',
  file_superseded: 'Versión marcada como anterior',
  file_metadata_updated: 'Orden o etiqueta actualizados',
  integrity_checked: 'Integridad verificada',
  thumbnail_regenerated: 'Miniatura regenerada',
  file_exported: 'Copia guardada',
  file_opened_external: 'Copia temporal abierta',
  text_version_created: 'Versión de texto creada',
  text_review_status_changed: 'Estado de texto actualizado',
  excerpt_created: 'Fragmento citable creado',
  excerpt_review_status_changed: 'Estado del fragmento actualizado',
  source_analysis_saved: 'Análisis crítico guardado',
  proposal_extraction_completed: 'Extracción de propuestas completada',
  proposal_decided: 'Propuesta revisada',
  proposal_materialized: 'Propuesta materializada con evidencia',
  entity_resolution_created: 'Resolución de identidad registrada',
  entity_resolution_reverted: 'Resolución de identidad revertida',
  toponym_resolved: 'Topónimo resuelto',
  toponym_resolution_reverted: 'Resolución de topónimo revertida',
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = -1;
  do {
    size /= 1024;
    index += 1;
  } while (size >= 1024 && index < units.length - 1);
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
}

function preferredFile(files: ArchiveItemFile[]): ArchiveItemFile | null {
  const active = files.filter((file) => !file.supersededAt && file.hasContent);
  return active.find((file) => file.role === 'access')
    ?? active.find((file) => file.role === 'master')
    ?? active[0]
    ?? files[0]
    ?? null;
}

function representationRoot(file: ArchiveItemFile, files: ArchiveItemFile[]): ArchiveItemFile {
  const byId = new Map(files.map((candidate) => [candidate.fileId, candidate]));
  let current = file;
  const seen = new Set<string>();
  while (current.parentFileId && byId.has(current.parentFileId) && !seen.has(current.fileId)) {
    seen.add(current.fileId);
    current = byId.get(current.parentFileId)!;
  }
  return current;
}

function bestPreviewFile(selected: ArchiveItemFile, files: ArchiveItemFile[]): ArchiveItemFile {
  const directlyPreviewable = canPreview(selected);
  if (directlyPreviewable) return selected;
  return files.find((file) =>
    file.parentFileId === selected.fileId
    && !file.supersededAt
    && ['access', 'derivative', 'thumbnail'].includes(file.role)
    && canPreview(file)
  ) ?? selected;
}

function canPreview(file: ArchiveItemFile): boolean {
  const mime = file.mimeType || '';
  return mime === 'application/pdf'
    || mime.startsWith('audio/')
    || mime.startsWith('video/')
    || (mime.startsWith('image/') && !['image/tiff', 'image/x-tiff'].includes(mime))
    || isText(file)
    || isTable(file);
}

function isText(file: ArchiveItemFile): boolean {
  const mime = file.mimeType || '';
  return mime.startsWith('text/')
    || ['application/json', 'application/xml', 'application/ld+json'].includes(mime);
}

function isTable(file: ArchiveItemFile): boolean {
  const name = file.originalFileName?.toLocaleLowerCase() || '';
  return file.mimeType === 'text/csv'
    || file.mimeType === 'text/tab-separated-values'
    || name.endsWith('.csv')
    || name.endsWith('.tsv');
}

export function PrimarySourceDossierView({
  initialRow,
  initialExcerptId = null,
  initialTextTarget = null,
  workspace,
  onBack,
  onChanged,
  presentation = 'page',
}: {
  initialRow: PrimarySourceArchiveRow;
  initialExcerptId?: string | null;
  initialTextTarget?: { textVersionId: string; start: number; end: number } | null;
  workspace: PrimarySourceArchiveWorkspace;
  onBack: () => void;
  onChanged: () => Promise<void>;
  presentation?: 'page' | 'modal';
}) {
  const [dossier, setDossier] = useState<PrimarySourceDossier | null>(null);
  const [tab, setTab] = useState<DossierTab>(initialExcerptId || initialTextTarget ? 'text' : 'source');
  const [focusedExcerptId, setFocusedExcerptId] = useState<string | null>(initialExcerptId);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<{ role: ArchiveFileRole; supersedesFileId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await window.nodus.getPrimarySourceDossier(initialRow.item.itemId);
    setDossier(next);
    if (next) {
      setSelectedFileId((current) =>
        current && next.files.some((file) => file.fileId === current)
          ? current
          : preferredFile(next.files)?.fileId ?? null
      );
    }
    return next;
  }, [initialRow.item.itemId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!initialExcerptId && !initialTextTarget) return;
    if (initialExcerptId) setFocusedExcerptId(initialExcerptId);
    setTab('text');
  }, [initialExcerptId, initialTextTarget]);

  const selected = dossier?.files.find((file) => file.fileId === selectedFileId)
    ?? (dossier ? preferredFile(dossier.files) : null);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      await onChanged();
      setNotice(t(success));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const moveSelectedGroup = async (direction: -1 | 1) => {
    if (!dossier || !selected) return;
    const root = representationRoot(selected, dossier.files);
    const roots = dossier.files
      .filter((file) => file.parentFileId === null && !file.supersededAt)
      .sort((a, b) => a.sequenceNo - b.sequenceNo || a.createdAt.localeCompare(b.createdAt));
    const index = roots.findIndex((file) => file.fileId === root.fileId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= roots.length) return;
    [roots[index], roots[target]] = [roots[target], roots[index]];
    await run(
      () => window.nodus.reorderPrimarySourceFileGroups(dossier.row.item.itemId, roots.map((file) => file.fileId)),
      'Secuencia actualizada.'
    );
  };

  if (!dossier) {
    return (
      <div role="status" aria-live="polite" className="grid h-full place-items-center bg-neutral-50 text-sm text-neutral-500 dark:bg-neutral-950">
        {t('Cargando dossier…')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="primary-source-dossier">
      <header className="shrink-0 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start gap-3 px-4 py-3">
          <button
            className="btn btn-ghost mt-0.5 h-8 w-8 p-0"
            onClick={onBack}
            title={t(presentation === 'modal' ? 'Cerrar ficha' : 'Volver al archivo')}
            aria-label={t(presentation === 'modal' ? 'Cerrar ficha' : 'Volver al archivo')}
          >
            <Icon name={presentation === 'modal' ? 'x' : 'arrowLeft'} size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
                <Icon name={archiveDocumentIcon(dossier.row.profile.metadata, dossier.row.item.docType, dossier.row.item.kind)} size={14} />
              </span>
              <h1 className="truncate text-base font-semibold">{dossier.row.item.title}</h1>
              {dossier.row.unit.referenceCode && <code className="rounded bg-neutral-100 px-2 py-0.5 text-[11px] dark:bg-neutral-800">{dossier.row.unit.referenceCode}</code>}
              <StatusPill status={dossier.row.profile.accessStatus} />
            </div>
            <p className="mt-1 truncate text-xs text-neutral-500">
              {[dossier.row.repositoryName, dossier.row.unit.creatorDisplay, dossier.row.unit.date.display].filter(Boolean).join(' · ') || t('Procedencia por completar')}
            </p>
          </div>
          <button
            className="btn btn-secondary h-8 w-8 p-0"
            title={t('Verificar todo')}
            aria-label={t('Verificar todo')}
            disabled={busy}
            onClick={() => void run(
            () => window.nodus.verifyPrimarySourceFiles(dossier.row.item.itemId),
            'Verificación de integridad completada.'
          )}>
            <Icon name="check" size={14} />
          </button>
        </div>
        <nav className="flex overflow-x-auto px-3" aria-label={t('Secciones del dossier')} role="tablist">
          {TABS.map(([value, label], index) => (
            <button
              key={value}
              id={`dossier-tab-${value}`}
              role="tab"
              aria-selected={tab === value}
              aria-controls="dossier-tabpanel"
              tabIndex={tab === value ? 0 : -1}
              className={`border-b-2 px-3 py-2 text-xs font-medium ${tab === value ? 'border-indigo-600 text-indigo-700 dark:border-indigo-300 dark:text-indigo-200' : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}`}
              onClick={() => setTab(value)}
              onKeyDown={(event) => {
                const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (!delta) return;
                event.preventDefault();
                const next = (index + delta + TABS.length) % TABS.length;
                setTab(TABS[next][0]);
                const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                buttons?.[next]?.focus();
              }}
            >
              {t(label)}
            </button>
          ))}
        </nav>
      </header>

      {notice && <p role="status" aria-live="polite" className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</p>}

      <main
        id="dossier-tabpanel"
        role="tabpanel"
        aria-labelledby={`dossier-tab-${tab}`}
        tabIndex={0}
        className="min-h-0 flex-1 outline-none"
      >
        {tab === 'source' && (
          <SourceTab
            dossier={dossier}
            selected={selected}
            onSelect={setSelectedFileId}
            busy={busy}
            onAdd={() => setAddMode({ role: 'master' })}
            onAddRepresentation={() => setAddMode({ role: 'access' })}
            onNewVersion={() => selected && setAddMode({ role: 'master', supersedesFileId: selected.fileId })}
            onMoveEarlier={() => void moveSelectedGroup(-1)}
            onMoveLater={() => void moveSelectedGroup(1)}
            onRegenerate={() => selected && void run(
              () => window.nodus.regeneratePrimarySourceThumbnail(selected.role === 'thumbnail' && selected.parentFileId ? selected.parentFileId : selected.fileId),
              'Miniatura regenerada sin modificar el original.'
            )}
            onSave={() => selected && void run(
              () => window.nodus.savePrimarySourceFile(selected.fileId),
              'Copia guardada.'
            )}
            onExternal={() => selected && void run(
              () => window.nodus.openPrimarySourceFileExternal(selected.fileId),
              'Copia temporal abierta en la aplicación del sistema.'
            )}
            onUpdateAlternativeText={(value) => selected && void run(
              () => window.nodus.updatePrimarySourceFileMetadata(selected.fileId, {
                alternativeText: value,
              }),
              'Texto alternativo guardado.'
            )}
          />
        )}
        {tab === 'description' && (
          <DescriptionTab dossier={dossier} workspace={workspace} onSaved={async () => {
            await reload();
            await onChanged();
            setNotice(t('Descripción guardada.'));
          }} />
        )}
        {tab === 'history' && <HistoryTab dossier={dossier} />}
        {tab === 'text' && (
          <TextTab
            dossier={dossier}
            selectedFile={selected}
            initialExcerptId={focusedExcerptId}
            initialTextTarget={initialTextTarget}
            busy={busy}
            onChanged={async (message) => {
              await reload();
              await onChanged();
              setNotice(t(message));
            }}
            onError={(message) => setError(message)}
          />
        )}
        {tab === 'analysis' && (
          <AnalysisTab
            dossier={dossier}
            onChanged={async () => {
              await reload();
              await onChanged();
              setNotice(t('Análisis crítico guardado.'));
            }}
          />
        )}
        {tab === 'evidence' && (
          <EvidenceTab
            dossier={dossier}
            onChanged={async (message) => {
              await reload();
              await onChanged();
              setNotice(t(message));
            }}
            onOpenExcerpt={(excerptId) => {
              setFocusedExcerptId(excerptId);
              setTab('text');
            }}
          />
        )}
        {tab !== 'source' && tab !== 'description' && tab !== 'text' && tab !== 'evidence' && tab !== 'analysis' && tab !== 'history' && (
          <FutureTab tab={tab} />
        )}
      </main>

      {addMode && (
        <AddRepresentationDialog
          dossier={dossier}
          initialRole={addMode.role}
          supersedesFileId={addMode.supersedesFileId}
          selected={selected}
          onClose={() => setAddMode(null)}
          onComplete={async (fileId) => {
            setAddMode(null);
            setSelectedFileId(fileId);
            await reload();
            await onChanged();
            setNotice(t('Representación añadida y verificada.'));
          }}
        />
      )}
    </div>
  );
}

function SourceTab({
  dossier,
  selected,
  onSelect,
  busy,
  onAdd,
  onAddRepresentation,
  onNewVersion,
  onMoveEarlier,
  onMoveLater,
  onRegenerate,
  onSave,
  onExternal,
  onUpdateAlternativeText,
}: {
  dossier: PrimarySourceDossier;
  selected: ArchiveItemFile | null;
  onSelect: (id: string) => void;
  busy: boolean;
  onAdd: () => void;
  onAddRepresentation: () => void;
  onNewVersion: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onRegenerate: () => void;
  onSave: () => void;
  onExternal: () => void;
  onUpdateAlternativeText: (value: string | null) => void;
}) {
  const files = useMemo(
    () => [...dossier.files].sort((a, b) =>
      a.sequenceNo - b.sequenceNo
      || a.role.localeCompare(b.role)
      || b.versionNo - a.versionNo
    ),
    [dossier.files]
  );
  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 md:flex" data-testid="primary-source-file-rail">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <h2 className="text-xs font-semibold">{t('Archivos y versiones')}</h2>
          <span className="ml-auto text-[10px] tabular-nums text-neutral-500">{files.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {files.map((file) => (
            <FileRailButton key={file.fileId} file={file} active={selected?.fileId === file.fileId} onClick={() => onSelect(file.fileId)} />
          ))}
          {files.length === 0 && <p className="p-3 text-xs leading-5 text-neutral-500">{t('Esta unidad todavía no tiene copia digital.')}</p>}
        </div>
        <div className="grid gap-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
          <button className="btn btn-primary justify-center gap-2 text-xs" onClick={onAdd}><Icon name="plus" size={13} />{t('Añadir archivo')}</button>
          <button className="btn btn-secondary justify-center gap-2 text-xs" disabled={!selected} onClick={onAddRepresentation}><Icon name="layers" size={13} />{t('Añadir representación')}</button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <FileToolbar
              file={selected}
              busy={busy}
              onNewVersion={onNewVersion}
              onMoveEarlier={onMoveEarlier}
              onMoveLater={onMoveLater}
              onRegenerate={onRegenerate}
              onSave={onSave}
              onExternal={onExternal}
            />
            {selected.mimeType?.startsWith('image/') && (
              <AlternativeTextEditor
                file={selected}
                busy={busy}
                onSave={onUpdateAlternativeText}
              />
            )}
            <div className="min-h-0 flex-1">
              <MultiFormatViewer selected={selected} files={dossier.files} />
            </div>
          </>
        ) : (
          <div className="grid h-full place-items-center p-8">
            <div className="max-w-md text-center">
              <Icon name="archive" size={30} className="mx-auto text-neutral-400" />
              <h2 className="mt-4 font-semibold">{t('Fuente sin representación digital')}</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-500">{t('La descripción archivística se conserva aunque todavía no exista un archivo. Puedes añadirlo cuando lo obtengas.')}</p>
              <button className="btn btn-primary mt-4 gap-2" onClick={onAdd}><Icon name="plus" />{t('Añadir archivo')}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function FileRailButton({ file, active, onClick }: { file: ArchiveItemFile; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`mb-1 w-full rounded-lg border p-2 text-left transition ${active ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40' : 'border-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800'} ${file.supersededAt ? 'opacity-60' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-neutral-100 dark:bg-neutral-800"><Icon name={file.role === 'master' ? 'archive' : file.role === 'thumbnail' ? 'image' : 'file'} size={13} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{file.originalFileName || t('Archivo sin nombre')}</span>
          <span className="block text-[10px] text-neutral-500">{t(ROLE_LABELS[file.role])} · v{file.versionNo} · #{file.sequenceNo + 1}</span>
        </span>
        <IntegrityDot status={file.verificationStatus} />
      </div>
      {file.pageLabel && <span className="mt-1 block truncate pl-9 text-[10px] text-neutral-500">{t('Etiqueta')}: {file.pageLabel}</span>}
      {file.supersededAt && <span className="mt-1 block pl-9 text-[10px] text-amber-700 dark:text-amber-300">{t('Versión anterior preservada')}</span>}
    </button>
  );
}

function FileToolbar({
  file,
  busy,
  onNewVersion,
  onMoveEarlier,
  onMoveLater,
  onRegenerate,
  onSave,
  onExternal,
}: {
  file: ArchiveItemFile;
  busy: boolean;
  onNewVersion: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onRegenerate: () => void;
  onSave: () => void;
  onExternal: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200">{t(ROLE_LABELS[file.role])} · v{file.versionNo}</span>
        <span className="text-xs text-neutral-500">{formatBytes(file.byteSize)}</span>
        <span className="flex items-center gap-1 text-xs text-neutral-500"><IntegrityDot status={file.verificationStatus} />{t(STATUS_LABELS[file.verificationStatus])}</span>
        <div className="ml-auto flex flex-wrap gap-1">
          <button className="btn btn-ghost h-8 w-8 p-0" disabled={busy} onClick={onMoveEarlier} title={t('Subir en la secuencia')} aria-label={t('Subir en la secuencia')}><Icon name="arrowUp" size={13} /></button>
          <button className="btn btn-ghost h-8 w-8 p-0" disabled={busy} onClick={onMoveLater} title={t('Bajar en la secuencia')} aria-label={t('Bajar en la secuencia')}><Icon name="arrowDown" size={13} /></button>
          {file.role === 'master' && <button className="btn btn-ghost h-8 w-8 p-0" disabled={busy} onClick={onNewVersion} title={t('Nueva versión')} aria-label={t('Nueva versión')}><Icon name="refresh" size={13} /></button>}
          {file.role !== 'thumbnail' && <button className="btn btn-ghost h-8 w-8 p-0" disabled={busy} onClick={onRegenerate} title={t('Regenerar miniatura')} aria-label={t('Regenerar miniatura')}><Icon name="image" size={13} /></button>}
          <button className="btn btn-ghost h-8 w-8 p-0" disabled={busy} onClick={onSave} title={t('Guardar copia')} aria-label={t('Guardar copia')}><Icon name="download" size={13} /></button>
          <button className="btn btn-ghost h-8 w-8 p-0" disabled={busy} onClick={onExternal} title={t('Abrir externamente')} aria-label={t('Abrir externamente')}><Icon name="external" size={13} /></button>
        </div>
      </div>
      <div className="mt-1 flex min-w-0 gap-3 overflow-hidden text-[10px] text-neutral-500">
        <span className="truncate" title={file.contentHash || ''}>SHA-256: {file.contentHash || t('Sin checksum')}</span>
        {file.parentFileId && <span className="truncate">{t('Deriva de')}: {file.parentFileId}</span>}
      </div>
    </div>
  );
}

function AlternativeTextEditor({
  file,
  busy,
  onSave,
}: {
  file: ArchiveItemFile;
  busy: boolean;
  onSave: (value: string | null) => void;
}) {
  const stored = typeof file.captureMetadata?.alternativeText === 'string'
    ? file.captureMetadata.alternativeText
    : '';
  const [value, setValue] = useState(stored);
  useEffect(() => setValue(stored), [file.fileId, stored]);
  return (
    <details className="shrink-0 border-b border-neutral-200 bg-white px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
      <summary className="cursor-pointer font-medium">{t('Accesibilidad de la imagen')}</summary>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[10px] text-neutral-500">{t('Texto alternativo descriptivo')}</span>
          <textarea
            className="input min-h-16 w-full resize-y"
            value={value}
            maxLength={2_000}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t('Describe la información visual relevante sin interpretar lo que no se ve.')}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary shrink-0"
          disabled={busy || value === stored}
          onClick={() => onSave(value.trim() || null)}
        >
          {t('Guardar texto alternativo')}
        </button>
      </div>
    </details>
  );
}

function MultiFormatViewer({ selected, files }: { selected: ArchiveItemFile; files: ArchiveItemFile[] }) {
  const file = bestPreviewFile(selected, files);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [file.fileId]);
  const url = archiveFileUrl(file);
  const mime = file.mimeType || '';

  if (mime.startsWith('image/') && !['image/tiff', 'image/x-tiff'].includes(mime)) {
    const alternativeText = typeof file.captureMetadata?.alternativeText === 'string'
      && file.captureMetadata.alternativeText.trim()
      ? file.captureMetadata.alternativeText
      : file.originalFileName || t('Fuente digital');
    return (
      <div
        className="flex h-full min-h-0 flex-col bg-stone-100 outline-none dark:bg-neutral-950"
        data-testid="primary-source-image-viewer"
        role="region"
        aria-label={t('Visor de imagen documental')}
        aria-keyshortcuts="+ - 0 R"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            setZoom((value) => Math.min(6, value + 0.25));
          } else if (event.key === '-') {
            event.preventDefault();
            setZoom((value) => Math.max(0.25, value - 0.25));
          } else if (event.key === '0') {
            event.preventDefault();
            setZoom(1);
            setRotation(0);
          } else if (event.key.toLocaleLowerCase() === 'r') {
            event.preventDefault();
            setRotation((value) => (value + 90) % 360);
          }
        }}
      >
        <div className="flex shrink-0 justify-center gap-1 border-b border-neutral-200 bg-white/90 p-1.5 dark:border-neutral-800 dark:bg-neutral-900/90">
          <button className="btn btn-ghost h-8 w-8 p-0" onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))} aria-label={t('Alejar')}><Icon name="minus" size={14} /></button>
          <span role="status" aria-live="polite" className="min-w-14 py-2 text-center text-[10px] tabular-nums">{Math.round(zoom * 100)}%</span>
          <button className="btn btn-ghost h-8 w-8 p-0" onClick={() => setZoom((value) => Math.min(6, value + 0.25))} aria-label={t('Acercar')}><Icon name="plus" size={14} /></button>
          <button className="btn btn-ghost h-8 w-8 p-0" title={t('Girar vista 90 grados')} aria-label={t('Girar vista 90 grados')} onClick={() => setRotation((value) => (value + 90) % 360)}><Icon name="rotateCw" size={14} /></button>
          <button className="btn btn-ghost h-8 w-8 p-0" title={t('Restablecer vista')} aria-label={t('Restablecer vista')} onClick={() => { setZoom(1); setRotation(0); }}><Icon name="fit" size={14} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-8">
          <img
            src={url}
            alt={alternativeText}
            className="mx-auto max-w-none origin-center shadow-2xl transition-transform"
            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)`, transformOrigin: 'top center' }}
          />
        </div>
        {file.fileId !== selected.fileId && <DerivedPreviewNotice file={file} />}
      </div>
    );
  }
  if (mime === 'application/pdf') {
    return (
      <div className="relative h-full bg-neutral-200 dark:bg-neutral-950" data-testid="primary-source-pdf-viewer">
        <iframe className="h-full w-full border-0" src={url} title={file.originalFileName || t('Documento PDF')} />
        {file.fileId !== selected.fileId && <DerivedPreviewNotice file={file} />}
      </div>
    );
  }
  if (mime.startsWith('audio/')) {
    return (
      <div className="grid h-full place-items-center bg-gradient-to-br from-indigo-50 to-stone-100 p-8 dark:from-indigo-950/30 dark:to-neutral-950" data-testid="primary-source-audio-viewer">
        <div className="w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white p-8 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
          <Icon name="audio" size={42} className="mx-auto text-indigo-500" />
          <p className="mt-4 truncate text-center font-medium">{file.originalFileName}</p>
          <audio aria-label={file.originalFileName || t('Fuente de audio')} className="mt-6 w-full" controls preload="metadata" src={url}>{t('Tu sistema no puede reproducir este audio.')}</audio>
          <p className="mt-4 text-center text-xs text-neutral-500">{t('La reproducción usa rangos; el archivo completo no se carga en memoria.')}</p>
        </div>
      </div>
    );
  }
  if (mime.startsWith('video/')) {
    return (
      <div className="grid h-full place-items-center bg-black p-4" data-testid="primary-source-video-viewer">
        <video aria-label={file.originalFileName || t('Fuente de vídeo')} className="max-h-full max-w-full" controls preload="metadata" src={url}>{t('Tu sistema no puede reproducir este vídeo.')}</video>
      </div>
    );
  }
  if (isTable(file)) return <DelimitedTableViewer file={file} />;
  if (isText(file)) return <BoundedTextViewer file={file} />;
  return <UnsupportedViewer selected={selected} preview={file} />;
}

function DerivedPreviewNotice({ file }: { file: ArchiveItemFile }) {
  return <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-3 py-1.5 text-[10px] text-white">{t('Vista mediante {role}; el máster permanece intacto.').replace('{role}', t(ROLE_LABELS[file.role]).toLocaleLowerCase())}</p>;
}

function BoundedTextViewer({ file }: { file: ArchiveItemFile }) {
  const [state, setState] = useState<{ text: string; truncated: boolean; error: string | null }>({ text: '', truncated: false, error: null });
  useEffect(() => {
    let active = true;
    const limit = 2 * 1024 * 1024;
    fetch(archiveFileUrl(file), { headers: { Range: `bytes=0-${limit - 1}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status}`);
        const text = await response.text();
        if (active) setState({ text, truncated: file.byteSize > limit, error: null });
      })
      .catch((reason) => active && setState({ text: '', truncated: false, error: String(reason) }));
    return () => { active = false; };
  }, [file.fileId, file.contentHash, file.byteSize]);
  if (state.error) return <ViewerError />;
  return (
    <div className="h-full overflow-auto bg-stone-100 p-6 dark:bg-neutral-950" data-testid="primary-source-text-viewer">
      <pre className="mx-auto min-h-full max-w-5xl whitespace-pre-wrap break-words rounded-lg bg-white p-8 font-mono text-sm leading-6 shadow dark:bg-neutral-900">{state.text}</pre>
      {state.truncated && <p className="sticky bottom-3 mx-auto mt-3 w-fit rounded-full bg-amber-100 px-3 py-1.5 text-xs text-amber-900 shadow dark:bg-amber-950 dark:text-amber-100">{t('Vista limitada a los primeros 2 MB. El original completo sigue preservado.')}</p>}
    </div>
  );
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length && rows.length < 201; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(value); value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value); value = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else {
      value += char;
    }
  }
  if (row.length || value) { row.push(value); rows.push(row); }
  return rows;
}

function DelimitedTableViewer({ file }: { file: ArchiveItemFile }) {
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const limit = 512 * 1024;
    fetch(archiveFileUrl(file), { headers: { Range: `bytes=0-${limit - 1}` } })
      .then((response) => response.text())
      .then((text) => {
        const first = text.split(/\r?\n/, 1)[0] || '';
        const delimiter = file.mimeType === 'text/tab-separated-values' || (first.match(/\t/g)?.length || 0) > (first.match(/,/g)?.length || 0) ? '\t' : ',';
        if (active) setRows(parseDelimited(text, delimiter));
      })
      .catch(() => active && setError(true));
    return () => { active = false; };
  }, [file.fileId, file.contentHash, file.mimeType]);
  if (error) return <ViewerError />;
  const header = rows[0] ?? [];
  return (
    <div className="h-full overflow-auto bg-neutral-50 p-4 dark:bg-neutral-950" data-testid="primary-source-table-viewer">
      <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-lg bg-white text-xs shadow dark:bg-neutral-900">
        <thead className="sticky top-0 z-10"><tr>{header.map((cell, index) => <th key={index} className="border-b border-r border-neutral-200 bg-neutral-100 px-3 py-2 text-left font-semibold dark:border-neutral-700 dark:bg-neutral-800">{cell || `${t('Columna')} ${index + 1}`}</th>)}</tr></thead>
        <tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{header.map((_, columnIndex) => <td key={columnIndex} className="max-w-sm truncate border-b border-r border-neutral-100 px-3 py-2 dark:border-neutral-800" title={row[columnIndex]}>{row[columnIndex] || '—'}</td>)}</tr>)}</tbody>
      </table>
      <p className="mt-3 text-center text-xs text-neutral-500">{t('Previsualización acotada a 200 filas y 512 KB para mantener la interfaz fluida.')}</p>
    </div>
  );
}

function ViewerError() {
  return <div role="alert" className="grid h-full place-items-center text-sm text-red-600">{t('No se pudo cargar la previsualización.')}</div>;
}

function UnsupportedViewer({ selected, preview }: { selected: ArchiveItemFile; preview: ArchiveItemFile }) {
  return (
    <div className="grid h-full place-items-center p-8" data-testid="primary-source-unsupported-viewer">
      <div className="max-w-lg text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-neutral-100 dark:bg-neutral-800"><Icon name="file" size={28} className="text-neutral-500" /></span>
        <h2 className="mt-5 text-lg font-semibold">{t('Formato preservado sin visor enriquecido')}</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500">{t('Puedes guardar una copia o abrirla con una aplicación del sistema. El original, su checksum y sus metadatos permanecen en el vault.')}</p>
        <p className="mt-3 font-mono text-xs text-neutral-500">{preview.mimeType || 'application/octet-stream'} · {formatBytes(selected.byteSize)}</p>
      </div>
    </div>
  );
}

function TextTab({
  dossier,
  selectedFile,
  initialExcerptId,
  initialTextTarget,
  busy,
  onChanged,
  onError,
}: {
  dossier: PrimarySourceDossier;
  selectedFile: ArchiveItemFile | null;
  initialExcerptId?: string | null;
  initialTextTarget?: { textVersionId: string; start: number; end: number } | null;
  busy: boolean;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const versions = useMemo(
    () => [...dossier.textVersions].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.textVersionId.localeCompare(a.textVersionId)
    ),
    [dossier.textVersions]
  );
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    versions[0]?.textVersionId ?? null
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftKind, setDraftKind] = useState<ArchiveTextKind>('transcription');
  const [draftLanguage, setDraftLanguage] = useState('');
  const [draftConventions, setDraftConventions] = useState('');
  const [parentVersionId, setParentVersionId] = useState<string | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focusRange, setFocusRange] = useState<{ start: number; end: number } | null>(null);
  const [excerptOpen, setExcerptOpen] = useState(false);
  const [compareParent, setCompareParent] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!selectedVersionId || !versions.some((version) => version.textVersionId === selectedVersionId)) {
      setSelectedVersionId(versions[0]?.textVersionId ?? null);
    }
  }, [selectedVersionId, versions]);

  const current = versions.find((version) => version.textVersionId === selectedVersionId)
    ?? versions[0]
    ?? null;
  const parent = current?.parentVersionId
    ? versions.find((version) => version.textVersionId === current.parentVersionId) ?? null
    : null;
  const segments = current
    ? dossier.textSegments
      .filter((segment) => segment.textVersionId === current.textVersionId)
      .sort((a, b) => a.sequenceNo - b.sequenceNo)
    : [];

  useEffect(() => {
    if (!focusRange || !current || !textRef.current) return;
    const control = textRef.current;
    control.focus();
    control.setSelectionRange(focusRange.start, focusRange.end);
    control.scrollTop = Math.max(
      0,
      (control.scrollHeight - control.clientHeight)
        * (focusRange.start / Math.max(1, current.content.length))
    );
    setSelection(focusRange);
    setFocusRange(null);
  }, [current, focusRange]);

  const beginVersion = (source: ArchiveTextVersion | null) => {
    setParentVersionId(source?.textVersionId ?? null);
    setDraft(source?.content ?? '');
    setDraftKind(source ? (source.kind === 'ocr' ? 'diplomatic' : source.kind) : 'transcription');
    setDraftLanguage(source?.languageCode ?? '');
    setDraftConventions(source?.editorialConventions ?? '');
    setEditing(true);
    setCompareParent(Boolean(source));
    setSelection({ start: 0, end: 0 });
  };

  const saveVersion = async () => {
    if (!draft.trim()) return;
    try {
      const before = new Set(dossier.textVersions.map((version) => version.textVersionId));
      const next = await window.nodus.createPrimarySourceTextVersion({
        itemId: dossier.row.item.itemId,
        fileId: current?.fileId ?? selectedFile?.fileId ?? null,
        parentVersionId,
        kind: draftKind,
        languageCode: draftLanguage.trim() || null,
        content: draft,
        status: 'in_review',
        editorialConventions: draftConventions.trim() || null,
        createdBy: 'primary_sources_user',
      });
      const created = next.textVersions.find((version) => !before.has(version.textVersionId));
      if (created) setSelectedVersionId(created.textVersionId);
      setEditing(false);
      setParentVersionId(null);
      setCompareParent(false);
      await onChanged('Nueva versión guardada; el texto de origen permanece intacto.');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const changeReviewStatus = async (status: ArchiveTextStatus) => {
    if (!current) return;
    try {
      await window.nodus.setPrimarySourceTextReviewStatus(current.textVersionId, status);
      await onChanged('Estado de revisión actualizado.');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const changeExcerptStatus = async (
    excerptId: string,
    status: ArchiveExcerpt['reviewStatus']
  ) => {
    try {
      await window.nodus.setPrimarySourceExcerptReviewStatus(excerptId, status);
      await onChanged('Estado del fragmento actualizado.');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const openExcerpt = (excerpt: ArchiveExcerpt) => {
    if (!excerpt.textVersionId || !excerpt.locator.textRange) return;
    setEditing(false);
    setSelectedVersionId(excerpt.textVersionId);
    setCompareParent(false);
    setFocusRange(excerpt.locator.textRange);
  };

  useEffect(() => {
    if (!initialExcerptId) return;
    const excerpt = dossier.excerpts.find((candidate) => candidate.excerptId === initialExcerptId);
    if (excerpt) openExcerpt(excerpt);
    // The target is stable for this dossier mount; dossier changes must not steal
    // focus back from a later manual version selection.
  }, [initialExcerptId]);

  useEffect(() => {
    if (!initialTextTarget) return;
    if (!versions.some((version) => version.textVersionId === initialTextTarget.textVersionId)) return;
    setEditing(false);
    setSelectedVersionId(initialTextTarget.textVersionId);
    setCompareParent(false);
    setFocusRange({ start: initialTextTarget.start, end: initialTextTarget.end });
    // The deep target is consumed once; subsequent dossier refreshes must not steal
    // the researcher's manual text selection.
  }, [initialTextTarget]);

  const copyValue = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(message);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      onError(t('No se pudo acceder al portapapeles.'));
    }
  };

  const citationFor = (excerpt: ArchiveExcerpt) => {
    const archiveRef = [
      dossier.row.repositoryName,
      dossier.row.unit.referenceCode,
      dossier.row.unit.title,
      excerpt.locatorDisplay,
    ].filter(Boolean).join(', ');
    const quote = excerpt.quotedText?.replace(/\s+/g, ' ').trim();
    const link = primarySourceExcerptDeepLink(excerpt.itemId, excerpt.excerptId);
    return `${archiveRef}${quote ? `: “${quote}”` : ''} (${link})`;
  };

  const activeText = editing ? draft : current?.content ?? '';
  const activeSegment = !editing
    ? segments.find((segment) =>
      segment.startOffset !== null
      && segment.endOffset !== null
      && selection.start >= segment.startOffset
      && selection.end <= segment.endOffset
    ) ?? null
    : null;

  return (
    <div className="flex h-full min-h-0" data-testid="primary-source-text-workspace">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 lg:flex">
        <div className="border-b border-neutral-200 p-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold">{t('Versiones de texto')}</h2>
            <span className="ml-auto text-[10px] tabular-nums text-neutral-500">{versions.length}</span>
          </div>
          <button className="btn btn-primary mt-3 w-full justify-center gap-2 text-xs" onClick={() => beginVersion(null)}>
            <Icon name="plus" size={13} />{t('Nueva transcripción')}
          </button>
        </div>
        <div className="max-h-[44%] overflow-y-auto p-2">
          {versions.map((version) => (
            <button
              key={version.textVersionId}
              className={`mb-1 w-full rounded-lg border p-2 text-left ${current?.textVersionId === version.textVersionId ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40' : 'border-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
              onClick={() => {
                setEditing(false);
                setCompareParent(false);
                setSelectedVersionId(version.textVersionId);
                setSelection({ start: 0, end: 0 });
              }}
            >
              <span className="flex items-center gap-2">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[9px] font-semibold dark:bg-neutral-800">{t(TEXT_KIND_LABELS[version.kind])}</span>
                <span className="ml-auto text-[9px] text-neutral-500">{new Date(version.createdAt).toLocaleDateString()}</span>
              </span>
              <span className="mt-1 block truncate text-[10px] text-neutral-500">{t(TEXT_STATUS_LABELS[version.status])}{version.languageCode ? ` · ${version.languageCode}` : ''}</span>
              <span className="mt-1 block truncate font-mono text-[9px] text-neutral-400">{version.textVersionId}</span>
            </button>
          ))}
          {versions.length === 0 && <p className="p-3 text-xs leading-5 text-neutral-500">{t('Todavía no hay OCR ni transcripciones. Crea una versión manual o incorpora un resultado automático.')}</p>}
        </div>
        <div className="flex min-h-0 flex-1 flex-col border-t border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2 px-3 py-2">
            <h2 className="text-xs font-semibold">{t('Fragmentos citables')}</h2>
            <span className="ml-auto text-[10px] tabular-nums text-neutral-500">{dossier.excerpts.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {dossier.excerpts.map((excerpt) => (
              <article key={excerpt.excerptId} className="mb-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
                <button className="w-full text-left" onClick={() => openExcerpt(excerpt)}>
                  <span className="block text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">{excerpt.locatorDisplay}</span>
                  <span className="mt-1 line-clamp-3 block text-[10px] leading-4 text-neutral-600 dark:text-neutral-400">“{excerpt.quotedText}”</span>
                </button>
                <select
                  className="input mt-2 h-7 w-full text-[9px]"
                  value={excerpt.reviewStatus}
                  onChange={(event) => void changeExcerptStatus(
                    excerpt.excerptId,
                    event.target.value as ArchiveExcerpt['reviewStatus']
                  )}
                  aria-label={t('Estado de revisión')}
                >
                  <option value="unreviewed">{t('Sin revisar')}</option>
                  <option value="in_review">{t('En revisión')}</option>
                  <option value="reviewed">{t('Revisado')}</option>
                  <option value="rejected">{t('Rechazado')}</option>
                </select>
                <div className="mt-1 flex gap-1">
                  <button className="btn btn-ghost h-7 gap-1 px-2 text-[9px]" onClick={() => void copyValue(citationFor(excerpt), t('Cita copiada.'))}><Icon name="copy" size={10} />{t('Copiar cita')}</button>
                  <button className="btn btn-ghost h-7 px-2 text-[9px]" onClick={() => void copyValue(primarySourceExcerptDeepLink(excerpt.itemId, excerpt.excerptId), t('Enlace copiado.'))}>{t('Copiar enlace')}</button>
                </div>
              </article>
            ))}
            {dossier.excerpts.length === 0 && <p className="px-3 py-5 text-center text-[10px] leading-4 text-neutral-500">{t('Selecciona un pasaje en una versión guardada para crear el primer fragmento.')}</p>}
          </div>
        </div>
      </aside>

      <section className="grid min-w-0 flex-1 grid-cols-1 xl:grid-cols-2">
        <div className="hidden min-h-0 border-r border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 xl:block">
          <div className="flex h-9 items-center border-b border-neutral-200 bg-white px-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
            {t('Fuente preservada')}
          </div>
          <div className="h-[calc(100%-2.25rem)]">
            {selectedFile
              ? <MultiFormatViewer selected={selectedFile} files={dossier.files} />
              : <div className="grid h-full place-items-center p-6 text-center text-xs text-neutral-500">{t('La unidad no tiene una representación digital para mostrar en paralelo.')}</div>}
          </div>
        </div>

        <div className="flex min-h-0 flex-col bg-white dark:bg-neutral-900">
          <header className="shrink-0 border-b border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  <select className="input h-8 text-xs" value={draftKind} onChange={(event) => setDraftKind(event.target.value as ArchiveTextKind)}>
                    {(Object.keys(TEXT_KIND_LABELS) as ArchiveTextKind[]).map((kind) => <option key={kind} value={kind}>{t(TEXT_KIND_LABELS[kind])}</option>)}
                  </select>
                  <input className="input h-8 w-24 text-xs" value={draftLanguage} onChange={(event) => setDraftLanguage(event.target.value)} placeholder={t('Idioma')} aria-label={t('Idioma')} />
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-300">{parentVersionId ? t('Se guardará como hija; el origen no se modifica.') : t('Se guardará como una versión independiente.')}</span>
                  <div className="ml-auto flex gap-1">
                    <button className="btn btn-ghost h-8 text-xs" onClick={() => setEditing(false)}>{t('Cancelar')}</button>
                    <button className="btn btn-primary h-8 gap-1 text-xs" disabled={busy || !draft.trim()} onClick={() => void saveVersion()}><Icon name="save" size={12} />{t('Guardar nueva versión')}</button>
                  </div>
                </>
              ) : current ? (
                <>
                  <span className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200">{t(TEXT_KIND_LABELS[current.kind])}</span>
                  <span className="text-[10px] text-neutral-500">{current.languageCode || t('Idioma sin especificar')} · {current.content.length.toLocaleString()} {t('caracteres')}</span>
                  <select className="input h-8 text-xs" value={current.status} onChange={(event) => void changeReviewStatus(event.target.value as ArchiveTextStatus)} aria-label={t('Estado de revisión')}>
                    {(Object.keys(TEXT_STATUS_LABELS) as ArchiveTextStatus[]).map((status) => <option key={status} value={status}>{t(TEXT_STATUS_LABELS[status])}</option>)}
                  </select>
                  <div className="ml-auto flex flex-wrap gap-1">
                    {parent && <button className={`btn h-8 text-xs ${compareParent ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setCompareParent((value) => !value)}>{t('Comparar con origen')}</button>}
                    <button className="btn btn-ghost h-8 gap-1 text-xs" onClick={() => beginVersion(current)}><Icon name="edit" size={12} />{t('Corregir en nueva versión')}</button>
                    <button className="btn btn-primary h-8 gap-1 text-xs" disabled={selection.end <= selection.start} onClick={() => setExcerptOpen(true)}><Icon name="quote" size={12} />{t('Crear fragmento')}</button>
                  </div>
                </>
              ) : (
                <div className="flex w-full items-center">
                  <p className="text-xs text-neutral-500">{t('Añade una transcripción para empezar a revisar y citar el contenido.')}</p>
                  <button className="btn btn-primary ml-auto h-8 text-xs" onClick={() => beginVersion(null)}>{t('Nueva transcripción')}</button>
                </div>
              )}
            </div>
            {editing && (
              <input
                className="input mt-2 h-8 w-full text-xs"
                value={draftConventions}
                onChange={(event) => setDraftConventions(event.target.value)}
                placeholder={t('Convenciones editoriales o criterio de normalización')}
              />
            )}
          </header>

          {compareParent && parent && !editing && (
            <div className="max-h-36 shrink-0 overflow-auto border-b border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">{t('Versión de origen preservada')} · {t(TEXT_KIND_LABELS[parent.kind])}</p>
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-5 text-neutral-700 dark:text-neutral-300">{parent.content}</pre>
            </div>
          )}

          <textarea
            ref={textRef}
            className="min-h-0 flex-1 resize-none border-0 bg-stone-50 p-5 font-mono text-sm leading-6 outline-none dark:bg-neutral-950"
            value={activeText}
            readOnly={!editing}
            onChange={(event) => setDraft(event.target.value)}
            onSelect={(event) => {
              if (editing) return;
              setSelection({
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd,
              });
            }}
            placeholder={t('Escribe o pega la transcripción sin alterar el archivo preservado.')}
            data-testid="primary-source-text-editor"
          />

          <footer className="shrink-0 border-t border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
              <span className="shrink-0 text-[10px] font-semibold text-neutral-500">{t('Segmentos y páginas')}</span>
              {segments.map((segment) => (
                <button
                  key={segment.segmentId}
                  className={`shrink-0 rounded-full border px-2 py-1 text-[9px] ${activeSegment?.segmentId === segment.segmentId ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200' : 'border-neutral-200 text-neutral-500 dark:border-neutral-700'}`}
                  onClick={() => {
                    if (segment.startOffset === null || segment.endOffset === null) return;
                    setFocusRange({ start: segment.startOffset, end: segment.endOffset });
                  }}
                >
                  {segment.pageLabel ? `${t('Página')} ${segment.pageLabel}` : `${t('Segmento')} ${segment.sequenceNo + 1}`}
                  {segment.timeStartMs !== null ? ` · ${formatTime(segment.timeStartMs)}` : ''}
                  {segment.speakerLabel ? ` · ${t('Hablante')} ${segment.speakerLabel}` : ''}
                </button>
              ))}
              {!segments.length && <span className="text-[10px] text-neutral-400">{t('Esta versión no contiene segmentos técnicos.')}</span>}
              {!editing && selection.end > selection.start && <span className="ml-auto shrink-0 text-[10px] text-indigo-600 dark:text-indigo-300">{selection.end - selection.start} {t('caracteres seleccionados')}</span>}
            </div>
          </footer>
        </div>
      </section>

      {copied && <p className="fixed bottom-5 left-1/2 z-[190] -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-xs text-white shadow-xl">{copied}</p>}
      {excerptOpen && current && (
        <ExcerptDialog
          dossier={dossier}
          version={current}
          segment={activeSegment}
          selection={selection}
          onClose={() => setExcerptOpen(false)}
          onComplete={async () => {
            setExcerptOpen(false);
            await onChanged('Fragmento citable creado.');
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function formatTime(value: number): string {
  const seconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function ExcerptDialog({
  dossier,
  version,
  segment,
  selection,
  onClose,
  onComplete,
  onError,
}: {
  dossier: PrimarySourceDossier;
  version: ArchiveTextVersion;
  segment: PrimarySourceDossier['textSegments'][number] | null;
  selection: { start: number; end: number };
  onClose: () => void;
  onComplete: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const selectedText = version.content.slice(selection.start, selection.end);
  const [locatorDisplay, setLocatorDisplay] = useState(
    segment?.pageLabel
      ? `${t('página')} ${segment.pageLabel}`
      : `${t('caracteres')} ${selection.start + 1}–${selection.end}`
  );
  const [description, setDescription] = useState('');
  const [reviewStatus, setReviewStatus] = useState<ArchiveExcerpt['reviewStatus']>('unreviewed');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await window.nodus.createPrimarySourceExcerpt({
        itemId: dossier.row.item.itemId,
        textVersionId: version.textVersionId,
        fileId: segment?.fileId ?? version.fileId,
        segmentId: segment?.segmentId ?? null,
        startOffset: selection.start,
        endOffset: selection.end,
        locatorDisplay,
        languageCode: version.languageCode,
        description: description.trim() || null,
        reviewStatus,
        createdBy: 'primary_sources_user',
      });
      await onComplete();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[180] grid place-items-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="w-full max-w-xl overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900" role="dialog" aria-modal="true" aria-labelledby="create-excerpt-title">
        <header className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <h2 id="create-excerpt-title" className="font-semibold">{t('Crear fragmento citable')}</h2>
            <p className="mt-1 text-xs leading-5 text-neutral-500">{t('La cita guarda una instantánea y un intervalo exacto; futuras correcciones no la reescriben.')}</p>
          </div>
          <button className="btn btn-ghost h-8 w-8 p-0" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" size={14} /></button>
        </header>
        <form className="space-y-4 p-5" onSubmit={submit}>
          <blockquote className="max-h-36 overflow-auto rounded-xl border-l-4 border-indigo-400 bg-indigo-50 p-3 text-sm leading-6 text-neutral-700 dark:bg-indigo-950/30 dark:text-neutral-200">“{selectedText}”</blockquote>
          <Field label={t('Localizador legible')}><input required className="input w-full" value={locatorDisplay} onChange={(event) => setLocatorDisplay(event.target.value)} placeholder={t('Ej. fol. 3r, líneas 4–8')} /></Field>
          <Field label={t('Descripción del fragmento')}><textarea className="input min-h-20 w-full" value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          <Field label={t('Estado de revisión')}>
            <select className="input w-full" value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as ArchiveExcerpt['reviewStatus'])}>
              <option value="unreviewed">{t('Sin revisar')}</option>
              <option value="in_review">{t('En revisión')}</option>
              <option value="reviewed">{t('Revisado')}</option>
              <option value="rejected">{t('Rechazado')}</option>
            </select>
          </Field>
          <p className="font-mono text-[10px] text-neutral-500">{version.textVersionId} · {selection.start}:{selection.end}{segment ? ` · ${segment.segmentId}` : ''}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t('Cancelar')}</button>
            <button className="btn btn-primary" disabled={saving || !locatorDisplay.trim()}>{saving ? t('Guardando…') : t('Crear fragmento')}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function HistoryTab({ dossier }: { dossier: PrimarySourceDossier }) {
  const problemCount = dossier.integrity.mismatch + dossier.integrity.missing + dossier.integrity.error + dossier.integrity.orphanDerivatives + dossier.integrity.unhashed;
  return (
    <div className="h-full overflow-y-auto p-5" data-testid="primary-source-history">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label={t('Verificados')} value={dossier.integrity.verified} tone="emerald" />
          <Metric label={t('Pendientes')} value={dossier.integrity.pending} />
          <Metric label={t('Ausentes')} value={dossier.integrity.missing} tone="amber" />
          <Metric label={t('No coinciden')} value={dossier.integrity.mismatch} tone="red" />
          <Metric label={t('Derivados huérfanos')} value={dossier.integrity.orphanDerivatives} tone="red" />
          <Metric label={t('Incidencias')} value={problemCount} tone={problemCount ? 'red' : 'emerald'} />
        </section>
        <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <header className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800"><h2 className="text-sm font-semibold">{t('Historial auditable')}</h2><p className="mt-1 text-xs text-neutral-500">{t('Las comprobaciones no sustituyen el checksum esperado; una discrepancia queda registrada.')}</p></header>
          <div>
            {dossier.history.map((event) => (
              <article key={event.eventId} className="flex gap-3 border-b border-neutral-100 px-4 py-3 last:border-0 dark:border-neutral-800">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-100 dark:bg-neutral-800"><Icon name={event.action === 'integrity_checked' ? 'check' : event.action.includes('thumbnail') ? 'image' : 'archive'} size={13} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2"><p className="text-sm font-medium">{t(ACTION_LABELS[event.action])}</p><time className="text-[10px] text-neutral-500">{new Date(event.createdAt).toLocaleString()}</time></div>
                  <p className="mt-1 break-all font-mono text-[10px] leading-4 text-neutral-500">{historySummary(event.details)}</p>
                </div>
              </article>
            ))}
            {dossier.history.length === 0 && <p className="p-6 text-center text-sm text-neutral-500">{t('Todavía no hay actividad registrada.')}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function historySummary(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .slice(0, 5)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ');
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'emerald' | 'amber' | 'red' }) {
  const color = tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-red-600' : 'text-neutral-700 dark:text-neutral-200';
  return <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"><p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p><p className="mt-1 text-[10px] text-neutral-500">{label}</p></div>;
}

function DescriptionTab({
  dossier,
  workspace,
  onSaved,
}: {
  dossier: PrimarySourceDossier;
  workspace: PrimarySourceArchiveWorkspace;
  onSaved: () => Promise<void>;
}) {
  const row = dossier.row;
  const [title, setTitle] = useState(row.unit.title);
  const [titleType, setTitleType] = useState(row.unit.titleType);
  const [level, setLevel] = useState(row.unit.level);
  const [localLevelLabel, setLocalLevelLabel] = useState(row.unit.localLevelLabel ?? '');
  const [referenceCode, setReferenceCode] = useState(row.unit.referenceCode ?? '');
  const [creator, setCreator] = useState(row.unit.creatorDisplay ?? '');
  const [dateDisplay, setDateDisplay] = useState(row.unit.date.display ?? '');
  const [dateCertainty, setDateCertainty] = useState(row.unit.date.certainty);
  const [scope, setScope] = useState(row.unit.scopeContent ?? '');
  const [repositoryId, setRepositoryId] = useState(row.unit.repositoryId ?? '');
  const [parentUnitId, setParentUnitId] = useState(row.unit.parentUnitId ?? '');
  const [extentDisplay, setExtentDisplay] = useState(row.unit.extentDisplay ?? '');
  const [arrangement, setArrangement] = useState(row.unit.arrangement ?? '');
  const [administrativeHistory, setAdministrativeHistory] = useState(row.unit.administrativeBiographicalHistory ?? '');
  const [custodialHistory, setCustodialHistory] = useState(row.unit.custodialHistory ?? '');
  const [acquisitionInfo, setAcquisitionInfo] = useState(row.unit.acquisitionInfo ?? '');
  const [accessConditions, setAccessConditions] = useState(row.unit.accessConditions ?? '');
  const [unitReproductionConditions, setUnitReproductionConditions] = useState(row.unit.reproductionConditions ?? '');
  const [physicalCharacteristics, setPhysicalCharacteristics] = useState(row.unit.physicalCharacteristics ?? '');
  const [findingAids, setFindingAids] = useState(row.unit.findingAids ?? '');
  const [relatedUnits, setRelatedUnits] = useState(row.unit.relatedUnits ?? '');
  const [sourceCatalogUrl, setSourceCatalogUrl] = useState(row.unit.sourceCatalogUrl ?? '');
  const [languageCodes, setLanguageCodes] = useState(row.unit.languageCodes.join(', '));
  const [scriptCodes, setScriptCodes] = useState(row.unit.scriptCodes.join(', '));
  const [accessStatus, setAccessStatus] = useState(row.profile.accessStatus);
  const [sensitivity, setSensitivity] = useState(row.profile.sensitivity);
  const [processingStatus, setProcessingStatus] = useState(row.profile.processingStatus);
  const [descriptionStatus, setDescriptionStatus] = useState(row.profile.descriptionStatus);
  const [citationStatus, setCitationStatus] = useState(row.profile.citationStatus);
  const [embargoUntil, setEmbargoUntil] = useState(row.profile.embargoUntil ?? '');
  const [rightsStatement, setRightsStatement] = useState(row.profile.rightsStatement ?? '');
  const [reproductionConditions, setReproductionConditions] = useState(row.profile.reproductionConditions ?? '');
  const [captureSessionId, setCaptureSessionId] = useState(row.profile.captureSessionId ?? '');
  const [provenancePlaceId, setProvenancePlaceId] = useState(row.profile.provenancePlaceId ?? '');
  const [availablePlaces, setAvailablePlaces] = useState(workspace.places);
  const [addingPlace, setAddingPlace] = useState(false);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [documentType, setDocumentType] = useState<string | null>(row.item.docType);
  const [documentMetadata, setDocumentMetadata] = useState<Record<string, string>>(row.item.metadata ?? {});
  const suggestedIcon = suggestedArchiveDocumentIcon(documentType, row.item.kind);
  const [documentIcon, setDocumentIcon] = useState(
    archiveDocumentIcon(row.profile.metadata, row.item.docType, row.item.kind),
  );
  const [tagsText, setTagsText] = useState(row.item.tags.join(', '));
  const [collectionIds, setCollectionIds] = useState(row.item.folderIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const splitList = (value: string) => [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))];
  const addPlaceFromGazetteer = async (candidate: Parameters<typeof window.nodus.resolveGazetteerPlace>[0]) => {
    setPlaceBusy(true);
    setError(null);
    try {
      const place = await window.nodus.resolveGazetteerPlace(candidate);
      setAvailablePlaces((current) => current.some((entry) => entry.placeId === place.placeId)
        ? current
        : [...current, place].sort((a, b) => a.name.localeCompare(b.name)));
      setProvenancePlaceId(place.placeId);
      setAddingPlace(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPlaceBusy(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await window.nodus.updatePrimarySourceArchiveRecord(row.item.itemId, {
        expectedRevision: row.revision,
        unit: {
          title,
          titleType,
          level,
          localLevelLabel: level === 'local' ? localLevelLabel || null : null,
          referenceCode: referenceCode || null,
          creatorDisplay: creator || null,
          repositoryId: repositoryId || null,
          parentUnitId: parentUnitId || null,
          scopeContent: scope || null,
          extentDisplay: extentDisplay || null,
          arrangement: arrangement || null,
          administrativeBiographicalHistory: administrativeHistory || null,
          custodialHistory: custodialHistory || null,
          acquisitionInfo: acquisitionInfo || null,
          accessConditions: accessConditions || null,
          reproductionConditions: unitReproductionConditions || null,
          physicalCharacteristics: physicalCharacteristics || null,
          findingAids: findingAids || null,
          relatedUnits: relatedUnits || null,
          sourceCatalogUrl: sourceCatalogUrl || null,
          languageCodes: splitList(languageCodes),
          scriptCodes: splitList(scriptCodes),
          date: { ...row.unit.date, display: dateDisplay || null, certainty: dateCertainty },
        },
        profile: {
          accessStatus,
          sensitivity,
          processingStatus,
          descriptionStatus,
          citationStatus,
          embargoUntil: embargoUntil || null,
          rightsStatement: rightsStatement || null,
          reproductionConditions: reproductionConditions || null,
          captureSessionId: captureSessionId || null,
          provenancePlaceId: provenancePlaceId || null,
          metadata: { ...row.profile.metadata, documentIcon },
        },
      });
      await window.nodus.updateArchiveItem(row.item.itemId, {
        docType: documentType,
        metadata: documentMetadata,
      });
      await window.nodus.setArchiveItemFolders(row.item.itemId, collectionIds);
      const nextTags = splitList(tagsText);
      for (const tag of nextTags) {
        if (!row.item.tags.includes(tag)) await window.nodus.addArchiveTag(row.item.itemId, tag);
      }
      for (const tag of row.item.tags) {
        if (!nextTags.includes(tag)) await window.nodus.removeArchiveTag(row.item.itemId, tag);
      }
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const sectionClass = 'rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900';

  return (
    <div className="h-full overflow-y-auto p-5">
      <form className="mx-auto max-w-6xl space-y-5" onSubmit={save} data-testid="primary-source-description-form">
        <div className="grid gap-5 xl:grid-cols-2">
          <section className={sectionClass}>
            <h2 className="text-sm font-semibold">{t('Identificación y catalogación')}</h2>
            <p className="mt-1 text-xs text-neutral-500">{t('Usa el mismo catálogo documental que el Archivo de Genealogía.')}</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2"><Field label={t('Título')}><input className="input w-full" required value={title} onChange={(event) => setTitle(event.target.value)} /></Field></div>
              <Field label={t('Tipo de documento')}>
                <DocTypeSelect
                  value={documentType}
                  onChange={(value) => {
                    setDocumentType(value);
                    setDocumentMetadata({});
                    setDocumentIcon(suggestedArchiveDocumentIcon(value, row.item.kind));
                  }}
                  emptyLabel="Elegir tipo de documento…"
                />
              </Field>
              <Field label={t('Icono')}>
                <DocumentIconPicker value={documentIcon} suggested={suggestedIcon} onChange={setDocumentIcon} />
              </Field>
            </div>
            {documentType && (
              <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
                <DocTypeForm
                  docType={documentType}
                  values={documentMetadata}
                  onChange={(key, value) => setDocumentMetadata((current) => ({ ...current, [key]: value }))}
                />
              </div>
            )}
            <div className="mt-4"><Field label={t('Alcance y contenido')}><textarea className="input min-h-28 w-full resize-y" value={scope} onChange={(event) => setScope(event.target.value)} /></Field></div>
          </section>

          <section className={sectionClass}>
            <h2 className="text-sm font-semibold">{t('Descripción archivística')}</h2>
            <p className="mt-1 text-xs text-neutral-500">{t('La descripción es canónica y está separada de los archivos digitales y de las colecciones de trabajo.')}</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label={t('Signatura')}><input className="input w-full" value={referenceCode} onChange={(event) => setReferenceCode(event.target.value)} /></Field>
              <Field label={t('Nivel')}><select className="input w-full" value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>{(['repository', 'fonds', 'collection', 'subfonds', 'series', 'subseries', 'file', 'item', 'component', 'local'] as const).map((value) => <option key={value} value={value}>{t({ repository: 'Repositorio', fonds: 'Fondo', collection: 'Colección archivística', subfonds: 'Subfondo', series: 'Serie', subseries: 'Subserie', file: 'Unidad de instalación', item: 'Documento', component: 'Componente', local: 'Nivel local' }[value])}</option>)}</select></Field>
              {level === 'local' && <Field label={t('Nombre del nivel local')}><input className="input w-full" required value={localLevelLabel} onChange={(event) => setLocalLevelLabel(event.target.value)} /></Field>}
              <Field label={t('Tipo de título')}><select className="input w-full" value={titleType} onChange={(event) => setTitleType(event.target.value as typeof titleType)}><option value="original">{t('Original')}</option><option value="supplied">{t('Atribuido')}</option><option value="formal">{t('Formal')}</option><option value="unknown">{t('Desconocido')}</option></select></Field>
              <Field label={t('Repositorio')}><select className="input w-full" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}><option value="">{t('Sin repositorio')}</option>{workspace.repositories.map((repository) => <option key={repository.repositoryId} value={repository.repositoryId}>{repository.name}</option>)}</select></Field>
              <Field label={t('Unidad padre')}><select className="input w-full" value={parentUnitId} onChange={(event) => setParentUnitId(event.target.value)}><option value="">{t('Nivel raíz')}</option>{workspace.units.filter((unit) => unit.unitId !== row.unit.unitId).map((unit) => <option key={unit.unitId} value={unit.unitId}>{unit.referenceCode ? `${unit.referenceCode} · ` : ''}{unit.title}</option>)}</select></Field>
              <div className="md:col-span-2">
                <Field
                  label={t('Lugar de procedencia')}
                  hint={t('Selecciona el lugar donde se originó esta fuente. Es el único lugar que la representa en el mapa de procedencia.')}
                >
                  <div className="space-y-2">
                    <select
                      className="input w-full"
                      value={provenancePlaceId}
                      onChange={(event) => setProvenancePlaceId(event.target.value)}
                      data-testid="primary-source-provenance-place-select"
                    >
                      <option value="">{t('Sin lugar de procedencia')}</option>
                      {availablePlaces.map((place) => (
                        <option key={place.placeId} value={place.placeId}>
                          {[place.name, place.admin1, place.country].filter(Boolean).join(' · ')}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                      onClick={() => setAddingPlace((current) => !current)}
                      disabled={placeBusy}
                    >
                      <Icon name={addingPlace ? 'x' : 'plus'} size={12} />
                      {t(addingPlace ? 'Cancelar nuevo lugar' : 'Añadir lugar al catálogo geográfico')}
                    </button>
                    {addingPlace && (
                      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/50">
                        <p className="mb-2 text-[10px] leading-4 text-neutral-500">
                          {t('Busca en el gacetero local; al elegir un resultado se añadirá al catálogo compartido y quedará seleccionado.')}
                        </p>
                        <PlacePicker onPick={(candidate) => void addPlaceFromGazetteer(candidate)} />
                        {placeBusy && <p className="mt-2 text-[10px] text-neutral-500">{t('Añadiendo lugar…')}</p>}
                      </div>
                    )}
                  </div>
                </Field>
              </div>
              <Field label={t('Creador documental')}><input className="input w-full" value={creator} onChange={(event) => setCreator(event.target.value)} /></Field>
              <Field label={t('Extensión')}><input className="input w-full" value={extentDisplay} onChange={(event) => setExtentDisplay(event.target.value)} /></Field>
              <Field label={t('Fecha tal como aparece')}><input className="input w-full" value={dateDisplay} onChange={(event) => setDateDisplay(event.target.value)} /></Field>
              <Field label={t('Certeza de la fecha')}><select className="input w-full" value={dateCertainty} onChange={(event) => setDateCertainty(event.target.value as typeof dateCertainty)}>{(['exact', 'circa', 'before', 'after', 'between', 'uncertain', 'unknown'] as const).map((value) => <option key={value} value={value}>{t({ exact: 'Exacta', circa: 'Aproximada', before: 'Anterior a', after: 'Posterior a', between: 'Entre fechas', uncertain: 'Incierta', unknown: 'Desconocida' }[value])}</option>)}</select></Field>
            </div>
          </section>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className={sectionClass}>
            <h2 className="text-sm font-semibold">{t('Acceso, estado y preservación')}</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label={t('Acceso')}><select className="input w-full" value={accessStatus} onChange={(event) => setAccessStatus(event.target.value as typeof accessStatus)}>{(['open', 'private', 'restricted', 'embargoed', 'unknown'] as const).map((value) => <option key={value} value={value}>{t({ open: 'Abierta', private: 'Privada', restricted: 'Restringida', embargoed: 'Embargada', unknown: 'Acceso por revisar' }[value])}</option>)}</select></Field>
              <Field label={t('Sensibilidad')}><select className="input w-full" value={sensitivity} onChange={(event) => setSensitivity(event.target.value as typeof sensitivity)}>{(['normal', 'personal', 'sensitive', 'highly_sensitive'] as const).map((value) => <option key={value} value={value}>{t({ normal: 'Normal', personal: 'Datos personales', sensitive: 'Sensible', highly_sensitive: 'Muy sensible' }[value])}</option>)}</select></Field>
              <Field label={t('Estado de procesamiento')}><select className="input w-full" value={processingStatus} onChange={(event) => setProcessingStatus(event.target.value as typeof processingStatus)}>{(['imported', 'needs_description', 'ready', 'processing', 'error', 'archived'] as const).map((value) => <option key={value} value={value}>{t({ imported: 'Importada', needs_description: 'Requiere descripción', ready: 'Preparada', processing: 'Procesando', error: 'Con incidencias', archived: 'Archivada' }[value])}</option>)}</select></Field>
              <Field label={t('Estado de descripción')}><select className="input w-full" value={descriptionStatus} onChange={(event) => setDescriptionStatus(event.target.value as typeof descriptionStatus)}>{(['minimal', 'provenance_incomplete', 'described', 'citation_ready'] as const).map((value) => <option key={value} value={value}>{t({ minimal: 'Mínima', provenance_incomplete: 'Procedencia incompleta', described: 'Descrita', citation_ready: 'Lista para citar' }[value])}</option>)}</select></Field>
              <Field label={t('Estado de cita')}><select className="input w-full" value={citationStatus} onChange={(event) => setCitationStatus(event.target.value as typeof citationStatus)}><option value="not_ready">{t('No preparada')}</option><option value="general_locator">{t('Localizador general')}</option><option value="ready">{t('Lista para citar')}</option></select></Field>
              <Field label={t('Sesión de captura')}><select className="input w-full" value={captureSessionId} onChange={(event) => setCaptureSessionId(event.target.value)}><option value="">{t('Sin sesión')}</option>{workspace.sessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{session.title}</option>)}</select></Field>
              <Field label={t('Embargo hasta')}><input className="input w-full" type="date" value={embargoUntil} onChange={(event) => setEmbargoUntil(event.target.value)} /></Field>
            </div>
            <div className="mt-4 space-y-4">
              <Field label={t('Declaración de derechos')}><textarea className="input min-h-20 w-full resize-y" value={rightsStatement} onChange={(event) => setRightsStatement(event.target.value)} /></Field>
              <Field label={t('Condiciones de reproducción')}><textarea className="input min-h-20 w-full resize-y" value={reproductionConditions} onChange={(event) => setReproductionConditions(event.target.value)} /></Field>
            </div>
          </section>

          <section className={sectionClass}>
            <h2 className="text-sm font-semibold">{t('Organización')}</h2>
            <div className="mt-4 space-y-4">
              <Field label={t('Etiquetas')} hint={t('Separadas por comas')}><input className="input w-full" value={tagsText} onChange={(event) => setTagsText(event.target.value)} /></Field>
              <div>
                <p className="mb-2 text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('Colecciones de trabajo')}</p>
                <div className="grid gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800 sm:grid-cols-2">
                  {workspace.collections.map((collection) => (
                    <label key={collection.folderId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800">
                      <input type="checkbox" checked={collectionIds.includes(collection.folderId)} onChange={(event) => setCollectionIds((current) => event.target.checked ? [...current, collection.folderId] : current.filter((id) => id !== collection.folderId))} />
                      <span className="truncate">{collection.name}</span>
                    </label>
                  ))}
                  {workspace.collections.length === 0 && <p className="text-xs text-neutral-500">{t('Aún no hay colecciones.')}</p>}
                </div>
              </div>
              <Field label={t('Idiomas')} hint={t('Códigos separados por comas, por ejemplo: es, la')}><input className="input w-full" value={languageCodes} onChange={(event) => setLanguageCodes(event.target.value)} /></Field>
              <Field label={t('Escrituras')} hint={t('Códigos separados por comas, por ejemplo: Latn')}><input className="input w-full" value={scriptCodes} onChange={(event) => setScriptCodes(event.target.value)} /></Field>
            </div>
          </section>
        </div>

        <details className={sectionClass}>
          <summary className="cursor-pointer text-sm font-semibold">{t('Descripción archivística avanzada')}</summary>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label={t('Organización original')}><textarea className="input min-h-20 w-full resize-y" value={arrangement} onChange={(event) => setArrangement(event.target.value)} /></Field>
            <Field label={t('Historia administrativa o biográfica')}><textarea className="input min-h-20 w-full resize-y" value={administrativeHistory} onChange={(event) => setAdministrativeHistory(event.target.value)} /></Field>
            <Field label={t('Historia de custodia')}><textarea className="input min-h-20 w-full resize-y" value={custodialHistory} onChange={(event) => setCustodialHistory(event.target.value)} /></Field>
            <Field label={t('Forma de ingreso')}><textarea className="input min-h-20 w-full resize-y" value={acquisitionInfo} onChange={(event) => setAcquisitionInfo(event.target.value)} /></Field>
            <Field label={t('Condiciones de acceso archivísticas')}><textarea className="input min-h-20 w-full resize-y" value={accessConditions} onChange={(event) => setAccessConditions(event.target.value)} /></Field>
            <Field label={t('Condiciones de reproducción archivísticas')}><textarea className="input min-h-20 w-full resize-y" value={unitReproductionConditions} onChange={(event) => setUnitReproductionConditions(event.target.value)} /></Field>
            <Field label={t('Características físicas')}><textarea className="input min-h-20 w-full resize-y" value={physicalCharacteristics} onChange={(event) => setPhysicalCharacteristics(event.target.value)} /></Field>
            <Field label={t('Instrumentos de descripción')}><textarea className="input min-h-20 w-full resize-y" value={findingAids} onChange={(event) => setFindingAids(event.target.value)} /></Field>
            <Field label={t('Unidades relacionadas')}><textarea className="input min-h-20 w-full resize-y" value={relatedUnits} onChange={(event) => setRelatedUnits(event.target.value)} /></Field>
            <Field label={t('URL del catálogo')}><input className="input w-full" type="url" value={sourceCatalogUrl} onChange={(event) => setSourceCatalogUrl(event.target.value)} /></Field>
          </div>
        </details>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="sticky bottom-0 flex justify-end border-t border-neutral-200 bg-neutral-50/95 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
          <button className="btn btn-primary gap-2" disabled={busy}><Icon name="save" size={14} />{busy ? t('Guardando…') : t('Guardar ficha')}</button>
        </div>
      </form>
    </div>
  );
}

function AnalysisTab({
  dossier,
  onChanged,
}: {
  dossier: PrimarySourceDossier;
  onChanged: () => Promise<void>;
}) {
  const empty: Omit<PrimarySourceAnalysis, 'analysisId' | 'itemId' | 'createdAt' | 'updatedAt'> = {
    originNotes: null,
    purposeAudience: null,
    contentForm: null,
    perspectiveBias: null,
    silencesLimits: null,
    authenticityNotes: null,
    representativeness: null,
    corroboration: null,
    questions: null,
    status: 'not_started',
  };
  const initial = dossier.analysis ?? empty;
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = [
    form.originNotes,
    form.purposeAudience,
    form.contentForm,
    form.perspectiveBias,
    form.silencesLimits,
    form.authenticityNotes,
    form.representativeness,
    form.corroboration,
    form.questions,
  ];
  const complete = fields.filter((value) => Boolean(value?.trim())).length;
  const patch = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await window.nodus.savePrimarySourceAnalysis(dossier.row.item.itemId, {
        ...form,
        status: form.status === 'not_started' && complete > 0 ? 'draft' : form.status,
      });
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-5 dark:bg-neutral-950" data-testid="primary-source-critical-analysis">
      <form className="mx-auto max-w-6xl space-y-5" onSubmit={save}>
        <header className="flex flex-wrap items-start gap-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300"><Icon name="search" size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{t('Crítica de la fuente')}</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">{t('Separa la crítica externa de la lectura interna. Documenta incertidumbres y corroboraciones sin convertir interpretaciones en hechos de la fuente.')}</p>
          </div>
          <div className="min-w-44">
            <div className="mb-1 flex justify-between text-[10px] text-neutral-500"><span>{t('Cobertura')}</span><span>{complete}/9</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-indigo-500" style={{ width: `${complete / 9 * 100}%` }} /></div>
            <select className="input mt-2 h-8 w-full text-xs" value={form.status} onChange={(event) => patch('status', event.target.value as PrimarySourceAnalysis['status'])} aria-label={t('Estado del análisis')}>
              <option value="not_started">{t('Sin iniciar')}</option>
              <option value="draft">{t('Borrador')}</option>
              <option value="reviewed">{t('Revisado')}</option>
            </select>
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-2">
          <AnalysisSection
            title={t('Crítica externa')}
            subtitle={t('Procedencia, soporte, transmisión y autenticidad del documento.')}
            icon="archive"
          >
            <AnalysisField label={t('Origen y cadena de custodia')} hint={t('Quién lo produjo, cuándo, dónde y cómo llegó hasta el repositorio.')}>
              <textarea className="input min-h-28 w-full" value={form.originNotes ?? ''} onChange={(event) => patch('originNotes', event.target.value || null)} />
            </AnalysisField>
            <AnalysisField label={t('Autenticidad e integridad')} hint={t('Original, copia, interpolaciones, daños, lagunas y señales materiales.')}>
              <textarea className="input min-h-28 w-full" value={form.authenticityNotes ?? ''} onChange={(event) => patch('authenticityNotes', event.target.value || null)} />
            </AnalysisField>
            <AnalysisField label={t('Forma y género documental')} hint={t('Carta, acta, registro, testimonio, fotografía u otra convención formal.')}>
              <textarea className="input min-h-24 w-full" value={form.contentForm ?? ''} onChange={(event) => patch('contentForm', event.target.value || null)} />
            </AnalysisField>
          </AnalysisSection>

          <AnalysisSection
            title={t('Crítica interna')}
            subtitle={t('Intención, perspectiva, silencios, alcance y contraste del contenido.')}
            icon="notebook"
          >
            <AnalysisField label={t('Propósito y audiencia')} hint={t('Para qué se creó y quién debía leerlo, verlo o escucharlo.')}>
              <textarea className="input min-h-24 w-full" value={form.purposeAudience ?? ''} onChange={(event) => patch('purposeAudience', event.target.value || null)} />
            </AnalysisField>
            <AnalysisField label={t('Perspectiva, posición y sesgos')} hint={t('Qué posición ocupa la voz documental y qué intereses condicionan su relato.')}>
              <textarea className="input min-h-28 w-full" value={form.perspectiveBias ?? ''} onChange={(event) => patch('perspectiveBias', event.target.value || null)} />
            </AnalysisField>
            <AnalysisField label={t('Silencios y límites')} hint={t('Qué no puede afirmar esta fuente y qué voces o contextos quedan fuera.')}>
              <textarea className="input min-h-28 w-full" value={form.silencesLimits ?? ''} onChange={(event) => patch('silencesLimits', event.target.value || null)} />
            </AnalysisField>
          </AnalysisSection>
        </div>

        <section className="grid gap-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900 md:grid-cols-3">
          <AnalysisField label={t('Representatividad')} hint={t('Caso excepcional, muestra típica o alcance todavía desconocido.')}>
            <textarea className="input min-h-28 w-full" value={form.representativeness ?? ''} onChange={(event) => patch('representativeness', event.target.value || null)} />
          </AnalysisField>
          <AnalysisField label={t('Corroboración y contradicciones')} hint={t('Fuentes independientes que confirman, matizan o contradicen el contenido.')}>
            <textarea className="input min-h-28 w-full" value={form.corroboration ?? ''} onChange={(event) => patch('corroboration', event.target.value || null)} />
          </AnalysisField>
          <AnalysisField label={t('Preguntas pendientes')} hint={t('Dudas verificables y próximas comprobaciones, no conclusiones prematuras.')}>
            <textarea className="input min-h-28 w-full" value={form.questions ?? ''} onChange={(event) => patch('questions', event.target.value || null)} />
          </AnalysisField>
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500">{form.status === 'reviewed' ? t('Análisis marcado como revisado.') : t('Puedes guardar un borrador incompleto y continuarlo más tarde.')}</p>
          <button className="btn btn-primary gap-2" disabled={saving}><Icon name="save" size={14} />{saving ? t('Guardando…') : t('Guardar análisis')}</button>
        </div>
      </form>
    </div>
  );
}

function AnalysisSection({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-5 flex gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"><Icon name={icon} size={14} /></span>
        <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-[11px] leading-4 text-neutral-500">{subtitle}</p></div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function AnalysisField({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-xs font-semibold">{label}</span><span className="mb-2 mt-1 block text-[10px] leading-4 text-neutral-500">{hint}</span>{children}</label>;
}

const PROPOSAL_KIND_LABELS: Record<PrimarySourceProposalKind, string> = {
  person: 'Persona',
  place: 'Lugar',
  date: 'Fecha',
  event: 'Evento',
  relation: 'Relación',
  organization: 'Organización',
  document_reference: 'Referencia documental',
};

const PROPOSAL_STATUS_LABELS: Record<PrimarySourceProposalStatus, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  deferred: 'Aplazada',
};

const EVIDENCE_ROLE_LABELS: Record<PrimarySourceEvidenceRole, string> = {
  supports: 'Apoya',
  contradicts: 'Contradice',
  contextualizes: 'Contextualiza',
  mentions: 'Menciona',
};

const RESOLUTION_DECISION_LABELS: Record<PrimarySourceDossier['resolutions'][number]['decision'], string> = {
  merge: 'Fusionar',
  separate: 'Mantener separadas',
  confirm: 'Confirmar coincidencia',
  discard: 'Descartar identidad',
};

function proposalTitle(proposal: PrimarySourceEntityProposal): string {
  const payload = proposal.payload;
  const value = payload.displayName ?? payload.name ?? payload.label ?? payload.date
    ?? (payload.subject && payload.object
      ? `${String(payload.subject)} — ${String(payload.relation ?? '')} — ${String(payload.object)}`
      : null);
  return typeof value === 'string' && value.trim() ? value : PROPOSAL_KIND_LABELS[proposal.proposalKind];
}

function EvidenceTab({
  dossier,
  onChanged,
  onOpenExcerpt,
}: {
  dossier: PrimarySourceDossier;
  onChanged: (message: string) => Promise<void>;
  onOpenExcerpt: (excerptId: string) => void;
}) {
  const [excerptId, setExcerptId] = useState(
    dossier.excerpts.find((excerpt) => excerpt.reviewStatus === 'reviewed')?.excerptId
      ?? dossier.excerpts.at(-1)?.excerptId
      ?? ''
  );
  const [status, setStatus] = useState<PrimarySourceProposalStatus | 'all'>('pending');
  const [kind, setKind] = useState<PrimarySourceProposalKind | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<string | null>(null);
  const proposals = dossier.proposals.filter((proposal) =>
    (status === 'all' || proposal.status === status)
    && (kind === 'all' || proposal.proposalKind === kind)
  );
  const pendingCount = dossier.proposals.filter((proposal) => proposal.status === 'pending').length;

  useEffect(() => {
    if (excerptId && dossier.excerpts.some((excerpt) => excerpt.excerptId === excerptId)) return;
    setExcerptId(dossier.excerpts.find((excerpt) => excerpt.reviewStatus === 'reviewed')?.excerptId
      ?? dossier.excerpts.at(-1)?.excerptId
      ?? '');
  }, [dossier.excerpts, excerptId]);

  const extract = async () => {
    if (!excerptId) return;
    setBusy(true);
    setError(null);
    setRunSummary(null);
    try {
      const { result } = await window.nodus.extractPrimarySourceProposals({
        itemId: dossier.row.item.itemId,
        excerptId,
      });
      setRunSummary(t('{created} propuestas nuevas · {reused} ya existentes')
        .replace('{created}', String(result.created))
        .replace('{reused}', String(result.reused)));
      await onChanged('Extracción terminada: los datos canónicos no se han modificado.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-5 dark:bg-neutral-950">
      <div className="mx-auto max-w-6xl space-y-5" data-testid="primary-source-evidence-workspace">
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5 dark:border-indigo-900 dark:bg-indigo-950/25">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-white"><Icon name="sparkles" size={16} /></span>
                <div>
                  <h2 className="text-sm font-semibold">{t('Extraer propuestas desde un fragmento')}</h2>
                  <p className="mt-0.5 text-[11px] leading-4 text-neutral-600 dark:text-neutral-400">{t('La IA solo llena esta cola. Personas, lugares, eventos y relaciones no cambian hasta que aceptes cada propuesta.')}</p>
                </div>
              </div>
            </div>
            <span className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-[10px] font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-neutral-950 dark:text-indigo-200">
              {pendingCount} {t('pendientes')}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="min-w-64 flex-1">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{t('Fragmento localizable')}</span>
              <select className="input w-full" value={excerptId} onChange={(event) => setExcerptId(event.target.value)}>
                {!dossier.excerpts.length && <option value="">{t('Crea primero un fragmento en la pestaña Texto')}</option>}
                {dossier.excerpts.map((excerpt) => (
                  <option key={excerpt.excerptId} value={excerpt.excerptId}>
                    {excerpt.locatorDisplay} · {(excerpt.quotedText ?? '').slice(0, 70)}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary gap-2" disabled={busy || !excerptId} onClick={() => void extract()}>
              <Icon name="sparkles" size={14} />{busy ? t('Extrayendo propuestas…') : t('Ejecutar IA')}
            </button>
          </div>
          {runSummary && <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">{runSummary}</p>}
          {error && <p className="mt-3 text-xs text-red-700 dark:text-red-300">{error}</p>}
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
            <div>
              <h2 className="text-sm font-semibold">{t('Cola de revisión humana')}</h2>
              <p className="mt-1 text-[10px] text-neutral-500">{t('Edita el dato, decide si coincide con una entidad existente y asigna el papel de la evidencia.')}</p>
            </div>
            <div className="flex gap-2">
              <select className="input h-8 text-xs" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                <option value="all">{t('Todos los estados')}</option>
                {Object.entries(PROPOSAL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
              <select className="input h-8 text-xs" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                <option value="all">{t('Todos los tipos')}</option>
                {Object.entries(PROPOSAL_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
            </div>
          </header>
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {proposals.map((proposal) => (
              <ProposalReviewCard
                key={`${proposal.proposalId}:${proposal.status}:${proposal.reviewedAt ?? ''}`}
                proposal={proposal}
                candidates={dossier.proposalCandidates.find((entry) => entry.proposalId === proposal.proposalId)?.candidates ?? []}
                decision={dossier.proposalDecisions.find((entry) => entry.proposalId === proposal.proposalId) ?? null}
                onOpenExcerpt={onOpenExcerpt}
                onChanged={onChanged}
              />
            ))}
            {!proposals.length && (
              <div className="p-10 text-center">
                <Icon name="inbox" size={26} className="mx-auto text-neutral-400" />
                <p className="mt-3 text-sm font-medium">{t('No hay propuestas con estos filtros')}</p>
                <p className="mt-1 text-xs text-neutral-500">{t('Elige un fragmento y ejecuta la extracción, o cambia los filtros.')}</p>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-sm font-semibold">{t('Registro de evidencia')}</h2>
            <p className="mt-1 text-[10px] text-neutral-500">{t('Cada registro conserva cita, localizador, versión de texto y decisión humana.')}</p>
            <div className="mt-4 space-y-2">
              {dossier.evidence.map((entry) => (
                <article key={entry.evidenceId} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${entry.evidenceRole === 'contradicts' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'}`}>{t(EVIDENCE_ROLE_LABELS[entry.evidenceRole])}</span>
                    <code className="text-[9px] text-neutral-400">{entry.targetKind}:{entry.targetId.slice(0, 12)}</code>
                  </div>
                  {entry.quote && <blockquote className="mt-2 border-l-2 border-neutral-300 pl-3 text-xs italic leading-5 text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">“{entry.quote}”</blockquote>}
                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-neutral-500">
                    <span>{entry.location ?? t('Sin localizador')}</span>
                    {entry.excerptId && <button className="font-medium text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => onOpenExcerpt(entry.excerptId!)}>{t('Abrir fragmento')}</button>}
                  </div>
                </article>
              ))}
              {!dossier.evidence.length && <p className="rounded-xl border border-dashed border-neutral-300 p-5 text-center text-xs text-neutral-500 dark:border-neutral-700">{t('La evidencia aparecerá al aceptar una propuesta.')}</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-sm font-semibold">{t('Resoluciones reversibles')}</h2>
            <p className="mt-1 text-[10px] text-neutral-500">{t('Las coincidencias de identidad quedan registradas; revertirlas no borra la propuesta ni su evidencia.')}</p>
            <div className="mt-4 space-y-2">
              {dossier.resolutions.map((resolution) => (
                <article key={resolution.resolutionId} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{t(resolution.entityKind === 'person' ? 'Identidad de persona' : 'Identidad de lugar')} · {t(RESOLUTION_DECISION_LABELS[resolution.decision])}</p>
                    <p className="mt-1 truncate text-[9px] text-neutral-500">{resolution.sourceEntityId} → {resolution.targetEntityId ?? '—'}</p>
                  </div>
                  {resolution.status === 'active'
                    ? <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void window.nodus.revertPrimarySourceEntityResolution(dossier.row.item.itemId, resolution.resolutionId).then(() => onChanged('Resolución revertida.'))}>{t('Revertir')}</button>
                    : <span className="text-[10px] text-neutral-400">{t('Revertida')}</span>}
                </article>
              ))}
              {!dossier.resolutions.length && <p className="rounded-xl border border-dashed border-neutral-300 p-5 text-center text-xs text-neutral-500 dark:border-neutral-700">{t('Todavía no hay coincidencias de identidad confirmadas.')}</p>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ProposalReviewCard({
  proposal,
  candidates,
  decision,
  onOpenExcerpt,
  onChanged,
}: {
  proposal: PrimarySourceEntityProposal;
  candidates: PrimarySourceProposalCandidate[];
  decision: PrimarySourceDossier['proposalDecisions'][number] | null;
  onOpenExcerpt: (excerptId: string) => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const [payloadText, setPayloadText] = useState(JSON.stringify(proposal.payload, null, 2));
  const [matchedTargetId, setMatchedTargetId] = useState(proposal.matchedTargetId ?? '');
  const [role, setRole] = useState<PrimarySourceEvidenceRole>('supports');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = proposal.status !== 'accepted';
  const targetCandidates = candidates.filter((candidate) => candidate.field === 'target');
  const subjectCandidates = candidates.filter((candidate) => candidate.field === 'subject');
  const objectCandidates = candidates.filter((candidate) => candidate.field === 'object');

  const parsePayload = (): Record<string, unknown> => {
    const value = JSON.parse(payloadText) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('El contenido editado debe ser un objeto JSON.'));
    return value as Record<string, unknown>;
  };
  const patchPayload = (field: string, value: string) => {
    try {
      setPayloadText(JSON.stringify({ ...parsePayload(), [field]: value || null }, null, 2));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const payloadField = (field: string): string => {
    try {
      const payload = JSON.parse(payloadText) as Record<string, unknown>;
      return typeof payload[field] === 'string' ? payload[field] as string : '';
    } catch {
      return '';
    }
  };
  const act = async (action: 'accept' | 'reject' | 'defer') => {
    setBusy(true);
    setError(null);
    try {
      const payload = parsePayload();
      if (action === 'accept') {
        await window.nodus.acceptPrimarySourceProposal(proposal.proposalId, {
          payload,
          matchedTargetId: matchedTargetId || null,
          evidenceRole: role,
          reviewer: 'primary_sources_user',
          note: note || null,
        });
        await onChanged('Propuesta aceptada: entidad y evidencia creadas en una sola transacción.');
      } else {
        await window.nodus.decidePrimarySourceProposal(proposal.proposalId, action === 'reject' ? 'rejected' : 'deferred', {
          payload,
          matchedTargetId: matchedTargetId || null,
          reviewer: 'primary_sources_user',
          note: note || null,
        });
        await onChanged(action === 'reject' ? 'Propuesta rechazada.' : 'Propuesta aplazada.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="p-4" data-testid={`proposal-${proposal.status}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{t(PROPOSAL_KIND_LABELS[proposal.proposalKind])}</span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${proposal.status === 'accepted' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200' : proposal.status === 'rejected' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200'}`}>{t(PROPOSAL_STATUS_LABELS[proposal.status])}</span>
          </div>
          <h3 className="mt-2 text-sm font-semibold">{proposalTitle(proposal)}</h3>
          <p className="mt-1 text-[10px] text-neutral-500">{proposal.sourceEngine ?? t('motor desconocido')} · {proposal.sourceModel ?? t('modelo desconocido')} · {proposal.rationale ?? t('sin justificación')}</p>
        </div>
        {proposal.excerptId && <button className="btn btn-ghost h-8 gap-1 px-2 text-[10px]" onClick={() => onOpenExcerpt(proposal.excerptId!)}><Icon name="locate" size={12} />{t('Abrir fragmento')}</button>}
      </div>

      {editable ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <label>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{t('Datos propuestos editables')}</span>
            <textarea className="input min-h-44 w-full font-mono text-[10px] leading-4" value={payloadText} onChange={(event) => setPayloadText(event.target.value)} spellCheck={false} />
          </label>
          <div className="space-y-3">
            {targetCandidates.length > 0 && (
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold">{t('Coincidencia canónica')}</span>
                <select className="input w-full text-xs" value={matchedTargetId} onChange={(event) => setMatchedTargetId(event.target.value)}>
                  <option value="">{t(proposal.proposalKind === 'person' ? 'Crear identidad provisional nueva' : 'Crear entidad nueva')}</option>
                  {targetCandidates.map((candidate) => <option key={candidate.targetId} value={candidate.targetId}>{candidate.match === 'exact' ? '= ' : '≈ '}{candidate.label}{candidate.detail ? ` · ${candidate.detail}` : ''}</option>)}
                </select>
              </label>
            )}
            {subjectCandidates.length > 0 && (
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold">{t('Resolver sujeto')}</span>
                <select className="input w-full text-xs" value={payloadField('subjectTargetId')} onChange={(event) => patchPayload('subjectTargetId', event.target.value)}>
                  <option value="">{t('Sin resolver')}</option>
                  {subjectCandidates.map((candidate) => <option key={candidate.targetId} value={candidate.targetId}>{candidate.match === 'exact' ? '= ' : '≈ '}{candidate.label}</option>)}
                </select>
              </label>
            )}
            {objectCandidates.length > 0 && (
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold">{t('Resolver objeto')}</span>
                <select className="input w-full text-xs" value={payloadField('objectTargetId')} onChange={(event) => patchPayload('objectTargetId', event.target.value)}>
                  <option value="">{t('Sin resolver')}</option>
                  {objectCandidates.map((candidate) => <option key={candidate.targetId} value={candidate.targetId}>{candidate.match === 'exact' ? '= ' : '≈ '}{candidate.label}</option>)}
                </select>
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold">{t('Papel de la evidencia')}</span>
              <select className="input w-full text-xs" value={role} onChange={(event) => setRole(event.target.value as PrimarySourceEvidenceRole)}>
                {Object.entries(EVIDENCE_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold">{t('Nota de decisión')}</span>
              <textarea className="input min-h-16 w-full text-xs" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('Motivo, duda o criterio aplicado…')} />
            </label>
          </div>
        </div>
      ) : decision ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/25">
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">{t('Materialización trazable completada')}</p>
          <p className="mt-1 text-[10px] text-emerald-700 dark:text-emerald-300">{decision.materializedTargetKind}:{decision.materializedTargetId} · {t('evidencia')} {decision.evidenceId}</p>
        </div>
      ) : null}

      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-300">{error}</p>}
      {editable && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button className="btn btn-ghost text-xs" disabled={busy} onClick={() => void act('defer')}>{t('Aplazar')}</button>
          <button className="btn btn-secondary text-xs text-rose-700 dark:text-rose-300" disabled={busy} onClick={() => void act('reject')}>{t('Rechazar')}</button>
          <button className="btn btn-primary gap-2 text-xs" disabled={busy} onClick={() => void act('accept')}><Icon name="check" size={13} />{busy ? t('Aplicando…') : t('Aceptar y crear evidencia')}</button>
        </div>
      )}
    </article>
  );
}

function FutureTab({ tab }: { tab: Exclude<DossierTab, 'source' | 'description' | 'text' | 'analysis' | 'history'> }) {
  const copy: Record<typeof tab, [string, string]> = {
    evidence: ['Evidencias localizables', 'Aquí aparecerán fragmentos, menciones y propuestas que siempre pueden volver a una página, región o tiempo.'],
    notes: ['Notas enlazadas', 'Aquí se mostrarán interpretaciones y preguntas enlazadas sin confundirlas con el contenido de la fuente.'],
  };
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-lg text-center"><Icon name="notebook" size={30} className="mx-auto text-neutral-400" /><h2 className="mt-4 text-lg font-semibold">{t(copy[tab][0])}</h2><p className="mt-2 text-sm leading-6 text-neutral-500">{t(copy[tab][1])}</p></div>
    </div>
  );
}

function AddRepresentationDialog({
  dossier,
  initialRole,
  supersedesFileId,
  selected,
  onClose,
  onComplete,
}: {
  dossier: PrimarySourceDossier;
  initialRole: ArchiveFileRole;
  supersedesFileId?: string;
  selected: ArchiveItemFile | null;
  onClose: () => void;
  onComplete: (fileId: string) => Promise<void>;
}) {
  const [role, setRole] = useState<ArchiveFileRole>(initialRole);
  const [paths, setPaths] = useState<string[]>([]);
  const [parentFileId, setParentFileId] = useState(selected?.role === 'master' ? selected.fileId : selected?.parentFileId ?? '');
  const [sequenceNo, setSequenceNo] = useState(selected?.sequenceNo ?? dossier.files.filter((file) => file.role === 'master').length);
  const [pageLabel, setPageLabel] = useState(selected?.pageLabel ?? '');
  const [operation, setOperation] = useState(initialRole === 'access' ? 'optimized_access_copy' : initialRole === 'derivative' ? 'documented_transformation' : '');
  const [parameters, setParameters] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const derived = !['master', 'supplement'].includes(role);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await window.nodus.addPrimarySourceFiles({
        itemId: dossier.row.item.itemId,
        paths,
        role,
        parentFileId: derived ? parentFileId || null : null,
        supersedesFileId: role === 'master' ? supersedesFileId ?? null : null,
        sequenceNo,
        pageLabel: pageLabel || null,
        transformation: derived ? {
          operation: operation.trim() || 'user_supplied_representation',
          parameters: parameters.trim() || null,
          source: 'user',
        } : null,
      });
      await onComplete(result.added[result.added.length - 1].fileId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[180] grid place-items-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="w-full max-w-2xl overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900" role="dialog" aria-modal="true" aria-labelledby="add-representation-title">
        <header className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <div className="min-w-0 flex-1"><h2 id="add-representation-title" className="font-semibold">{supersedesFileId ? t('Añadir nueva versión de máster') : t('Añadir archivo o representación')}</h2><p className="mt-1 text-xs leading-5 text-neutral-500">{supersedesFileId ? t('La versión anterior seguirá preservada y quedará marcada como sustituida.') : t('Los derivados conservan el enlace, la transformación y el checksum de su propio contenido.')}</p></div>
          <button className="btn btn-ghost h-8 w-8 p-0" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" size={14} /></button>
        </header>
        <form className="space-y-4 p-5" onSubmit={submit}>
          <button type="button" className="flex w-full items-center gap-3 rounded-xl border border-dashed border-neutral-300 p-4 text-left hover:border-indigo-400 dark:border-neutral-700" onClick={() => void window.nodus.choosePrimarySourceFiles().then(setPaths)}>
            <Icon name="folder" /><span className="min-w-0 flex-1"><strong className="block text-sm">{paths.length ? t('Cambiar archivos') : t('Elegir archivos')}</strong><span className="block truncate text-xs text-neutral-500">{paths.length ? paths.map((value) => value.split(/[\\/]/).pop()).join(', ') : t('Se conserva cada byte del archivo seleccionado.')}</span></span>
          </button>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Rol del archivo')}><select className="input w-full" value={role} disabled={Boolean(supersedesFileId)} onChange={(event) => setRole(event.target.value as ArchiveFileRole)}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></Field>
            <Field label={t('Posición en la secuencia')}><input className="input w-full" type="number" min="0" value={sequenceNo} onChange={(event) => setSequenceNo(Math.max(0, Number(event.target.value)))} /></Field>
            <Field label={t('Etiqueta de página o parte')}><input className="input w-full" value={pageLabel} onChange={(event) => setPageLabel(event.target.value)} placeholder={t('Ej. fol. 3r, página 12, cara B')} /></Field>
            {derived && <Field label={t('Archivo padre')}><select required className="input w-full" value={parentFileId} onChange={(event) => setParentFileId(event.target.value)}><option value="">{t('Selecciona el origen')}</option>{dossier.files.filter((file) => file.role !== 'thumbnail').map((file) => <option key={file.fileId} value={file.fileId}>{t(ROLE_LABELS[file.role])} · {file.originalFileName}</option>)}</select></Field>}
          </div>
          {derived && (
            <fieldset className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
              <legend className="px-2 text-xs font-semibold">{t('Transformación documentada')}</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('Operación o finalidad')}><input required className="input w-full" value={operation} onChange={(event) => setOperation(event.target.value)} placeholder="optimized_access_copy" /></Field>
                <Field label={t('Herramienta, parámetros o notas')}><input className="input w-full" value={parameters} onChange={(event) => setParameters(event.target.value)} /></Field>
              </div>
            </fieldset>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={busy || paths.length === 0}>{busy ? t('Importando y verificando…') : t('Preservar archivo')}</button></div>
        </form>
      </section>
    </div>
  );
}

function IntegrityDot({ status }: { status: ArchiveItemFile['verificationStatus'] }) {
  const color = status === 'verified' ? 'bg-emerald-500' : status === 'pending' ? 'bg-neutral-400' : status === 'missing' ? 'bg-amber-500' : 'bg-red-500';
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} title={t(STATUS_LABELS[status])} />;
}

function StatusPill({ status }: { status: PrimarySourceArchiveRow['profile']['accessStatus'] }) {
  const labels = { open: 'Abierta', private: 'Privada', restricted: 'Restringida', embargoed: 'Embargada', unknown: 'Acceso por revisar' } as const;
  return <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{t(labels[status])}</span>;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block text-xs text-neutral-600 dark:text-neutral-400"><span className="mb-1.5 block font-medium">{label}</span>{children}{hint && <span className="mt-1 block text-[10px] leading-4 text-neutral-500">{hint}</span>}</label>;
}
