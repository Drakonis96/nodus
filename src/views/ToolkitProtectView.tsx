import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  AppLanguage,
  ProtectArtifact,
  ProtectFilePayload,
  ProtectIssuedCopy,
  ProtectSourceSummary,
  ProtectWatermark,
} from '@shared/types';
import { Icon, Spinner } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { getActiveLang, t, tx } from '../i18n';
import {
  PROTECT_AUTHORITIES,
  buildProtectArtifact,
  composeProtectPage,
  defaultProtectAuthority,
  issuedCopiesCsv,
  ensureProtectPage,
  loadProtectPages,
  verifyProtectFile,
  type ProtectComposeCopy,
  type ProtectVerifyResult,
} from '../lib/protect/engine';
import {
  ProtectEditor,
  cloneRedactionForPage,
  type ProtectCrop,
  type ProtectEditorTool,
  type ProtectRect,
} from '../lib/protect/editor';
import { protectSession, type ProtectSessionState } from '../lib/protect/session';
import { PROTECT_PATTERNS, PROTECT_SWATCHES } from '../lib/protect/watermark';

type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;
type Destination = 'disk' | 'vault' | 'share';

let verifyPayloadCache: ProtectFilePayload | null = null;

const SUFFIX: Record<AppLanguage, string> = {
  es: 'protegido', en: 'protected', fr: 'protege', de: 'geschuetzt', pt: 'protegido', 'pt-BR': 'protegido', it: 'protetto',
};

function copy(): ProtectComposeCopy {
  return {
    language: getActiveLang(),
    unauthorized: t('SIN AUTORIZAR'),
    protectedWith: t('Protegido con'),
    brand: 'Nodus Protect',
    version: `Nodus v${__APP_VERSION__}`,
    legalEu: t('Reglamento General de Protección de Datos (RGPD)'),
    contactEmail: t('Correo'),
    contactPhone: t('Teléfono'),
  };
}

function useProtectState(): ProtectSessionState {
  return useSyncExternalStore(protectSession.subscribe, protectSession.get, protectSession.get);
}

