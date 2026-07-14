import { useEffect, useMemo, useState } from 'react';
import { diffWordsWithSpace } from 'diff';
import type {
  AppSettings,
  ModelRef,
  StudyImproveLength,
  StudyImproveLevel,
  StudyImproveMode,
  StudyImproveResult,
  StudyImproveScope,
  StudyStyle,
  StudyStyleInput,
  StudyStyleVersion,
} from '@shared/types';
import { estimateStudyTokens, renderStudyStylePrompt, validateStudyStylePrompt } from '@shared/studyImprove';
import { t } from '../../i18n';
import { ModelPicker } from '../ModelPicker';
import { Icon, Spinner } from '../ui';

type ApplyAction = 'replace' | 'insert_below';
type Tab = 'improve' | 'styles' | 'history';

const EMPTY_STYLE: StudyStyleInput = {
  name: '', prompt: 'Mejora el texto seleccionado manteniendo su significado.', icon: '✦', color: '#0f766e',
  description: '', category: 'custom', language: 'auto', level: 'moderate', length: 'similar', systemPrompt: '',
  temperature: 0.2, maxOutputTokens: 2400, creativity: 0.1, locked: false, favorite: false, active: true,
};

export function StudyImproveDialog({
  documentId,
  documentKind,
  subjectId,
  original,
  scope,
  initialStyleId,
  protectedTerms,
  onApply,
  onClose,
}: {
  documentId: string;
  documentKind: string;
  subjectId?: string | null;
  original: string;
  scope: StudyImproveScope;
  initialStyleId?: string;
  protectedTerms: string[];
  onApply: (text: string, action: ApplyAction, logId: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('improve');
  const [styles, setStyles] = useState<StudyStyle[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState(initialStyleId ?? 'builtin:academic');
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<StudyImproveLevel>('moderate');
  const [length, setLength] = useState<StudyImproveLength>('similar');
  const [mode, setMode] = useState<StudyImproveMode>('preserve');
  const [freeConfirmed, setFreeConfirmed] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [model, setModel] = useState<ModelRef | null>(null);
  const [streamed, setStreamed] = useState('');
  const [result, setResult] = useState<StudyImproveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [acceptedPieces, setAcceptedPieces] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<StudyStyle | 'new' | null>(null);
  const [styleDraft, setStyleDraft] = useState<StudyStyleInput>(EMPTY_STYLE);
  const [styleVersions, setStyleVersions] = useState<StudyStyleVersion[]>([]);
  const [sample, setSample] = useState('La evidencia indica 37 casos en 2024, según García (2023).');
  const [styleMessage, setStyleMessage] = useState('');
  const [logs, setLogs] = useState<Awaited<ReturnType<typeof window.nodus.listStudyImprovementLog>>>([]);

  const loadStyles = async () => {
    const next = await window.nodus.listStudyStyles({ includeArchived: tab === 'styles' });
    setStyles(next);
    if (!next.some((style) => style.id === selectedStyleId)) setSelectedStyleId(next[0]?.id ?? 'builtin:academic');
  };

  useEffect(() => {
    void Promise.all([
      window.nodus.getSettings(),
      window.nodus.resolveStudyStyleDefault(subjectId, documentKind),
      window.nodus.listStudyImprovementLog(documentId),
    ]).then(([nextSettings, defaultStyle, nextLogs]) => {
      setSettings(nextSettings);
      setModel(nextSettings.improveModel ?? nextSettings.synthesisModel);
      setSelectedStyleId(initialStyleId ?? defaultStyle);
      setLogs(nextLogs);
    });
    void loadStyles();
  }, [documentId]);

  const selectedStyle = styles.find((style) => style.id === selectedStyleId) ?? styles[0];
  useEffect(() => {
    if (!selectedStyle) return;
    setLevel(selectedStyle.level);
    setLength(selectedStyle.length);
  }, [selectedStyle?.id]);

  const filteredStyles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return styles.filter((style) => !query || `${style.name} ${style.description} ${style.category}`.toLocaleLowerCase().includes(query));
  }, [styles, search]);

  const diff = useMemo(() => result ? diffWordsWithSpace(original, result.text) : [], [original, result?.text]);
  useEffect(() => {
    setAcceptedPieces(new Set(diff.map((piece, index) => piece.added || piece.removed ? index : -1).filter((index) => index >= 0)));
  }, [result?.resultHash]);

  const composedResult = useMemo(() => diff.map((piece, index) => {
    if (!piece.added && !piece.removed) return piece.value;
    const accept = acceptedPieces.has(index);
    if (piece.added) return accept ? piece.value : '';
    return accept ? '' : piece.value;
  }).join(''), [diff, acceptedPieces]);

  const run = async () => {
    if (!selectedStyle || (mode === 'free' && !freeConfirmed)) return;
    setBusy(true); setError(''); setResult(null); setStreamed('');
    try {
      const next = await window.nodus.improveStudyText({
        documentId, text: original, styleId: selectedStyle.id, scope, level, length, mode,
        variables: { language: selectedStyle.language, documentType: documentKind, selectedText: original },
        protectedTerms, model,
      }, { onDelta: (delta) => setStreamed((value) => value + delta) });
      setResult(next);
      setLogs(await window.nodus.listStudyImprovementLog(documentId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    await window.nodus.cancelStudyImprove();
    setBusy(false);
  };

  const apply = async (action: ApplyAction) => {
    if (!result) return;
    await window.nodus.updateStudyImprovementAction(result.logId, action);
    onApply(composedResult, action, result.logId);
  };

  const beginEdit = async (style: StudyStyle | 'new') => {
    setEditing(style);
    setStyleMessage('');
    if (style === 'new') {
      setStyleDraft({ ...EMPTY_STYLE });
      setStyleVersions([]);
      return;
    }
    setStyleDraft({
      name: style.name, icon: style.icon, color: style.color, description: style.description, prompt: style.prompt,
      systemPrompt: style.systemPrompt, category: style.category, language: style.language, level: style.level,
      length: style.length, modelProvider: style.modelProvider, modelName: style.modelName, temperature: style.temperature,
      maxOutputTokens: style.maxOutputTokens, creativity: style.creativity, locked: style.locked,
      favorite: style.favorite, active: style.active, position: style.position,
    });
    setStyleVersions(style.builtIn ? [] : await window.nodus.listStudyStyleVersions(style.id));
  };

  const saveStyle = async () => {
    try {
      let saved: StudyStyle | null = null;
      if (editing === 'new') saved = await window.nodus.createStudyStyle(styleDraft);
      else if (editing?.builtIn) {
        const copy = await window.nodus.duplicateStudyStyle(editing.id);
        saved = await window.nodus.updateStudyStyle(copy.id, { ...styleDraft, locked: false });
      } else if (editing) saved = await window.nodus.updateStudyStyle(editing.id, styleDraft);
      if (!saved) return;
      setSelectedStyleId(saved.id);
      setEditing(null);
      setStyleMessage(t('Estilo guardado.'));
      await loadStyles();
    } catch (cause) {
      setStyleMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const promptWarnings = validateStudyStylePrompt(`${styleDraft.prompt}\n${styleDraft.systemPrompt ?? ''}`);
  const renderedSample = renderStudyStylePrompt(styleDraft.prompt, {
    academicLevel: 'universitario', language: styleDraft.language, documentType: documentKind,
    targetLength: styleDraft.length, selectedText: sample,
  });

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-4" data-testid="study-improve-dialog" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-teal-900/70 bg-neutral-950 shadow-2xl">
        <header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-950 text-teal-300"><Icon name="wand" /></span>
          <div className="min-w-0 flex-1"><h2 className="font-semibold text-neutral-100">{t('Mejorar texto')}</h2><p className="truncate text-xs text-neutral-500">{scope === 'document' ? t('Documento completo') : `${original.length.toLocaleString()} ${t('caracteres seleccionados')}`}</p></div>
          {(['improve', 'styles', 'history'] as Tab[]).map((item) => <button key={item} className={`rounded-lg px-3 py-1.5 text-xs ${tab === item ? 'bg-teal-950 text-teal-300' : 'text-neutral-500 hover:bg-neutral-900'}`} onClick={() => { setTab(item); if (item === 'styles') void loadStyles(); }}>{t(item === 'improve' ? 'Mejora' : item === 'styles' ? 'Estilos' : 'Historial IA')}</button>)}
          <button className="btn btn-ghost px-2" onClick={onClose} disabled={busy}><Icon name="x" /></button>
        </header>

        {tab === 'improve' && <div className="grid min-h-0 flex-1 grid-cols-[310px_minmax(0,1fr)]">
          <aside className="overflow-y-auto border-r border-neutral-800 p-4">
            <div className="relative mb-3"><Icon name="search" size={13} className="pointer-events-none absolute left-3 top-2.5 text-neutral-600" /><input className="input input-with-leading-icon h-8 w-full" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar estilos')} /></div>
            <div className="space-y-1" data-testid="study-style-list">{filteredStyles.filter((style) => !style.archivedAt && style.active).map((style) => <button key={style.id} data-testid={`study-style-${style.id.replace(':', '-')}`} className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left ${style.id === selectedStyleId ? 'border-teal-800 bg-teal-950/60' : 'border-transparent hover:bg-neutral-900'}`} onClick={() => setSelectedStyleId(style.id)}><span>{style.icon}</span><span className="min-w-0 flex-1"><span className="block text-xs text-neutral-200">{style.name}</span><span className="block truncate text-[10px] text-neutral-600">{style.description}</span></span>{style.favorite && <Icon name="star" size={10} className="text-amber-400" />}</button>)}</div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <label className="text-[10px] text-neutral-500">{t('Nivel')}<select className="input mt-1 w-full text-xs" value={level} onChange={(event) => setLevel(event.target.value as StudyImproveLevel)}><option value="minimal">{t('Mínima')}</option><option value="moderate">{t('Moderada')}</option><option value="deep">{t('Profunda')}</option></select></label>
              <label className="text-[10px] text-neutral-500">{t('Longitud')}<select className="input mt-1 w-full text-xs" value={length} onChange={(event) => setLength(event.target.value as StudyImproveLength)}><option value="similar">{t('Similar')}</option><option value="shorter">{t('Acortar')}</option><option value="develop">{t('Desarrollar')}</option></select></label>
            </div>
            <label className="mt-3 block text-[10px] text-neutral-500">{t('Modelo')}{settings && <ModelPicker compact settings={settings} value={model} onChange={setModel} emptyLabel="Usar modelo de mejora" />}</label>
            <div className="mt-3 rounded-lg border border-neutral-800 p-2.5">
              <label className="flex items-center gap-2 text-xs text-neutral-300"><input type="radio" checked={mode === 'preserve'} onChange={() => setMode('preserve')} /> {t('Conservar significado')}</label>
              <label className="mt-2 flex items-center gap-2 text-xs text-amber-300"><input type="radio" checked={mode === 'free'} onChange={() => { setMode('free'); setFreeConfirmed(false); }} /> {t('Transformación libre')}</label>
              {mode === 'free' && <label className="mt-2 flex gap-2 rounded bg-amber-950/40 p-2 text-[10px] text-amber-300"><input type="checkbox" checked={freeConfirmed} onChange={(event) => setFreeConfirmed(event.target.checked)} />{t('Acepto que puede cambiar el sentido y revisaré el resultado.')}</label>}
            </div>
            <p className="mt-3 text-[10px] text-neutral-600">≈ {estimateStudyTokens(original).toLocaleString()} {t('tokens de texto')} · {t('El coste depende del proveedor y modelo elegidos.')}</p>
            <button data-testid="study-improve-run" className="btn btn-primary mt-4 w-full justify-center" disabled={busy || !selectedStyle || (mode === 'free' && !freeConfirmed)} onClick={() => void run()}>{busy ? <Spinner label={t('Mejorando…')} /> : <><Icon name="wand" size={13} /> {result ? t('Repetir mejora') : t('Generar vista previa')}</>}</button>
            {busy && <button className="btn btn-ghost mt-2 w-full justify-center text-xs" onClick={() => void cancel()}>{t('Cancelar')}</button>}
          </aside>
          <main className="min-h-0 overflow-y-auto p-5">
            {error && <div className="mb-4 rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}<p className="mt-1 text-xs text-red-400/70">{t('El original permanece intacto.')}</p></div>}
            {!result && !busy && <div className="grid h-full place-items-center text-center"><div><Icon name="wand" size={32} className="mx-auto mb-3 text-teal-700" /><p className="text-sm text-neutral-400">{t('Elige un estilo y genera una vista previa.')}</p><p className="mt-1 text-xs text-neutral-600">{t('Nada se aplica hasta que aceptes el resultado.')}</p></div></div>}
            {busy && <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Vista previa en streaming')}</h3><pre className="min-h-48 whitespace-pre-wrap rounded-xl border border-neutral-800 bg-neutral-900/30 p-4 font-sans text-sm leading-6 text-neutral-300">{streamed || t('Esperando al modelo…')}</pre></section>}
            {result && <section data-testid="study-improve-result">
              <div className="mb-3 flex items-center gap-3"><h3 className="text-sm font-semibold text-neutral-200">{t('Revisar cambios')}</h3><span className="text-[10px] text-neutral-600">{result.modelProvider} · {result.modelName} · ≈ {result.estimatedOutputTokens} tokens · {result.protectedSpanCount} {t('fragmentos protegidos')}</span><button className="ml-auto text-xs text-neutral-500 hover:text-neutral-200" onClick={() => setAcceptedPieces(new Set(diff.map((piece, index) => piece.added || piece.removed ? index : -1).filter((index) => index >= 0)))}>{t('Aceptar todos los cambios')}</button><button className="text-xs text-neutral-500 hover:text-neutral-200" onClick={() => setAcceptedPieces(new Set())}>{t('Rechazar todos')}</button></div>
              {result.warnings.length > 0 && <div className="mb-3 rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-300">{result.warnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}</div>}
              <div className="max-h-[48vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-neutral-800 bg-neutral-900/30 p-4 text-sm leading-7">
                {diff.map((piece, index) => piece.added || piece.removed ? <button key={index} title={acceptedPieces.has(index) ? t('Clic para rechazar este cambio') : t('Clic para aceptar este cambio')} className={`${piece.added ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/20 text-red-200 line-through'} ${acceptedPieces.has(index) ? '' : 'opacity-35'} rounded-sm`} onClick={() => setAcceptedPieces((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })}>{piece.value}</button> : <span key={index} className="text-neutral-400">{piece.value}</span>)}
              </div>
              <div className="mt-4 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => { void window.nodus.updateStudyImprovementAction(result.logId, 'rejected'); onClose(); }}>{t('Rechazar')}</button><button className="btn btn-ghost" onClick={() => void apply('insert_below')}>{t('Insertar debajo del original')}</button><button data-testid="study-improve-accept" className="btn btn-primary" onClick={() => void apply('replace')}>{t('Sustituir selección')}</button></div>
            </section>}
          </main>
        </div>}

        {tab === 'styles' && <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)]">
          <aside className="overflow-y-auto border-r border-neutral-800 p-4">
            <div className="mb-3 flex gap-2"><input className="input input-with-leading-icon h-8 min-w-0 flex-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar estilos')} /><button data-testid="study-style-new" className="btn btn-primary h-8 px-3" onClick={() => void beginEdit('new')}>+ {t('Nuevo')}</button></div>
            {filteredStyles.map((style) => <div key={style.id} className={`mb-1 rounded-lg border p-2 ${style.archivedAt ? 'border-neutral-900 opacity-50' : style.id === selectedStyleId ? 'border-teal-800 bg-teal-950/30' : 'border-neutral-900'}`}><button className="flex w-full items-center gap-2 text-left" onClick={() => { setSelectedStyleId(style.id); void beginEdit(style); }}><span>{style.icon}</span><span className="min-w-0 flex-1"><span className="block text-xs text-neutral-200">{style.name}</span><span className="block truncate text-[10px] text-neutral-600">{style.builtIn ? t('Predefinido') : style.category}</span></span></button><div className="mt-2 flex gap-2 text-[10px] text-neutral-600"><button onClick={() => void window.nodus.duplicateStudyStyle(style.id).then(async (copy) => { setSelectedStyleId(copy.id); await loadStyles(); await beginEdit(copy); })}>{t('Duplicar')}</button>{!style.builtIn && <><button title={t('Subir en el orden')} onClick={() => void window.nodus.updateStudyStyle(style.id, { position: Math.max(0, style.position - 1) }).then(loadStyles)}>↑</button><button title={t('Bajar en el orden')} onClick={() => void window.nodus.updateStudyStyle(style.id, { position: style.position + 1 }).then(loadStyles)}>↓</button><button onClick={() => void window.nodus.updateStudyStyle(style.id, { favorite: !style.favorite }).then(loadStyles)}>{style.favorite ? t('Quitar favorito') : t('Favorito')}</button><button onClick={() => void window.nodus.archiveStudyStyle(style.id, !style.archivedAt).then(loadStyles)}>{style.archivedAt ? t('Restaurar') : t('Archivar')}</button>{style.archivedAt && <button className="text-red-500" onClick={() => { if (window.confirm(t('¿Eliminar este estilo definitivamente?'))) void window.nodus.deleteStudyStyle(style.id).then(loadStyles); }}>{t('Eliminar')}</button>}</>}</div></div>)}
            <div className="mt-4 flex gap-2"><button className="btn btn-ghost flex-1 text-xs" onClick={() => void window.nodus.importStudyStyles().then(loadStyles)}>{t('Importar')}</button><button className="btn btn-ghost flex-1 text-xs" onClick={() => void window.nodus.exportStudyStyles()}>{t('Exportar')}</button></div>
          </aside>
          <main className="min-h-0 overflow-y-auto p-5">
            {!editing ? <div className="grid h-full place-items-center text-sm text-neutral-600">{t('Selecciona un estilo o crea uno personalizado.')}</div> : <div className="mx-auto max-w-3xl" data-testid="study-style-editor">
              <div className="mb-4 flex items-center gap-2"><input className="input w-20 text-center" value={styleDraft.icon ?? ''} onChange={(event) => setStyleDraft({ ...styleDraft, icon: event.target.value })} aria-label={t('Icono o emoji')} /><input type="color" className="input h-9 w-12 p-1" value={styleDraft.color ?? '#0f766e'} onChange={(event) => setStyleDraft({ ...styleDraft, color: event.target.value })} /><input data-testid="study-style-name" className="input flex-1" value={styleDraft.name} onChange={(event) => setStyleDraft({ ...styleDraft, name: event.target.value })} placeholder={t('Nombre del estilo')} /></div>
              <textarea className="input mb-3 min-h-16 w-full" value={styleDraft.description ?? ''} onChange={(event) => setStyleDraft({ ...styleDraft, description: event.target.value })} placeholder={t('Descripción')} />
              <label className="block text-xs text-neutral-500">{t('Prompt con variables')}<textarea data-testid="study-style-prompt" className="input mt-1 min-h-32 w-full font-mono text-xs" value={styleDraft.prompt} onChange={(event) => setStyleDraft({ ...styleDraft, prompt: event.target.value })} /></label>
              <p className="mt-1 text-[10px] text-neutral-600">{'{{subject}} · {{topic}} · {{academicLevel}} · {{language}} · {{documentType}} · {{targetLength}} · {{selectedText}}'}</p>
              {promptWarnings.length > 0 && <div className="mt-2 rounded-lg border border-amber-900/50 bg-amber-950/30 p-2 text-[10px] text-amber-300">{promptWarnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}</div>}
              <label className="mt-3 block text-xs text-neutral-500">{t('System prompt adicional')}<textarea className="input mt-1 min-h-20 w-full font-mono text-xs" value={styleDraft.systemPrompt ?? ''} onChange={(event) => setStyleDraft({ ...styleDraft, systemPrompt: event.target.value })} /></label>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="text-[10px] text-neutral-500">{t('Idioma')}<input className="input mt-1 w-full" value={styleDraft.language ?? 'auto'} onChange={(event) => setStyleDraft({ ...styleDraft, language: event.target.value })} /></label>
                <label className="text-[10px] text-neutral-500">{t('Nivel')}<select className="input mt-1 w-full" value={styleDraft.level} onChange={(event) => setStyleDraft({ ...styleDraft, level: event.target.value as StudyImproveLevel })}><option value="minimal">{t('Mínima')}</option><option value="moderate">{t('Moderada')}</option><option value="deep">{t('Profunda')}</option></select></label>
                <label className="text-[10px] text-neutral-500">{t('Longitud')}<select className="input mt-1 w-full" value={styleDraft.length} onChange={(event) => setStyleDraft({ ...styleDraft, length: event.target.value as StudyImproveLength })}><option value="similar">{t('Similar')}</option><option value="shorter">{t('Acortar')}</option><option value="develop">{t('Desarrollar')}</option></select></label>
                <label className="text-[10px] text-neutral-500">{t('Categoría')}<select className="input mt-1 w-full" value={styleDraft.category} onChange={(event) => setStyleDraft({ ...styleDraft, category: event.target.value as StudyStyleInput['category'] })}><option value="custom">{t('Personalizado')}</option><option value="academic">{t('Académico')}</option><option value="clarity">{t('Claridad')}</option><option value="structure">{t('Estructura')}</option><option value="audience">{t('Audiencia')}</option></select></label>
                <label className="text-[10px] text-neutral-500">{t('Temperatura')}<input type="number" min="0" max="2" step="0.05" className="input mt-1 w-full" value={styleDraft.temperature} onChange={(event) => setStyleDraft({ ...styleDraft, temperature: Number(event.target.value) })} /></label>
                <label className="text-[10px] text-neutral-500">{t('Creatividad')}<input type="number" min="0" max="1" step="0.05" className="input mt-1 w-full" value={styleDraft.creativity} onChange={(event) => setStyleDraft({ ...styleDraft, creativity: Number(event.target.value) })} /></label>
                <label className="text-[10px] text-neutral-500">{t('Salida máxima')}<input type="number" min="128" max="16000" className="input mt-1 w-full" value={styleDraft.maxOutputTokens} onChange={(event) => setStyleDraft({ ...styleDraft, maxOutputTokens: Number(event.target.value) })} /></label>
                <label className="flex items-end gap-2 pb-2 text-xs text-neutral-400"><input type="checkbox" checked={Boolean(styleDraft.locked)} onChange={(event) => setStyleDraft({ ...styleDraft, locked: event.target.checked })} /> {t('Bloquear estilo')}</label>
                {settings && <label className="col-span-2 text-[10px] text-neutral-500">{t('Modelo propio del estilo')}<ModelPicker compact settings={settings} value={styleDraft.modelProvider && styleDraft.modelName ? { provider: styleDraft.modelProvider as ModelRef['provider'], model: styleDraft.modelName } : null} onChange={(value) => setStyleDraft({ ...styleDraft, modelProvider: value?.provider ?? null, modelName: value?.model ?? null })} emptyLabel="Usar modelo de mejora" /></label>}
                <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={styleDraft.active !== false} onChange={(event) => setStyleDraft({ ...styleDraft, active: event.target.checked })} /> {t('Estilo activo')}</label>
                <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={Boolean(styleDraft.favorite)} onChange={(event) => setStyleDraft({ ...styleDraft, favorite: event.target.checked })} /> {t('Estilo favorito')}</label>
              </div>
              <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/30 p-3"><label className="text-[10px] text-neutral-500">{t('Texto de prueba')}<textarea className="input mt-1 min-h-16 w-full" value={sample} onChange={(event) => setSample(event.target.value)} /></label><p className="mt-2 whitespace-pre-wrap text-xs text-neutral-400"><span className="text-teal-500">{t('Instrucción resultante')}:</span> {renderedSample}</p></div>
              {styleVersions.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-xs text-neutral-500">{t('Versiones del prompt')} ({styleVersions.length})</summary><div className="mt-2 flex flex-wrap gap-2">{styleVersions.map((version) => <button key={version.id} className="rounded border border-neutral-800 px-2 py-1 text-[10px] text-neutral-500 hover:text-teal-300" onClick={() => void window.nodus.restoreStudyStyleVersion((editing as StudyStyle).id, version.id).then(async (restored) => { await loadStyles(); await beginEdit(restored); })}>v{version.versionNo} · {new Date(version.createdAt).toLocaleString()}</button>)}</div></details>}
              {styleMessage && <p className="mt-3 text-xs text-amber-300">{styleMessage}</p>}
              <div className="mt-5 flex flex-wrap justify-end gap-2">{editing !== 'new' && <><button className="btn btn-ghost" onClick={() => void window.nodus.setStudyStyleAssociation((editing as StudyStyle).id, 'global', '', true).then(() => setStyleMessage(t('Predeterminado global actualizado.')))}>{t('Predeterminado global')}</button>{subjectId && <button className="btn btn-ghost" onClick={() => void window.nodus.setStudyStyleAssociation((editing as StudyStyle).id, 'subject', subjectId, true).then(() => setStyleMessage(t('Predeterminado para la asignatura actualizado.')))}>{t('Predeterminado para la asignatura')}</button>}<button className="btn btn-ghost" onClick={() => void window.nodus.setStudyStyleAssociation((editing as StudyStyle).id, 'document_kind', documentKind, true).then(() => setStyleMessage(t('Predeterminado para este tipo actualizado.')))}>{t('Predeterminado para este tipo')}</button></>}<button className="btn btn-ghost" onClick={() => setEditing(null)}>{t('Cancelar')}</button><button data-testid="study-style-save" className="btn btn-primary" disabled={!styleDraft.name.trim() || !styleDraft.prompt.trim()} onClick={() => void saveStyle()}>{t('Guardar estilo')}</button></div>
            </div>}
          </main>
        </div>}

        {tab === 'history' && <div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="mx-auto max-w-4xl"><h3 className="mb-3 text-sm font-semibold text-neutral-200">{t('Proveniencia de mejoras')}</h3>{logs.length === 0 ? <p className="text-sm text-neutral-600">{t('Todavía no se han generado mejoras para este documento.')}</p> : <div className="space-y-2">{logs.map((log) => <div key={log.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-neutral-800 p-3"><div><p className="text-xs text-neutral-300">{styles.find((style) => style.id === log.styleId)?.name ?? log.styleId} · {log.scope} · {log.level} · {log.length}</p><p className="mt-1 text-[10px] text-neutral-600">{log.modelProvider} · {log.modelName} · {log.originalChars} → {log.resultChars} caracteres · {log.originalHash.slice(0, 10)} → {log.resultHash.slice(0, 10)}</p>{log.warnings.map((warning) => <p key={warning} className="mt-1 text-[10px] text-amber-400">⚠ {warning}</p>)}</div><div className="text-right text-[10px] text-neutral-600"><span className="rounded bg-neutral-900 px-2 py-1">{log.action}</span><p className="mt-2">{new Date(log.createdAt).toLocaleString()}</p></div></div>)}</div>}</div></div>}
      </section>
    </div>
  );
}
