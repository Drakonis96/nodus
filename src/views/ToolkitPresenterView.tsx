// PDF Presenter — the library workspace (F0). Imports PDFs and converts externally
// authored presentations to the same internal PDF representation in a global Toolkit
// shelf and lets you organise them with tags, search, sort, rename, tag, download
// and delete, with a lazy thumbnail grid for the selected deck. Presenting, notes and
// the mobile remote arrive in later phases; the model + reducers are pure
// (@shared/presenterTypes) and the thumbnail engine is memory-bounded
// (src/lib/presenter/thumbSession) so even a several-hundred-page deck stays light.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from '../components/ui';
import { ToolkitAppHero } from '../components/ToolkitAppHero';
import { confirm } from '../components/feedback';
import { t, tx } from '../i18n';
import {
  addTag,
  assignTag,
  noteCount,
  queryPresentations,
  removePresentation,
  removeTag,
  renamePresentation,
  tagCount,
  upsertPresentation,
  videoCount,
  type Presentation,
  type PresenterLibrary,
  type PresenterSortMode,
  type PresenterTag,
} from '@shared/presenterTypes';
import { loadPresenterPdf } from '../lib/presenter/pdf';
import { createThumbSession, type ThumbSession } from '../lib/presenter/thumbSession';
import { PresenterNotesModal } from './ToolkitPresenterNotes';
import { PresenterVideoModal } from './ToolkitPresenterVideo';

const SORT_OPTIONS: { value: PresenterSortMode; label: string }[] = [
  { value: 'recent-added', label: 'Añadido recientemente' },
  { value: 'recent-opened', label: 'Abierto recientemente' },
  { value: 'name-asc', label: 'Nombre (A→Z)' },
  { value: 'name-desc', label: 'Nombre (Z→A)' },
];