function patch(patchValue: Partial<ProtectSessionState>): void {
  protectSession.patch(patchValue);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function protectErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const encrypted = raw.match(/El PDF «([^»]+)» está cifrado\./);
  if (encrypted) return tx('El PDF «{name}» está cifrado. Guarda una copia sin contraseña y vuelve a intentarlo.', { name: encrypted[1] });
  const damaged = raw.match(/El PDF «([^»]+)» está dañado o no es válido\./);
  if (damaged) return tx('El PDF «{name}» está dañado o no es válido.', { name: damaged[1] });
  const empty = raw.match(/El PDF «([^»]+)» no contiene páginas\./);
  if (empty) return tx('El PDF «{name}» no contiene páginas.', { name: empty[1] });
  switch (raw) {
    case 'No se pudo leer la imagen.': return t('No se pudo leer la imagen.');
    case 'Formato no compatible. Usa imágenes o PDF.': return t('Formato no compatible. Usa imágenes o PDF.');
    case 'El documento no contiene páginas legibles.': return t('El documento no contiene páginas legibles.');
    case 'No hay páginas para exportar.': return t('No hay páginas para exportar.');
    case 'Formato no compatible.': return t('Formato no compatible.');
    case 'Web Crypto no está disponible.': return t('Web Crypto no está disponible.');
    case 'No se pudo codificar la imagen.': return t('No se pudo codificar la imagen.');
    default: return raw;
  }
}

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  if (!notice) return null;
  const styles = notice.kind === 'error'
    ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
    : notice.kind === 'ok'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
  return (
    <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${styles}`}>
      <span>{notice.text}</span>
      <button type="button" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={15} /></button>
    </div>
  );
}

function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <header className="flex items-start gap-3">
      <button data-testid="toolkit-protect-back" type="button" onClick={onBack} aria-label={t('Volver')} className="mt-0.5 rounded-lg border border-neutral-200 p-2 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800">
        <Icon name="arrowLeft" size={18} />
      </button>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        <Icon name="shield" size={21} />
      </span>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h1>
        {subtitle && <p className="text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
      </div>
    </header>
  );
}

function PrimaryButton({ children, onClick, disabled, icon = 'chevronRight' }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; icon?: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50">
      {children}<Icon name={icon} size={16} />
    </button>
  );
}

function SecondaryButton({ children, onClick, disabled, icon }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; icon?: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800">
      {icon && <Icon name={icon} size={16} />}{children}
    </button>
  );
}

function ProtectHome({ onBack }: { onBack: () => void }) {
  const open = (mode: 'protect' | 'verify') => {
    protectSession.patch({ sourceMode: mode });
    protectSession.resetDocument(getActiveLang(), t('Válido únicamente a efectos de identificación en el trámite indicado. No constituye firma, autorización contractual ni consentimiento para usos distintos.'), 'source');
  };
  return (
    <div data-testid="protect-home" className="mx-auto max-w-5xl space-y-6">
      <Header title="Nodus Protect" subtitle={t('Oculta datos, añade marcas de agua y crea copias trazables sin enviar el documento fuera de tu equipo.')} onBack={onBack} />
      <div className="grid gap-4 sm:grid-cols-2">
        <button data-testid="protect-start-protect" type="button" onClick={() => open('protect')} className="rounded-xl border border-neutral-200 bg-white p-6 text-left hover:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-amber-600">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Icon name="shield" size={23} /></span>
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">{t('Proteger documentos')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500">{t('Combina PDF e imágenes, oculta información, recorta, endereza y añade una marca de uso y un pie legal.')}</p>
        </button>
        <button data-testid="protect-start-verify" type="button" onClick={() => open('verify')} className="rounded-xl border border-neutral-200 bg-white p-6 text-left hover:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-amber-600">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Icon name="search" size={23} /></span>
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">{t('Verificar una copia trazable')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500">{t('Busca la marca invisible IDPS v1 y separa el resultado autenticado de los metadatos declarados.')}</p>
        </button>
      </div>
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-relaxed text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-300">
        <Icon name="lock" size={16} className="mr-2 text-amber-600" />
        {t('El procesamiento de Nodus Protect es local. No envía tus documentos a IA, proveedores ni servicios externos.')}
      </div>
    </div>
  );
}

function SourcePicker() {
  const state = useProtectState();
  const [tab, setTab] = useState<'disk' | 'vault'>('disk');
  const [selected, setSelected] = useState<ProtectSourceSummary[]>(state.sources);
  const [vaultSources, setVaultSources] = useState<ProtectSourceSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingDelete, setPendingDelete] = useState<ProtectSourceSummary | null>(null);
  const multiple = state.sourceMode === 'protect';
  useEffect(() => { patch({ sources: selected }); }, [selected]);

  const loadVault = async () => {
    setLoading(true);
    try { setVaultSources(await window.nodus.listProtectVaultSources({ query, limit: 200 })); }
    catch (error) { setNotice({ kind: 'error', text: protectErrorText(error) }); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (tab === 'vault') void loadVault(); }, [tab]);

  const add = (items: ProtectSourceSummary[]) => {
    const available = items.filter((item) => item.available);
    setSelected((current) => multiple
      ? [...current, ...available.filter((item) => !current.some((existing) => JSON.stringify(existing.ref) === JSON.stringify(item.ref)))]
      : available.slice(0, 1));
  };
  const pickDisk = async () => {
    setLoading(true); setNotice(null);
    try { add(await window.nodus.pickProtectFiles(multiple)); }
    catch (error) { setNotice({ kind: 'error', text: protectErrorText(error) }); }
    finally { setLoading(false); }
  };
  const drop = async (event: React.DragEvent) => {
    event.preventDefault();
    const files = [...event.dataTransfer.files];
    setLoading(true);
    try { add(await window.nodus.registerProtectDroppedFiles(multiple ? files : files.slice(0, 1))); }
    catch (error) { setNotice({ kind: 'error', text: protectErrorText(error) }); }
    finally { setLoading(false); }
  };
  const proceed = async () => {
    if (!selected.length) return;
    setLoading(true); setNotice(null);
    try {
      patch({ sources: selected, verifySource: multiple ? null : selected[0] });
      const payloads = await Promise.all(selected.map((item) => window.nodus.readProtectSource(item.ref)));
      if (!multiple) {
        verifyPayloadCache = payloads[0];
        patch({ screen: 'verify' });
      } else {
        const loaded = await loadProtectPages(payloads);
        patch({ pages: loaded.pages, baseName: loaded.baseName, hasPdf: loaded.hasPdf, format: loaded.hasPdf ? 'pdf' : 'image', currentPage: 0, screen: 'redact' });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: `${protectErrorText(error)} ${t('Puedes retirar ese archivo y continuar con los demás.')}` });
    } finally { setLoading(false); }
  };
  const downloadCopy = async (item: ProtectSourceSummary) => {
    if (item.ref.kind !== 'protect-copy') return;
    setLoading(true); setNotice(null);
    try {
      const saved = await window.nodus.downloadProtectCopy(item.ref.copyId);
      if (!saved.canceled) setNotice({ kind: 'ok', text: t('Copia guardada en disco.') });
    } catch (error) { setNotice({ kind: 'error', text: protectErrorText(error) }); }
    finally { setLoading(false); }
  };
  const deleteCopy = async () => {
    if (pendingDelete?.ref.kind !== 'protect-copy') return;
    const ref = pendingDelete.ref;
    setLoading(true); setNotice(null);
    try {
      await window.nodus.deleteProtectCopy(ref.copyId);
      setVaultSources((items) => items.filter((item) => !(item.ref.kind === 'protect-copy' && item.ref.copyId === ref.copyId)));
      setSelected((items) => items.filter((item) => !(item.ref.kind === 'protect-copy' && item.ref.copyId === ref.copyId)));
      setNotice({ kind: 'ok', text: t('Copia protegida eliminada.') });
    } catch (error) { setNotice({ kind: 'error', text: protectErrorText(error) }); }
    finally { setPendingDelete(null); setLoading(false); }
  };

  return (
    <div data-testid="protect-source" className="mx-auto max-w-6xl space-y-5">
      <Header title={multiple ? t('Selecciona los documentos') : t('Selecciona la copia que quieres verificar')} subtitle={multiple ? t('Los archivos se concatenarán en el orden mostrado.') : t('Puedes usar un archivo del disco o de la bóveda activa.')} onBack={() => patch({ screen: 'home' })} />
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      <div className="flex gap-2 border-b border-neutral-200 dark:border-neutral-800">
        {(['disk', 'vault'] as const).map((value) => <button data-testid={`protect-source-tab-${value}`} key={value} type="button" onClick={() => setTab(value)} className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === value ? 'border-amber-500 text-amber-700 dark:text-amber-300' : 'border-transparent text-neutral-500'}`}>{value === 'disk' ? t('Disco') : t('Esta bóveda')}</button>)}
      </div>
      {tab === 'disk' ? (
        <button type="button" onClick={pickDisk} onDragOver={(event) => event.preventDefault()} onDrop={drop} className="flex min-h-44 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-8 text-neutral-600 hover:border-amber-400 dark:border-neutral-700 dark:bg-neutral-900/30 dark:text-neutral-300">
          <Icon name="upload" size={28} className="text-amber-600" />
          <span className="font-medium">{multiple ? t('Selecciona o arrastra PDF e imágenes') : t('Selecciona o arrastra una copia')}</span>
          <span className="text-xs text-neutral-500">PDF, PNG, JPEG, GIF, WebP, BMP, HEIC, HEIF</span>
        </button>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadVault(); }} placeholder={t('Buscar en esta bóveda…')} className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" /><SecondaryButton onClick={loadVault} icon="search">{t('Buscar')}</SecondaryButton></div>
          {loading ? <Spinner label={t('Cargando fuentes…')} /> : vaultSources.length ? (
            <div className="max-h-72 divide-y divide-neutral-200 overflow-y-auto rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {vaultSources.map((item) => <div key={JSON.stringify(item.ref)} className="flex items-center gap-1 p-1 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                <button type="button" disabled={!item.available} onClick={() => add([item])} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left disabled:cursor-not-allowed disabled:opacity-50">
                  <Icon name={item.ref.kind === 'protect-copy' ? 'shield' : 'file'} size={18} className="text-amber-600" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{item.name}</span><span className="block truncate text-xs text-neutral-500">{t(item.originLabel)} · {item.title} · {formatBytes(item.bytes)}</span>{!item.available && item.unavailableReason && <span className="block text-xs text-amber-700">{t(item.unavailableReason)}</span>}</span>
                  <Icon name="plus" size={16} />
                </button>
                {item.ref.kind === 'protect-copy' && <>
                  <button type="button" title={t('Descargar')} aria-label={t('Descargar')} onClick={() => void downloadCopy(item)} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-200 hover:text-amber-700 dark:hover:bg-neutral-800"><Icon name="download" size={16} /></button>
                  <button type="button" title={t('Eliminar')} aria-label={t('Eliminar')} onClick={() => setPendingDelete(item)} className="rounded-lg p-2 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"><Icon name="trash" size={16} /></button>
                </>}
              </div>)}
            </div>
          ) : <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">{t('Esta bóveda no contiene fuentes compatibles disponibles localmente.')}</div>}
        </div>
      )}
      {selected.length > 0 && <div className="space-y-2 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{multiple ? t('Orden de páginas') : t('Archivo seleccionado')}</h2>
        {selected.map((item, index) => <div key={`${JSON.stringify(item.ref)}-${index}`} className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-900">
          <span className="w-6 text-center text-xs font-semibold text-neutral-400">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
          {multiple && index > 0 && <button type="button" title={t('Subir')} onClick={() => setSelected((list) => { const next = [...list]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}><Icon name="arrowUp" size={15} /></button>}
          <button type="button" title={t('Quitar')} onClick={() => setSelected((list) => list.filter((_, itemIndex) => itemIndex !== index))}><Icon name="x" size={15} /></button>
        </div>)}
      </div>}
      <div className="flex justify-end">{loading ? <Spinner label={t('Preparando documento…')} /> : <span data-testid="protect-source-continue"><PrimaryButton disabled={!selected.length} onClick={proceed}>{multiple ? t('Editar y ocultar datos') : t('Verificar copia')}</PrimaryButton></span>}</div>
      {pendingDelete && <ConfirmModal title={t('Eliminar')} message={tx('Se eliminará «{title}». Esta acción no se puede deshacer.', { title: pendingDelete.name })} confirmLabel={t('Eliminar')} danger onConfirm={() => void deleteCopy()} onCancel={() => setPendingDelete(null)} />}
    </div>
  );
}

