import { useEffect, useMemo, useState } from 'react';
import type { StudyStyle, StudyStyleInput } from '@shared/types';
import { validateStudyStylePrompt } from '@shared/studyImprove';
import { t } from '../../i18n';
import { Icon, ICON_NAMES, Spinner } from '../ui';
import { IconEmojiPicker } from '../IconEmojiPicker';

const TOOLBAR_LIMIT = 4;

const newPrompt = (): StudyStyleInput => ({
  name: '', prompt: '', icon: 'wand', color: '#0f766e', description: 'Prompt personalizado creado por el usuario.',
  category: 'custom', language: 'auto', level: 'moderate', length: 'similar', systemPrompt: '', temperature: 0.2,
  maxOutputTokens: 2400, creativity: 0.1, locked: false, favorite: false, active: true,
});

function PromptMark({ style, size = 17 }: { style: Pick<StudyStyle, 'icon'>; size?: number }) {
  return (ICON_NAMES as readonly string[]).includes(style.icon)
    ? <Icon name={style.icon} size={size} />
    : <span className="leading-none" style={{ fontSize: size }}>{style.icon || '✦'}</span>;
}

export function StudyImproveDialog({ onToolbarChanged, onClose }: {
  onToolbarChanged: (styles: StudyStyle[]) => void;
  onClose: () => void;
}) {
  const [styles, setStyles] = useState<StudyStyle[]>([]);
  const [toolbarIds, setToolbarIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState('builtin:academic');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<StudyStyleInput>(newPrompt);
  const [visual, setVisual] = useState({ icon: 'wand', emoji: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async (preferredId?: string) => {
    const [nextStyles, settings] = await Promise.all([window.nodus.listStudyStyles(), window.nodus.getSettings()]);
    const available = nextStyles.filter((style) => style.active && !style.archivedAt);
    const nextIds = settings.studyImproveToolbarStyleIds.filter((id) => available.some((style) => style.id === id)).slice(0, TOOLBAR_LIMIT);
    setStyles(available);
    setToolbarIds(nextIds);
    const targetId = preferredId ?? selectedId;
    setSelectedId(available.some((style) => style.id === targetId) ? targetId : available[0]?.id ?? '');
    onToolbarChanged(available.filter((style) => nextIds.includes(style.id)).sort((a, b) => nextIds.indexOf(a.id) - nextIds.indexOf(b.id)));
  };

  useEffect(() => { void load(); }, []);

  const selected = styles.find((style) => style.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return styles.filter((style) => !needle || `${style.name} ${style.description} ${style.prompt}`.toLocaleLowerCase().includes(needle));
  }, [styles, query]);

  const toggleToolbar = async (style: StudyStyle) => {
    const active = toolbarIds.includes(style.id);
    if (!active && toolbarIds.length >= TOOLBAR_LIMIT) {
      setMessage(t('Puedes mostrar un máximo de cuatro prompts en la barra.'));
      return;
    }
    const next = active ? toolbarIds.filter((id) => id !== style.id) : [...toolbarIds, style.id];
    setToolbarIds(next); setMessage('');
    await window.nodus.updateSettings({ studyImproveToolbarStyleIds: next });
    onToolbarChanged(styles.filter((item) => next.includes(item.id)).sort((a, b) => next.indexOf(a.id) - next.indexOf(b.id)));
  };

  const startCreate = () => {
    setDraft(newPrompt()); setVisual({ icon: 'wand', emoji: '' }); setCreating(true); setMessage('');
  };

  const savePrompt = async () => {
    if (!draft.name.trim() || !draft.prompt.trim()) { setMessage(t('Indica un título y un prompt.')); return; }
    setBusy(true); setMessage('');
    try {
      const saved = await window.nodus.createStudyStyle({ ...draft, icon: visual.emoji || visual.icon });
      setSelectedId(saved.id); setCreating(false);
      const nextIds = toolbarIds.length < TOOLBAR_LIMIT ? [...toolbarIds, saved.id] : toolbarIds;
      if (nextIds.length !== toolbarIds.length) await window.nodus.updateSettings({ studyImproveToolbarStyleIds: nextIds });
      await load(saved.id);
      setMessage(t('Prompt guardado.'));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const warnings = validateStudyStylePrompt(draft.prompt);

  return <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/65 p-4" data-testid="study-improve-dialog" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300"><Icon name="wand" size={15} /></span>
        <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{t('Prompts de mejora')}</h2><p className="text-[11px] text-neutral-500">{t('Elige hasta cuatro accesos rápidos para la barra de escritura.')}</p></div>
        <button data-testid="study-style-new" className="btn btn-primary h-8 px-3 text-xs" onClick={startCreate}><Icon name="plus" size={12} />{t('Nuevo prompt')}</button>
        <button className="btn btn-ghost h-8 w-8 p-0" onClick={onClose} aria-label={t('Cerrar')}><Icon name="x" size={14} /></button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-neutral-200 p-3 dark:border-neutral-800">
          <label className="relative block"><Icon name="search" size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" /><input className="input input-with-leading-icon h-8 w-full text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar prompts…')} /></label>
          <div className="mt-3 space-y-1" data-testid="study-style-list">{filtered.map((style) => {
            const inToolbar = toolbarIds.includes(style.id);
            return <div key={style.id} className={`flex items-center rounded-lg border ${selectedId === style.id ? 'border-teal-400 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/30' : 'border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-900'}`}>
              <button className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left" data-testid={`study-style-${style.id.replace(':', '-')}`} onClick={() => { setSelectedId(style.id); setCreating(false); setMessage(''); }}><span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-neutral-100 dark:bg-neutral-900"><PromptMark style={style} /></span><span className="min-w-0 truncate text-xs">{style.name}</span></button>
              <button data-testid={`study-style-toolbar-${style.id.replace(':', '-')}`} className={`mr-1 grid h-7 w-7 place-items-center rounded-md ${inToolbar ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title={inToolbar ? t('Quitar de la barra') : t('Mostrar en la barra')} aria-label={inToolbar ? t('Quitar de la barra') : t('Mostrar en la barra')} onClick={() => void toggleToolbar(style)}><Icon name="star" size={12} /></button>
            </div>;
          })}</div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-4">
          {creating ? <div data-testid="study-style-editor" className="space-y-3">
            <h3 className="text-sm font-semibold">{t('Añadir prompt')}</h3>
            <label className="block text-xs text-neutral-500">{t('Título')}<input data-testid="study-prompt-title" autoFocus className="input mt-1 w-full" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label className="block text-xs text-neutral-500">{t('Icono o emoji')}<IconEmojiPicker icon={visual.icon} emoji={visual.emoji} onChange={setVisual} /></label>
            <label className="block text-xs text-neutral-500">{t('Prompt')}<textarea data-testid="study-prompt-text" className="input mt-1 min-h-32 w-full resize-y py-2" value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} placeholder={t('Indica exactamente cómo debe transformar el texto seleccionado…')} /></label>
            {warnings.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{warnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}</div>}
            <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setCreating(false)}>{t('Cancelar')}</button><button data-testid="study-prompt-save" className="btn btn-primary" disabled={busy} onClick={() => void savePrompt()}>{busy ? <Spinner label={t('Guardando…')} /> : t('Guardar prompt')}</button></div>
          </div> : selected ? <article data-testid="study-prompt-detail">
            <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"><PromptMark style={selected} size={20} /></span><div><h3 className="font-semibold">{selected.name}</h3><p className="text-[11px] text-neutral-500">{selected.builtIn ? t('Prompt incluido') : t('Prompt personalizado')}</p></div></div>
            <p className="mt-4 rounded-lg bg-neutral-50 p-3 text-sm leading-6 text-neutral-600 dark:bg-neutral-900/60 dark:text-neutral-300">{selected.description || t('Sin descripción.')}</p>
            <h4 className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Prompt guardado')}</h4>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-neutral-200 bg-white p-3 font-sans text-xs leading-5 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">{selected.prompt}</pre>
            <button className={`mt-4 btn ${toolbarIds.includes(selected.id) ? 'btn-primary' : 'btn-ghost border border-neutral-300 dark:border-neutral-700'}`} onClick={() => void toggleToolbar(selected)}><Icon name="star" size={12} />{toolbarIds.includes(selected.id) ? t('Visible en la barra') : t('Mostrar en la barra')}</button>
          </article> : <div className="grid h-full place-items-center text-sm text-neutral-500">{t('No hay prompts guardados.')}</div>}
          {message && <p className="mt-3 text-xs text-teal-700 dark:text-teal-300" role="status">{message}</p>}
        </main>
      </div>
    </section>
  </div>;
}