function makeTagId(): string {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function ToolkitPresenterView({ onBack }: { onBack: () => void }) {
  const [library, setLibrary] = useState<PresenterLibrary>({ presentations: [], tags: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentTag, setCurrentTag] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<PresenterSortMode>('recent-added');
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Presentation | null>(null);
  const [pendingDeleteTag, setPendingDeleteTag] = useState<PresenterTag | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [videoSlide, setVideoSlide] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);

  // The live pdfjs doc for the selected deck (one at a time — destroyed on change).
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const thumbSessionRef = useRef<ThumbSession | null>(null);

  const selected = useMemo(
    () => library.presentations.find((p) => p.id === selectedId) ?? null,
    [library.presentations, selectedId],
  );

  const visible = useMemo(
    () => queryPresentations(library, { tag: currentTag, search, sort }),
    [library, currentTag, search, sort],
  );

  // ── Persistence ────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    void window.nodus.getPresenterLibrary().then((lib) => {
      if (alive) setLibrary(lib);
    });
    return () => {
      alive = false;
    };
  }, []);

  const commit = useCallback((next: PresenterLibrary) => {
    setLibrary(next);
    void window.nodus.savePresenterLibrary(next);
  }, []);

  // Stable (functional-update) persist for the notes editor, so re-renders while
  // it is open never swap its onChange identity.
  const handleNotesChange = useCallback((next: Presentation) => {
    setLibrary((lib) => {
      const merged = upsertPresentation(lib, next);
      void window.nodus.savePresenterLibrary(merged);
      return merged;
    });
  }, []);

  // ── Thumbnails for the selected deck ─────────────────────────────────────────
  useEffect(() => {
    // Tear down any previous session + doc first — never keep two decks live.
    thumbSessionRef.current?.destroy();
    thumbSessionRef.current = null;
    const prevDoc = pdfDocRef.current;
    pdfDocRef.current = null;
    if (prevDoc) void prevDoc.destroy();

    if (!selected) return;
    let cancelled = false;

    void (async () => {
      const doc = await loadPresenterPdf(selected.id);
      if (cancelled || !doc) {
        if (doc) void doc.destroy();
        return;
      }
      pdfDocRef.current = doc;

      // Persist the page count the first time we learn it (drives the list meta).
      if (doc.numPages !== selected.totalPages) {
        commit(upsertPresentation(library, { ...selected, totalPages: doc.numPages }));
      }

      const firstPage = await doc.getPage(1);
      const vp = firstPage.getViewport({ scale: 1 });
      const aspect = vp.width / vp.height;
      firstPage.cleanup?.();
      if (cancelled || !gridRef.current) return;

      thumbSessionRef.current = createThumbSession({
        container: gridRef.current,
        scrollRoot: gridScrollRef.current,
        doc,
        pageCount: doc.numPages,
        scale: 0.5,
        fallbackAspect: aspect,
        buildItem: (pageNum) => buildThumbTile(pageNum, selected, () => setVideoSlide(pageNum)),
      });
    })();

    return () => {
      cancelled = true;
    };
    // Re-run when the selected deck changes; `library`/`commit` are stable enough
    // that keying on the id avoids rebuilding thumbnails on unrelated edits.
  }, [selectedId]);

  // Destroy the live doc when the whole view unmounts.
  useEffect(
    () => () => {
      thumbSessionRef.current?.destroy();
      void pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
    },
    [],
  );

  // ── Actions ──────────────────────────────────────────────────────────────────
  const selectPresentation = useCallback(
    (id: string) => {
      setSelectedId(id);
      const p = library.presentations.find((x) => x.id === id);
      if (p) commit(upsertPresentation(library, { ...p, lastOpenedAt: new Date().toISOString() }));
    },
    [library, commit],
  );

  const importPresentation = useCallback(async () => {
    const selection = await window.nodus.pickPresenterImport();
    if (!selection) return;

    if (selection.needsConversion) {
      const proceed = await confirm({
        title: t('Convertir presentación a PDF'),
        message: t('Para ofrecer una presentación fluida y estable, Nodus convertirá este archivo a PDF antes de importarlo. Las animaciones, transiciones y otros elementos interactivos no se conservarán. El archivo original no se modificará. ¿Quieres continuar?'),
        confirmLabel: t('Convertir e importar'),
      });
      if (!proceed) return;
    }

    setImporting(true);
    try {
      const result = await window.nodus.importPresenterFile(selection.token);
      if (!result.ok) {
        if (result.code === 'no-converter') {
          setNotice({
            title: t('No hay una aplicación compatible'),
            body: t('Nodus no encontró PowerPoint, Keynote ni LibreOffice en este equipo. Instala LibreOffice o exporta la presentación a PDF desde la aplicación con la que la creaste.'),
          });
        } else if (result.code === 'unsupported-format') {
          setNotice({
            title: t('Formato no compatible'),
            body: t('Selecciona un archivo PDF, PowerPoint, OpenDocument Presentation o Keynote compatible.'),
          });
        } else {
          setNotice({
            title: t('No se pudo importar la presentación'),
            body: t('Nodus no pudo convertir este archivo. Prueba a abrirlo en la aplicación con la que lo creaste y expórtalo a PDF.'),
          });
        }
        return;
      }
      const created = result.presentation;
      const fresh = await window.nodus.getPresenterLibrary();
      // Importing while a tag filter is on tags the new deck, so it does not
      // vanish from the list the moment it lands.
      const next = currentTag ? assignTag(fresh, created.id, currentTag) : fresh;
      commit(next);
      setSelectedId(created.id);
    } finally {
      setImporting(false);
    }
  }, [currentTag, commit]);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    void window.nodus.deletePresenterPresentation(id);
    setLibrary((lib) => removePresentation(lib, id));
    if (selectedId === id) setSelectedId(null);
    setPendingDelete(null);
  }, [pendingDelete, selectedId]);

  const createTag = useCallback(() => {
    const name = newTagName.trim();
    if (!name) return;
    commit(addTag(library, { id: makeTagId(), name, createdAt: new Date().toISOString() }));
    setNewTagName('');
    setNewTagOpen(false);
  }, [newTagName, library, commit]);

  // Deleting a tag only unties it from its presentations, but it is still
  // irreversible (the name is gone), so it goes through a confirmation.
  const confirmDeleteTag = useCallback(() => {
    if (!pendingDeleteTag) return;
    const tagId = pendingDeleteTag.id;
    commit(removeTag(library, tagId));
    if (currentTag === tagId) setCurrentTag('');
    setPendingDeleteTag(null);
  }, [pendingDeleteTag, library, currentTag, commit]);

  const downloadPdf = useCallback(async () => {
    if (!selected) return;
    setDownloading(true);
    try {
      // Cancelling the native dialog is not a failure, so only a real problem
      // raises a notice.
      const result = await window.nodus.downloadPresenterPdf(selected.id, selected.name);
      if (result === 'missing') {
        setNotice({ title: t('Error'), body: t('No se pudo descargar la presentación.') });
      }
    } catch {
      setNotice({ title: t('Error'), body: t('No se pudo descargar la presentación.') });
    } finally {
      setDownloading(false);
    }
  }, [selected]);

  const commitRename = useCallback(
    (id: string, name: string) => {
      setRenamingId(null);
      if (name.trim()) commit(renamePresentation(library, id, name));
    },
    [library, commit],
  );

  const openNotes = useCallback(() => {
    if (pdfDocRef.current) setNotesOpen(true);
  }, []);

  const importNotes = useCallback(async () => {
    if (!selected) return;
    const result = await window.nodus.importPresenterPptxNotes();
    if (!result) return;
    if (result.totalSlides !== selected.totalPages) {
      setNotice({
        title: t('El número de diapositivas no coincide'),
        body: tx('El PowerPoint tiene {pptx} diapositivas y el PDF tiene {pdf}. Deben coincidir para importar las notas.', {
          pptx: result.totalSlides,
          pdf: selected.totalPages,
        }),
      });
      return;
    }
    commit(upsertPresentation(library, { ...selected, notes: result.notes }));
    setNotice({
      title: t('Notas importadas'),
      body: tx('Se importaron notas para {n} diapositivas.', { n: Object.keys(result.notes).length }),
    });
  }, [selected, library, commit]);

  const exportTxtNotes = useCallback(async () => {
    if (!selected) return;
    try {
      await window.nodus.exportPresenterNotesTxt(selected);
    } catch {
      setNotice({ title: t('Error'), body: t('No se pudieron exportar las notas a TXT.') });
    }
  }, [selected]);

  const importTxtNotes = useCallback(async () => {
    if (!selected) return;
    try {
      const result = await window.nodus.importPresenterNotesTxt();
      if (!result) return;
      if (result.totalSlides !== selected.totalPages) {
        setNotice({
          title: t('El número de diapositivas no coincide'),
          body: tx('El TXT tiene {txt} diapositivas y el PDF tiene {pdf}. Deben coincidir para importar las notas.', {
            txt: result.totalSlides,
            pdf: selected.totalPages,
          }),
        });
        return;
      }
      commit(upsertPresentation(library, { ...selected, notes: result.notes }));
      setNotice({
        title: t('Notas importadas'),
        body: tx('Se importaron notas para {n} diapositivas.', { n: Object.keys(result.notes).length }),
      });
    } catch {
      setNotice({ title: t('Error'), body: t('El archivo TXT de notas no tiene un formato válido.') });
    }
  }, [selected, library, commit]);

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4">
      <ToolkitAppHero
        badge="Nodus Toolkit"
        title="PDF Presenter"
        description={t('Importa un PDF o una presentación para empezar')}
        icon="presentation"
        actionLabel={importing ? t('Importando…') : t('Importar PDF o presentación')}
        actionIcon="plus"
        onAction={importPresentation}
        onBack={onBack}
        heroTestId="toolkit-presenter-hero"
        actionTestId="presenter-import"
        backTestId="presenter-back"
        actionDisabled={importing}
        actionBusy={importing}
      />

      {/* Toolbar: search + sort. Import is the primary hero action. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Buscar presentaciones…')}
            className="h-9 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900/40"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as PresenterSortMode)}
          className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm outline-none focus:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900/40"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
      </div>

      {/* Tag chips — clicking one filters the list down to that tag. */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="presenter-tags">
        <TagChip
          active={currentTag === ''}
          label={t('Todas')}
          count={library.presentations.length}
          onClick={() => setCurrentTag('')}
        />
        {library.tags.map((tg) => (
          <TagChip
            key={tg.id}
            active={currentTag === tg.id}
            label={tg.name}
            count={tagCount(library, tg.id)}
            onClick={() => setCurrentTag(currentTag === tg.id ? '' : tg.id)}
            onDelete={() => setPendingDeleteTag(tg)}
          />
        ))}
        {newTagOpen ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createTag();
                if (e.key === 'Escape') {
                  setNewTagOpen(false);
                  setNewTagName('');
                }
              }}
              placeholder={t('Nombre de la etiqueta')}
              data-testid="presenter-new-tag-name"
              className="h-7 w-40 rounded-md border border-neutral-300 bg-white px-2 text-xs outline-none focus:border-amber-400 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="button"
              onClick={createTag}
              data-testid="presenter-create-tag"
              className="btn btn-accent h-7 min-h-7 px-2 text-xs"
            >
              {t('Crear')}
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNewTagOpen(true)}
            data-testid="presenter-new-tag"
            className="flex h-7 items-center gap-1 rounded-full border border-dashed border-neutral-300 px-2.5 text-xs text-neutral-500 hover:border-amber-400 hover:text-amber-600 dark:border-neutral-700"
          >
            <Icon name="plus" size={13} className="shrink-0" />
            {t('Nueva etiqueta')}
          </button>
        )}
      </div>

      {/* List + detail */}
      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,20rem)_1fr]">
        {/* Presentation list */}
        <div className="min-h-0 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          {visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <Icon name="presentation" size={32} className="text-neutral-300 dark:text-neutral-600" />
              <p className="text-sm text-neutral-500">
                {search ? t('Sin resultados') : t('Aún no hay presentaciones')}
              </p>
              <p className="text-xs text-neutral-400">
                {search ? t('Prueba con otra búsqueda') : t('Importa un PDF o una presentación para empezar')}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
              {visible.map((p) => (
                <li key={p.id}>
                  <PresentationRow
                    presentation={p}
                    active={p.id === selectedId}
                    renaming={renamingId === p.id}
                    onSelect={() => selectPresentation(p.id)}
                    onStartRename={() => setRenamingId(p.id)}
                    onCommitRename={(name) => commitRename(p.id, name)}
                    onDelete={() => setPendingDelete(p)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail */}
        <div ref={gridScrollRef} className="min-h-0 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          {selected ? (
            <div className="flex h-full flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 p-4 dark:border-neutral-800/60">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{selected.name}</h2>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {selected.totalPages
                      ? tx('{n} diapositivas', { n: selected.totalPages })
                      : t('Cargando…')}
                    {noteCount(selected) > 0 ? ` · ${tx('{n} con notas', { n: noteCount(selected) })}` : ''}
                    {videoCount(selected) > 0 ? ` · ${tx('{n} con vídeo', { n: videoCount(selected) })}` : ''}
                  </p>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                  {t('Etiqueta')}
                  <select
                    value={selected.tag || ''}
                    onChange={(e) => commit(assignTag(library, selected.id, e.target.value))}
                    data-testid="presenter-tag-select"
                    className="h-8 rounded-lg border border-neutral-200 bg-white px-2 text-xs outline-none focus:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900/40"
                  >
                    <option value="">{t('Sin etiqueta')}</option>
                    {library.tags.map((tg) => (
                      <option key={tg.id} value={tg.id}>
                        {tg.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800/60">
                <button
                  type="button"
                  onClick={() => window.nodus.startPresenter(selected.id)}
                  disabled={!selected.totalPages}
                  data-testid="presenter-present"
                  className="btn btn-accent h-9 min-h-9 gap-1.5 px-3 text-sm disabled:opacity-50"
                >
                  <Icon name="play" size={16} className="shrink-0" />
                  {t('Presentar')}
                </button>
                <button
                  type="button"
                  onClick={() => window.nodus.startPresenterMode(selected.id)}
                  disabled={!selected.totalPages}
                  className="btn btn-ghost h-9 min-h-9 gap-1.5 px-3 text-sm disabled:opacity-50"
                >
                  <Icon name="presentation" size={16} className="shrink-0" />
                  {t('Modo presentador')}
                </button>
                <button
                  type="button"
                  onClick={downloadPdf}
                  disabled={downloading}
                  data-testid="presenter-download-pdf"
                  className="btn btn-ghost h-9 min-h-9 gap-1.5 px-3 text-sm disabled:opacity-50"
                >
                  <Icon name="download" size={16} className="shrink-0" />
                  {t('Descargar PDF')}
                </button>
                <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-800" />
                <button
                  type="button"
                  onClick={openNotes}
                  disabled={!selected.totalPages}
                  data-testid="presenter-open-notes"
                  className="btn btn-ghost h-9 min-h-9 gap-1.5 px-3 text-sm disabled:opacity-50"
                >
                  <Icon name="edit" size={16} className="shrink-0" />
                  {t('Notas del presentador')}
                </button>
                <button
                  type="button"
                  onClick={importNotes}
                  disabled={!selected.totalPages}
                  className="btn btn-ghost h-9 min-h-9 gap-1.5 px-3 text-sm disabled:opacity-50"
                >
                  <Icon name="upload" size={16} className="shrink-0" />
                  {t('Importar notas (.pptx)')}
                </button>
                <button
                  type="button"
                  onClick={exportTxtNotes}
                  disabled={!selected.totalPages}
                  data-testid="presenter-export-notes-txt"
                  className="btn btn-ghost h-9 min-h-9 gap-1.5 px-3 text-sm disabled:opacity-50"
                >
                  <Icon name="download" size={16} className="shrink-0" />
                  {t('Exportar notas')} (.txt)
                </button>
                <button
                  type="button"
                  onClick={importTxtNotes}
                  disabled={!selected.totalPages}
                  data-testid="presenter-import-notes-txt"
                  className="btn btn-ghost h-9 min-h-9 gap-1.5 px-3 text-sm disabled:opacity-50"
                >
                  <Icon name="upload" size={16} className="shrink-0" />
                  {t('Importar notas (.txt)')}
                </button>
              </div>
              {/* Thumbnails grid — imperatively populated by the thumb session. */}
              <div
                ref={gridRef}
                data-testid="presenter-thumbs"
                className="grid flex-1 grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4"
              />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                <Icon name="presentation" size={26} />
              </span>
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{t('Selecciona una presentación')}</p>
              <p className="max-w-xs text-xs text-neutral-400">
                {t('Elige una presentación de la lista para ver sus diapositivas, o importa un PDF o una presentación nueva.')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Tag delete confirmation */}
      {pendingDeleteTag && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingDeleteTag(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            data-testid="presenter-delete-tag-modal"
            className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Eliminar etiqueta')}</h3>
            <p className="mt-1.5 text-sm text-neutral-500">
              {tx('¿Seguro que quieres eliminar la etiqueta «{name}»? Las presentaciones que la tienen seguirán en la biblioteca, pero sin etiqueta.', {
                name: pendingDeleteTag.name,
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingDeleteTag(null)} className="btn btn-ghost h-9 min-h-9 px-3 text-sm">
                {t('Cancelar')}
              </button>
              <button
                type="button"
                onClick={confirmDeleteTag}
                data-testid="presenter-delete-tag-confirm"
                className="btn h-9 min-h-9 bg-red-600 px-3 text-sm text-white hover:bg-red-700"
              >
                {t('Eliminar')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingDelete(null);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Eliminar presentación')}</h3>
            <p className="mt-1.5 text-sm text-neutral-500">
              {tx('¿Seguro que quieres eliminar «{name}»? Esta acción no se puede deshacer.', { name: pendingDelete.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingDelete(null)} className="btn btn-ghost h-9 min-h-9 px-3 text-sm">
                {t('Cancelar')}
              </button>
              <button type="button" onClick={confirmDelete} className="btn h-9 min-h-9 bg-red-600 px-3 text-sm text-white hover:bg-red-700">
                {t('Eliminar')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Speaker-notes editor */}
      {notesOpen && selected && pdfDocRef.current && (
        <PresenterNotesModal
          presentation={selected}
          pdfDoc={pdfDocRef.current}
          onChange={handleNotesChange}
          onClose={() => setNotesOpen(false)}
        />
      )}

      {/* Per-slide video editor */}
      {videoSlide != null && selected && pdfDocRef.current && (
        <PresenterVideoModal
          presentation={selected}
          pdfDoc={pdfDocRef.current}
          slide={videoSlide}
          onChange={handleNotesChange}
          onClose={() => setVideoSlide(null)}
        />
      )}

      {/* Import notice (mismatch / success) */}
      {notice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNotice(null);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{notice.title}</h3>
            <p className="mt-1.5 text-sm text-neutral-500">{notice.body}</p>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setNotice(null)} className="btn btn-accent h-9 min-h-9 px-3 text-sm">
                {t('Entendido')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One filter chip. Clicking the body filters the list by that tag (clicking the
 *  active one clears the filter); the × asks for confirmation before deleting. */
function TagChip({
  active,
  label,
  count,
  onClick,
  onDelete,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <span
      className={`group flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors ${
        active
          ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300'
          : 'border-neutral-200 text-neutral-600 hover:border-neutral-300 dark:border-neutral-800 dark:text-neutral-300'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        title={t('Filtrar por etiqueta')}
        data-testid="presenter-tag-chip"
        className="flex items-center gap-1.5"
      >
        {onDelete && <Icon name="tag" size={13} className="shrink-0" />}
        <span className="max-w-[10rem] truncate">{label}</span>
        <span className="text-[10px] opacity-60">{count}</span>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title={t('Eliminar etiqueta')}
          data-testid="presenter-delete-tag"
          className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
        >
          <Icon name="x" size={12} className="shrink-0" />
        </button>
      )}
    </span>
  );
}

function PresentationRow({
  presentation,
  active,
  renaming,
  onSelect,
  onStartRename,
  onCommitRename,
  onDelete,
}: {
  presentation: Presentation;
  active: boolean;
  renaming: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(presentation.name);
  useEffect(() => {
    if (renaming) setDraft(presentation.name);
  }, [renaming, presentation.name]);

  const meta = [
    presentation.totalPages ? tx('{n} diapositivas', { n: presentation.totalPages }) : t('Sin cargar'),
    noteCount(presentation) > 0 ? t('Notas') : null,
    videoCount(presentation) > 0 ? t('Vídeos') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      onClick={renaming ? undefined : onSelect}
      data-testid="presenter-row"
      className={`group flex cursor-pointer items-center gap-2 px-3 py-2.5 transition-colors ${
        active ? 'bg-amber-50 dark:bg-amber-500/10' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/40'
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        <Icon name="file" size={16} />
      </span>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => onCommitRename(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename(draft);
              if (e.key === 'Escape') onCommitRename(presentation.name);
            }}
            className="w-full rounded border border-amber-400 bg-white px-1.5 py-0.5 text-sm outline-none dark:bg-neutral-900"
          />
        ) : (
          <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{presentation.name}</div>
        )}
        <div className="truncate text-xs text-neutral-400">{meta}</div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          title={t('Renombrar')}
          onClick={(e) => {
            e.stopPropagation();
            onStartRename();
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700 dark:hover:bg-neutral-700/60"
        >
          <Icon name="edit" size={14} />
        </button>
        <button
          type="button"
          title={t('Eliminar')}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-500/15"
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}

/** Build one thumbnail tile (label + canvas) for the lazy thumb session. Clicking a
 *  tile opens the per-slide video editor. */
function buildThumbTile(pageNum: number, presentation: Presentation, onClick: () => void) {
  const element = document.createElement('button');
  element.type = 'button';
  element.title = t('Añadir o editar vídeo');
  element.addEventListener('click', onClick);
  element.className =
    'relative block w-full cursor-pointer overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 text-left transition-colors hover:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900/40';

  const canvas = document.createElement('canvas');
  canvas.className = 'block w-full';

  const label = document.createElement('div');
  label.className =
    'absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 text-[10px] text-white';
  const num = document.createElement('span');
  num.textContent = String(pageNum);
  label.appendChild(num);

  const badges = document.createElement('span');
  badges.className = 'flex gap-1';
  if (presentation.notes?.[String(pageNum)]) {
    const dot = document.createElement('span');
    dot.className = 'inline-block h-1.5 w-1.5 rounded-full bg-amber-400';
    dot.title = t('Tiene notas');
    badges.appendChild(dot);
  }
  if (presentation.videos?.[String(pageNum)]) {
    const dot = document.createElement('span');
    dot.className = 'inline-block h-1.5 w-1.5 rounded-full bg-sky-400';
    dot.title = t('Tiene vídeo');
    badges.appendChild(dot);
  }
  label.appendChild(badges);

  element.appendChild(canvas);
  element.appendChild(label);
  return { element, canvas };
}