const TOOL_LABELS: Record<ProtectEditorTool, string> = { brush: 'Barra negra', blur: 'Desenfoque', select: 'Seleccionar', pan: 'Mover vista', crop: 'Recortar' };

function RedactionEditor() {
  const state = useProtectState();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<ProtectEditor | null>(null);
  const [tool, setTool] = useState<ProtectEditorTool>('brush');
  const [brush, setBrush] = useState(34);
  const [blurArea, setBlurArea] = useState(52);
  const [blurIntensity, setBlurIntensity] = useState(8);
  const [selected, setSelected] = useState<ProtectRect | null>(null);
  const [crop, setCrop] = useState<ProtectCrop | null>(null);
  const [version, setVersion] = useState(0);
  const [pageLoading, setPageLoading] = useState(false);
  const page = state.pages[state.currentPage];

  useEffect(() => {
    if (!host.current) return;
    const instance = new ProtectEditor(host.current);
    instance.onChange = () => { setVersion((value) => value + 1); protectSession.patch({ pages: [...protectSession.get().pages] }); };
    instance.onSelectionChange = setSelected;
    instance.onCropChange = setCrop;
    editor.current = instance;
    instance.setTool(tool); instance.setBrush(brush); instance.setBlurThickness(blurArea); instance.setBlurIntensity(blurIntensity); instance.setGrayscale(state.grayscale); instance.setPage(page);
    return () => { instance.destroy(); editor.current = null; };
  }, []);
  useEffect(() => {
    let canceled = false;
    if (!page) return undefined;
    setPageLoading(true);
    void ensureProtectPage(page).then(() => {
      if (!canceled) { editor.current?.setPage(page); setVersion((value) => value + 1); }
    }).finally(() => { if (!canceled) setPageLoading(false); });
    return () => { canceled = true; };
  }, [state.currentPage, page]);
  useEffect(() => { editor.current?.setGrayscale(state.grayscale); }, [state.grayscale]);
  useEffect(() => { editor.current?.setTool(tool); }, [tool]);
  useEffect(() => { editor.current?.setBrush(brush); }, [brush]);
  useEffect(() => { editor.current?.setBlurThickness(blurArea); }, [blurArea]);
  useEffect(() => { editor.current?.setBlurIntensity(blurIntensity); }, [blurIntensity]);

  const currentHasMarks = Boolean(page?.rects.length);
  const totalMarks = useMemo(() => state.pages.reduce((sum, item) => sum + item.rects.length, 0), [state.pages, version]);
  const navigate = async (next: number) => {
    const target = Math.max(0, Math.min(state.pages.length - 1, next));
    setPageLoading(true);
    try {
      await ensureProtectPage(state.pages[target]);
      patch({ currentPage: target });
    } finally { setPageLoading(false); }
  };
  const copyAll = async () => {
    if (!selected || !page) return;
    setPageLoading(true);
    try {
      for (let index = 0; index < state.pages.length; index += 1) {
        if (index === state.currentPage) continue;
        const target = state.pages[index];
        await ensureProtectPage(target);
        await ensureProtectPage(page);
        const rect = cloneRedactionForPage(selected, page, target);
        target.rects.push(rect); target.undo.push({ type: 'add', index: target.rects.length - 1 });
      }
      patch({ pages: [...state.pages] }); setVersion((value) => value + 1);
    } finally { setPageLoading(false); }
  };
  const rotate = (direction: number) => { editor.current?.rotatePage(direction); setVersion((value) => value + 1); };
  const straighten = Number(page?.straighten ?? 0);

  return (
    <div data-testid="protect-redact" className="mx-auto max-w-[1500px] space-y-4">
      <Header title={t('Oculta y ajusta el documento')} subtitle={tx('Página {current} de {total}', { current: state.currentPage + 1, total: state.pages.length })} onBack={() => patch({ screen: 'source' })} />
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
          <div className="grid grid-cols-2 gap-2">{(Object.keys(TOOL_LABELS) as ProtectEditorTool[]).map((value) => <button key={value} type="button" onClick={() => setTool(value)} className={`rounded-lg border px-2 py-2 text-xs font-medium ${tool === value ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'border-neutral-200 dark:border-neutral-700'}`}>{t(TOOL_LABELS[value])}</button>)}</div>
          {tool === 'brush' && <label className="block text-xs font-medium">{t('Grosor de barra')}<select value={brush} onChange={(event) => setBrush(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2 py-2 dark:border-neutral-700 dark:bg-neutral-900">{[10, 20, 34, 52, 74].map((value) => <option key={value} value={value}>{value} px</option>)}</select></label>}
          {tool === 'blur' && <div className="space-y-3"><Range label={t('Área')} value={blurArea} min={16} max={160} step={1} onChange={setBlurArea} suffix=" px" /><Range label={t('Intensidad')} value={blurIntensity} min={2} max={30} step={1} onChange={setBlurIntensity} suffix=" px" /></div>}
          {tool === 'select' && <div className="space-y-2"><SecondaryButton onClick={() => editor.current?.deleteSelected()} disabled={!selected} icon="trash">{t('Eliminar selección')}</SecondaryButton><SecondaryButton onClick={() => void copyAll()} disabled={!selected || state.pages.length < 2 || pageLoading} icon="copy">{t('Copiar a todas las páginas')}</SecondaryButton></div>}
          {tool === 'crop' && <div className="space-y-2"><SecondaryButton onClick={() => editor.current?.applyCrop()} disabled={!crop} icon="check">{t('Aplicar recorte')}</SecondaryButton><SecondaryButton onClick={() => editor.current?.clearCrop()} disabled={!crop} icon="x">{t('Borrar recorte')}</SecondaryButton><p className="text-xs text-neutral-500">{t('El recorte mínimo es de 24 × 24 px y vacía el historial de esta página.')}</p></div>}
          <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Transformar página')}</p><div className="flex flex-wrap gap-2"><SecondaryButton onClick={() => rotate(-1)} icon="rotateCcw">{t('Izquierda')}</SecondaryButton><SecondaryButton onClick={() => rotate(1)} icon="rotateCw">{t('Derecha')}</SecondaryButton></div><Range label={t('Enderezar')} value={straighten} min={-10} max={10} step={0.5} onChange={(value) => editor.current?.setStraightenPreview(value)} suffix="°" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={state.grayscale} onChange={(event) => patch({ grayscale: event.target.checked })} className="accent-amber-600" />{t('Escala de grises')}</label>
          <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800"><SecondaryButton onClick={() => editor.current?.undo()} disabled={!page?.undo.length} icon="undo">{t('Deshacer')}</SecondaryButton><SecondaryButton onClick={() => editor.current?.zoomButton(1.25)} icon="plus">{t('Zoom')}</SecondaryButton><SecondaryButton onClick={() => editor.current?.zoomButton(0.8)} icon="minus">{t('Alejar')}</SecondaryButton><SecondaryButton onClick={() => editor.current?.resetView()} icon="fit">{t('Ajustar')}</SecondaryButton></div>
        </aside>
        <main className="min-w-0 space-y-3"><div className="relative"><div data-testid="protect-editor-host" ref={host} className="flex min-h-[380px] items-center justify-center overflow-hidden rounded-xl bg-neutral-200 p-3 dark:bg-neutral-950" />{pageLoading && <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70 dark:bg-neutral-950/70"><Spinner label={t('Preparando documento…')} /></div>}</div><div className="flex items-center justify-center gap-3"><SecondaryButton disabled={state.currentPage === 0 || pageLoading} onClick={() => void navigate(state.currentPage - 1)} icon="chevronLeft">{t('Anterior')}</SecondaryButton><span className="text-sm text-neutral-500">{state.currentPage + 1} / {state.pages.length}</span><SecondaryButton disabled={state.currentPage === state.pages.length - 1 || pageLoading} onClick={() => void navigate(state.currentPage + 1)}>{t('Siguiente')}</SecondaryButton></div></main>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40"><p className="text-sm text-neutral-600 dark:text-neutral-300">{totalMarks ? tx('{count} ocultaciones o desenfoques añadidos. Revisa todas las páginas antes de continuar.', { count: totalMarks }) : t('No has añadido ocultaciones. Puedes continuar para usar solo marca de agua y pie legal.')}</p><span data-testid="protect-redact-continue"><PrimaryButton onClick={() => { editor.current?.bakeStraighten(); patch({ watermarkPage: 0, screen: 'watermark' }); }}>{currentHasMarks || totalMarks ? t('Continuar con marca y pie legal') : t('Continuar sin ocultaciones')}</PrimaryButton></span></div>
    </div>
  );
}

function Range({ label, value, min, max, step, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="block text-xs font-medium"><span className="flex justify-between"><span>{label}</span><span>{value}{suffix}</span></span><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full accent-amber-600" /></label>;
}

function PreviewCanvas({ state, pageIndex, interactiveManual = false }: { state: ProtectSessionState; pageIndex: number; interactiveManual?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef(false);
  useEffect(() => {
    const output = ref.current;
    const page = state.pages[pageIndex];
    if (!output || !page) return;
    let canceled = false;
    void ensureProtectPage(page).then(() => {
      if (canceled) return;
      const built = composeProtectPage(page, state.watermark, state.footer, state.grayscale, 900, pageIndex, copy());
      output.width = built.width; output.height = built.height;
      output.getContext('2d')?.drawImage(built, 0, 0);
    });
    return () => { canceled = true; };
  }, [state.pages, state.watermark, state.footer, state.grayscale, pageIndex, state.manualSelected]);
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || !interactiveManual || state.watermark.pattern !== 'manual') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(0.97, Math.max(0.03, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(0.97, Math.max(0.03, (event.clientY - bounds.top) / bounds.height));
    const watermark = structuredClone(state.watermark);
    Object.assign(watermark.manual.items[state.manualSelected], { x, y });
    patch({ watermark });
  };
  return <canvas ref={ref} onPointerDown={(event) => { if (interactiveManual) { drag.current = true; event.currentTarget.setPointerCapture(event.pointerId); move(event); } }} onPointerMove={move} onPointerUp={() => { drag.current = false; }} className={`max-h-[620px] max-w-full rounded-lg bg-white shadow-lg ${interactiveManual && state.watermark.pattern === 'manual' ? 'cursor-move touch-none' : ''}`} />;
}

function WatermarkStep() {
  const state = useProtectState();
  const wm = state.watermark;
  const language = getActiveLang();
  const update = (value: Partial<ProtectWatermark>) => patch({ watermark: { ...wm, ...value } });
  const selectedManual = wm.manual.items[state.manualSelected] ?? wm.manual.items[0];
  const updateManual = (value: Partial<typeof selectedManual>) => {
    const items = wm.manual.items.map((item, index) => index === state.manualSelected ? { ...item, ...value } : item);
    update({ manual: { ...wm.manual, items } });
  };
  const updateFooter = (value: Partial<typeof state.footer>) => patch({ footer: { ...state.footer, ...value } });
  useEffect(() => {
    const next: Partial<typeof state.footer> = {};
    if (!state.footer.messageCustom) next.message = t('Válido únicamente a efectos de identificación en el trámite indicado. No constituye firma, autorización contractual ni consentimiento para usos distintos.');
    if (!state.footer.nationalCountryCustom) next.nationalCountry = defaultProtectAuthority(language);
    if (Object.keys(next).some((key) => state.footer[key as keyof typeof state.footer] !== next[key as keyof typeof next])) updateFooter(next);
  }, [language, state.footer.messageCustom, state.footer.nationalCountryCustom]);
  const footerEnabled = (state.footer.messageEnabled && Boolean(state.footer.message.trim()))
    || state.footer.euLink || state.footer.nationalLink
    || (state.footer.contactEmailEnabled && Boolean(state.footer.contactEmail.trim()))
    || (state.footer.phoneEnabled && Boolean(state.footer.phone.trim()));
  return (
    <div data-testid="protect-watermark" className="mx-auto max-w-[1500px] space-y-4">
      <Header title={t('Marca de agua y pie legal')} subtitle={t('La previsualización usa el mismo compositor que la exportación.')} onBack={() => patch({ screen: 'redact' })} />
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="max-h-[calc(100vh-190px)] space-y-4 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
          <label className="flex items-center justify-between gap-3 text-sm font-semibold"><span>{t('Marca de agua')}</span><input type="checkbox" checked={wm.enabled} onChange={(event) => update({ enabled: event.target.checked })} className="accent-amber-600" /></label>
          <label className="block text-xs font-medium">{t('Uso o destinatario')}<input maxLength={100} value={wm.text} onChange={(event) => update({ text: event.target.value })} placeholder={t('Ej.: Solo para alta en…')} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" /><span className="mt-1 block text-right text-neutral-400">{wm.text.length}/100</span></label>
          <div><p className="mb-2 text-xs font-medium">{t('Patrón')}</p><div className="grid grid-cols-2 gap-2">{PROTECT_PATTERNS.map((pattern) => <button type="button" key={pattern.id} onClick={() => update({ pattern: pattern.id })} className={`rounded-lg border p-2 text-xs ${wm.pattern === pattern.id ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40' : 'border-neutral-200 dark:border-neutral-700'}`}>{t(pattern.label)}</button>)}</div></div>
          <Range label={t('Opacidad')} value={Math.round(wm.opacity * 100)} min={4} max={80} step={1} suffix=" %" onChange={(value) => update({ opacity: value / 100 })} />
          <Range label={t('Tamaño')} value={wm.size} min={10} max={60} step={1} suffix=" px" onChange={(value) => update({ size: value })} />
          <div><p className="mb-2 text-xs font-medium">{t('Color')}</p><div className="flex flex-wrap gap-2">{PROTECT_SWATCHES.map((color) => <button key={color} type="button" aria-label={color} onClick={() => update({ color })} className={`h-7 w-7 rounded-full border-2 ${wm.color === color ? 'border-amber-500 ring-2 ring-amber-200' : 'border-neutral-300'}`} style={{ backgroundColor: color }} />)}<input type="color" value={wm.color} onChange={(event) => update({ color: event.target.value })} className="h-7 w-9" /></div></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wm.footer} onChange={(event) => update({ footer: event.target.checked })} className="accent-amber-600" />{t('Firma “Protegido con Nodus Protect”')}</label>
          {wm.pattern === 'manual' && selectedManual && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20"><div className="flex flex-wrap gap-2">{wm.manual.items.map((_, index) => <button key={index} type="button" onClick={() => patch({ manualSelected: index })} className={`rounded px-2 py-1 text-xs ${index === state.manualSelected ? 'bg-amber-600 text-white' : 'bg-white dark:bg-neutral-900'}`}>{index + 1}</button>)}</div><label className="block text-xs">{t('Texto de esta marca')}<input maxLength={100} value={selectedManual.text} onChange={(event) => updateManual({ text: event.target.value })} className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900" /></label><Range label={t('Ángulo')} value={selectedManual.angle} min={-45} max={45} step={1} suffix="°" onChange={(value) => updateManual({ angle: value })} /><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={wm.manual.randomizePerPage} onChange={(event) => update({ manual: { ...wm.manual, randomizePerPage: event.target.checked } })} />{t('Variar la posición de forma determinista por página')}</label><div className="flex flex-wrap gap-2"><SecondaryButton onClick={() => updateManual({ x: 0.5, y: 0.82, angle: 0 })} icon="refresh">{t('Restablecer')}</SecondaryButton><SecondaryButton onClick={() => { const items = [...wm.manual.items, { text: '', x: 0.5, y: 0.5, angle: 0 }]; update({ manual: { ...wm.manual, items } }); patch({ manualSelected: items.length - 1 }); }} icon="plus">{t('Añadir')}</SecondaryButton><SecondaryButton disabled={wm.manual.items.length === 1} onClick={() => { const items = wm.manual.items.filter((_, index) => index !== state.manualSelected); update({ manual: { ...wm.manual, items } }); patch({ manualSelected: Math.max(0, state.manualSelected - 1) }); }} icon="trash">{t('Eliminar')}</SecondaryButton></div><p className="text-xs text-neutral-500">{t('También puedes arrastrar la marca seleccionada sobre la previsualización.')}</p></div>}
          <details className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800" open><summary className="cursor-pointer text-sm font-semibold">{t('Pie legal')}</summary><div className="mt-3 space-y-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={state.footer.euLink} onChange={(event) => updateFooter({ euLink: event.target.checked })} />{t('Enlace localizado al RGPD')}</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={state.footer.nationalLink} onChange={(event) => updateFooter({ nationalLink: event.target.checked })} />{t('Autoridad nacional')}</label>{state.footer.nationalLink && <select value={state.footer.nationalCountry} onChange={(event) => updateFooter({ nationalCountry: event.target.value, nationalCountryCustom: true })} className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">{PROTECT_AUTHORITIES.map((authority) => <option key={authority.code} value={authority.code}>{authority.country} · {authority.name}</option>)}</select>}<OptionalField checked={state.footer.contactEmailEnabled} label={t('Correo')} value={state.footer.contactEmail} type="email" onChecked={(checked) => updateFooter({ contactEmailEnabled: checked })} onChange={(value) => updateFooter({ contactEmail: value })} /><OptionalField checked={state.footer.phoneEnabled} label={t('Teléfono')} value={state.footer.phone} type="tel" onChecked={(checked) => updateFooter({ phoneEnabled: checked })} onChange={(value) => updateFooter({ phone: value })} /><label className="block text-xs"><span className="flex items-center gap-2"><input type="checkbox" checked={state.footer.messageEnabled} onChange={(event) => updateFooter({ messageEnabled: event.target.checked })} />{t('Mensaje legal')}</span>{state.footer.messageEnabled && <textarea maxLength={260} rows={4} value={state.footer.message} onChange={(event) => updateFooter({ message: event.target.value, messageCustom: true })} className="mt-2 w-full rounded-lg border border-neutral-300 bg-white p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900" />}<span className="block text-right text-neutral-400">{state.footer.message.length}/260</span></label></div></details>
        </aside>
        <main className="flex min-w-0 flex-col items-center gap-3 rounded-xl bg-neutral-200 p-4 dark:bg-neutral-950"><PreviewCanvas state={state} pageIndex={state.watermarkPage} interactiveManual /><div className="flex items-center gap-3"><SecondaryButton disabled={state.watermarkPage === 0} onClick={() => patch({ watermarkPage: state.watermarkPage - 1 })} icon="chevronLeft">{t('Anterior')}</SecondaryButton><span className="text-sm text-neutral-500">{state.watermarkPage + 1} / {state.pages.length}</span><SecondaryButton disabled={state.watermarkPage === state.pages.length - 1} onClick={() => patch({ watermarkPage: state.watermarkPage + 1 })}>{t('Siguiente')}</SecondaryButton></div></main>
      </div>
      <div className="flex justify-end"><span data-testid="protect-watermark-continue"><PrimaryButton onClick={() => patch({ resultPage: 0, screen: 'result' })}>{!wm.enabled && !footerEnabled ? t('Continuar sin marca ni pie') : t('Revisar y exportar')}</PrimaryButton></span></div>
    </div>
  );
}

function OptionalField({ checked, label, value, type, onChecked, onChange }: { checked: boolean; label: string; value: string; type: string; onChecked: (checked: boolean) => void; onChange: (value: string) => void }) {
  return <label className="block text-xs"><span className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(event) => onChecked(event.target.checked)} />{label}</span>{checked && <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2 py-2 dark:border-neutral-700 dark:bg-neutral-900" />}</label>;
}

function ResultStep() {
  const state = useProtectState();
  const [busy, setBusy] = useState<Destination | 'csv' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const makeArtifact = async () => {
    const result = await buildProtectArtifact({ pages: state.pages, watermark: state.watermark, footer: state.footer, grayscale: state.grayscale, format: state.format, baseName: state.baseName, protectedSuffix: SUFFIX[getActiveLang()], pagePrefix: t('pagina'), trace: state.trace, copy: copy(), appVersion: __APP_VERSION__, sourceLabel: state.sources.map((source) => source.name).join(', ') });
    const kinds = new Set(state.sources.map((source) => source.ref.kind));
    result.artifact.sourceKind = kinds.size === 1 ? state.sources[0]?.ref.kind : 'mixed';
    return result;
  };
  const complete = (issued: ProtectIssuedCopy | null) => { if (issued) protectSession.addIssued(issued); };
  const act = async (destination: Destination) => {
    setBusy(destination); setNotice(null);
    try {
      const built = await makeArtifact();
      if (destination === 'disk') {
        const saved = await window.nodus.saveProtectArtifactToDisk(built.artifact);
        if (saved.canceled) return;
      } else if (destination === 'vault') {
        await window.nodus.saveProtectArtifactToVault(built.artifact);
      } else {
        const shared = await window.nodus.shareProtectArtifact(built.artifact);
        if (shared.canceled || !shared.shared) return;
      }
      complete(built.issued);
      setNotice({ kind: 'ok', text: destination === 'vault' ? t('Copia guardada en esta bóveda.') : destination === 'share' ? t('Copia preparada para compartir.') : t('Copia guardada en disco.') });
    } catch (error) { setNotice({ kind: 'error', text: protectErrorText(error) }); }
    finally { setBusy(null); }
  };
  const exportCsv = async () => {
    setBusy('csv');
    try {
      const artifact: ProtectArtifact = { fileName: 'nodus-protect-registro.csv', mimeType: 'text/csv', format: 'csv', pageCount: 0, bytes: issuedCopiesCsv(state.issuedCopies) };
      const saved = await window.nodus.saveProtectArtifactToDisk(artifact);
      if (!saved.canceled) setNotice({ kind: 'ok', text: t('Registro CSV guardado.') });
    } catch (error) { setNotice({ kind: 'error', text: protectErrorText(error) }); }
    finally { setBusy(null); }
  };
  return (
    <div data-testid="protect-result" className="mx-auto max-w-[1450px] space-y-4">
      <Header title={t('Revisa y guarda la copia')} subtitle={t('Cada acción completada genera una copia independiente y un identificador distinto si la trazabilidad está activa.')} onBack={() => patch({ screen: 'watermark' })} />
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="flex min-w-0 flex-col items-center gap-3 rounded-xl bg-neutral-200 p-4 dark:bg-neutral-950"><PreviewCanvas state={state} pageIndex={state.resultPage} /><div className="flex items-center gap-3"><SecondaryButton disabled={state.resultPage === 0} onClick={() => patch({ resultPage: state.resultPage - 1 })} icon="chevronLeft">{t('Anterior')}</SecondaryButton><span className="text-sm text-neutral-500">{state.resultPage + 1} / {state.pages.length}</span><SecondaryButton disabled={state.resultPage === state.pages.length - 1} onClick={() => patch({ resultPage: state.resultPage + 1 })}>{t('Siguiente')}</SecondaryButton></div></main>
        <aside className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
          <div><p className="mb-2 text-sm font-semibold">{t('Formato')}</p><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => patch({ format: 'image' })} className={`rounded-lg border p-3 text-sm ${state.format === 'image' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30' : 'border-neutral-200 dark:border-neutral-700'}`}>{state.pages.length === 1 ? 'PNG' : 'ZIP · PNG'}</button><button type="button" onClick={() => patch({ format: 'pdf' })} className={`rounded-lg border p-3 text-sm ${state.format === 'pdf' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30' : 'border-neutral-200 dark:border-neutral-700'}`}>PDF</button></div></div>
          <div className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"><label className="flex items-center justify-between gap-2 text-sm font-semibold"><span>{t('Copia trazable IDPS v1')}</span><input data-testid="protect-trace-toggle" type="checkbox" checked={state.trace.enabled} onChange={(event) => patch({ trace: { ...state.trace, enabled: event.target.checked } })} className="accent-amber-600" /></label>{state.trace.enabled && <><label className="block text-xs">{t('Destinatario o propósito')}<input data-testid="protect-trace-label" maxLength={120} value={state.trace.label} onChange={(event) => patch({ trace: { ...state.trace, label: event.target.value } })} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2 py-2 dark:border-neutral-700 dark:bg-neutral-900" /><span className="block text-right text-neutral-400">{state.trace.label.length}/120</span></label><label className="block text-xs">{t('Frase secreta opcional')}<input type="password" value={state.trace.passphrase} onChange={(event) => patch({ trace: { ...state.trace, passphrase: event.target.value } })} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2 py-2 dark:border-neutral-700 dark:bg-neutral-900" /></label></>}<p className="text-xs leading-relaxed text-neutral-500">{t('La marca invisible autentica una copia, pero no la cifra. JPEG, capturas, reescalado o recompresión pueden destruirla.')}</p></div>
          {busy ? <Spinner label={t('Generando copia…')} /> : <div className="grid gap-2"><PrimaryButton onClick={() => void act('disk')} icon="download">{t('Guardar como…')}</PrimaryButton><span data-testid="protect-save-vault"><SecondaryButton onClick={() => void act('vault')} icon="archive">{t('Guardar en esta bóveda')}</SecondaryButton></span><SecondaryButton onClick={() => void act('share')} icon="share">{t('Compartir')}</SecondaryButton></div>}
        </aside>
      </div>
      {state.issuedCopies.length > 0 && <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40"><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">{t('Registro de copias emitidas')}</h2><p className="text-xs text-neutral-500">{t('Solo vive en memoria y se elimina al cerrar Nodus. Nunca guarda frases secretas.')}</p></div><SecondaryButton disabled={busy === 'csv'} onClick={() => void exportCsv()} icon="download">CSV</SecondaryButton></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-neutral-500"><tr><th className="py-2">copyId</th><th>{t('Etiqueta')}</th><th>{t('Modo')}</th><th>{t('Archivo')}</th><th>{t('Fecha')}</th></tr></thead><tbody>{state.issuedCopies.map((item) => <tr key={`${item.copyId}-${item.created}`} className="border-t border-neutral-200 dark:border-neutral-800"><td className="py-2 font-mono">{item.copyId}</td><td>{item.label || '—'}</td><td>{item.keyed === 'open' ? t('Abierto') : t('Con frase')}</td><td>{item.fileName}</td><td>{new Date(item.created).toLocaleString()}</td></tr>)}</tbody></table></div></div>}
      <div className="flex flex-wrap justify-between gap-3"><SecondaryButton onClick={() => patch({ screen: 'home' })}>{t('Volver a Nodus Protect')}</SecondaryButton><PrimaryButton onClick={() => protectSession.resetDocument(getActiveLang(), t('Válido únicamente a efectos de identificación en el trámite indicado. No constituye firma, autorización contractual ni consentimiento para usos distintos.'), 'source')} icon="refresh">{t('Proteger más documentos')}</PrimaryButton></div>
    </div>
  );
}

function VerifyStep() {
  const state = useProtectState();
  const [passphrase, setPassphrase] = useState('');
  const [result, setResult] = useState<ProtectVerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const verify = async () => {
    if (!verifyPayloadCache) { setNotice({ kind: 'error', text: t('Vuelve a seleccionar el archivo.') }); return; }
    setBusy(true); setNotice(null);
    try { setResult(await verifyProtectFile(verifyPayloadCache, passphrase)); }
    catch (error) { setNotice({ kind: 'error', text: protectErrorText(error) }); }
    finally { setBusy(false); }
  };
  const pixel = result?.pixel;
  const sessionMatch = pixel?.found ? state.issuedCopies.find((item) => item.copyId.toLowerCase() === pixel.copyIdHex.toLowerCase()) : null;
  const status = !result ? null : pixel?.found && pixel.verified ? 'verified' : pixel?.found ? 'unverified' : 'none';
  return (
    <div data-testid="protect-verify" className="mx-auto max-w-4xl space-y-5">
      <Header title={t('Verificar una copia trazable')} subtitle={state.verifySource?.name} onBack={() => patch({ screen: 'source' })} />
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/40"><label className="block text-sm font-medium">{t('Frase secreta, si se utilizó')}<div className="mt-2 flex gap-2"><input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void verify(); }} className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900" /><span data-testid="protect-verify-action"><PrimaryButton disabled={busy} onClick={() => void verify()} icon="search">{result ? t('Reintentar') : t('Verificar')}</PrimaryButton></span></div></label>{busy && <div className="mt-3"><Spinner label={t('Comprobando todas las páginas…')} /></div>}</div>
      {result && <div className="space-y-4"><div className={`rounded-xl border p-5 ${status === 'verified' ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30' : status === 'unverified' ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30' : 'border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900/30'}`}><div className="flex items-center gap-3"><Icon name={status === 'verified' ? 'check' : status === 'unverified' ? 'alert' : 'search'} size={24} /><div><h2 className="font-semibold">{status === 'verified' ? t('Marca verificada') : status === 'unverified' ? t('Marca encontrada, pero no verificada') : t('No se detectó una marca')}</h2><p className="text-sm text-neutral-600 dark:text-neutral-300">{status === 'none' ? t('Esto no demuestra que el archivo no se protegiera: JPEG, capturas, reescalado o recompresión pueden haber destruido la marca.') : pixel?.verified ? t('La autenticación criptográfica IDPS v1 es válida.') : t('Prueba otra frase secreta si la copia se creó en modo protegido.')}</p></div></div></div>
        <div className="grid gap-4 md:grid-cols-2"><div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"><h3 className="mb-3 text-sm font-semibold">{t('Marca invisible en los píxeles')}</h3>{pixel?.found ? <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs"><dt>ID</dt><dd className="font-mono">{pixel.copyIdHex}</dd><dt>{t('Modo')}</dt><dd>{(pixel.flags & 1) !== 0 ? t('Con frase') : t('Abierto')}</dd><dt>{t('Concordancia')}</dt><dd>{Math.round(pixel.agreement * 100)} %</dd><dt>{t('Candidatos')}</dt><dd>{pixel.candidates}</dd><dt>{t('Página')}</dt><dd>{pixel.page ?? '—'}</dd><dt>{t('Registro de sesión')}</dt><dd>{sessionMatch ? `${t('Coincide')}: ${sessionMatch.label || sessionMatch.fileName}` : t('Sin coincidencia')}</dd></dl> : <p className="text-sm text-neutral-500">{pixel && 'unavailable' in pixel && pixel.unavailable ? t('Web Crypto no está disponible; no se puede autenticar la marca en este entorno.') : t('No se localizaron candidatos IDPS v1 en los píxeles.')}</p>}</div><div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"><h3 className="mb-3 text-sm font-semibold">{t('Metadatos declarados')}</h3>{result.metadata ? <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs"><dt>ID</dt><dd className="break-all font-mono">{result.metadata.copyId || '—'}</dd><dt>{t('Propósito')}</dt><dd>{result.metadata.purpose || '—'}</dd><dt>{t('Versión')}</dt><dd>{result.metadata.version}</dd></dl> : <p className="text-sm text-neutral-500">{t('No se encontraron metadatos de compatibilidad idprotector/idps1.')}</p>}</div></div>
        {result.fallback && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t('En al menos una página PDF no fue posible extraer el primer XObject de imagen exacto; se verificó una rasterización de reserva, que puede reducir la fiabilidad.')}</div>}
      </div>}
      <div className="flex justify-between"><SecondaryButton onClick={() => { verifyPayloadCache = null; setResult(null); patch({ screen: 'source', verifySource: null, sources: [] }); }} icon="refresh">{t('Verificar otro archivo')}</SecondaryButton><SecondaryButton onClick={() => patch({ screen: 'home' })}>{t('Volver a Nodus Protect')}</SecondaryButton></div>
    </div>
  );
}

export function ToolkitProtectView({ onBack }: { onBack: () => void }) {
  const state = useProtectState();
  const [vaultChangePending, setVaultChangePending] = useState(false);
  const [vaultRevision, setVaultRevision] = useState(0);
  useEffect(() => window.nodus.onVaultChanged(() => {
    const current = protectSession.get();
    const hasChanges = current.sources.length > 0 || current.pages.length > 0 || current.verifySource != null;
    verifyPayloadCache = null;
    patch({ sources: [], verifySource: null });
    setVaultRevision((value) => value + 1);
    if (hasChanges) setVaultChangePending(true);
  }), []);
  const content = state.screen === 'home' ? <ProtectHome onBack={onBack} />
    : state.screen === 'source' ? <SourcePicker />
      : state.screen === 'redact' ? <RedactionEditor />
        : state.screen === 'watermark' ? <WatermarkStep />
          : state.screen === 'result' ? <ResultStep /> : <VerifyStep />;
  return <><div key={vaultRevision}>{content}</div>{vaultChangePending && <ConfirmModal title="Nodus Protect" message={t('Has cambiado de bóveda. El flujo actual contiene cambios. ¿Quieres descartarlo?')} confirmLabel={t('Descartar')} danger onConfirm={() => { setVaultChangePending(false); protectSession.resetDocument(getActiveLang(), t('Válido únicamente a efectos de identificación en el trámite indicado. No constituye firma, autorización contractual ni consentimiento para usos distintos.'), 'source'); }} onCancel={() => setVaultChangePending(false)} />}</>;
}
