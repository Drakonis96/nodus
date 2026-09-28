import { memo, useEffect, useMemo, useState } from 'react';
import type { StudyDocument, StudyWorkspace } from '@shared/studyOrg';
import type { StudyMaterialPreviewKind, StudyMaterialSummary } from '@shared/studyMaterials';
import { focusLayoutVisible } from '@shared/studyFocus';
import { openFocusLayout, openFocusTimer, useStudyFocus, useStudyFocusLayout } from './StudyFocusContext';
import { focusClock, focusRemaining, phaseName } from './FocusControls';
import { STUDY_WORKSPACE_CHANGED, announceStudyWorkspaceChanged } from '../StudySidebar';
import { Icon } from '../ui';
import { errorText, getActiveLang, t, tx } from '../../i18n';

/** One destination of the focus rail, already translated and resolved by the shell. */
export interface FocusRailItem { key: string; label: string; icon: string; active: boolean; open: () => void }

/**
 * What the Study vault leaves on screen in focus mode. The ordinary sidebar is
 * organized for finding things; this rail is organized for working: the block in
 * progress, the materials of the subject being studied, and the study sections the
 * student chose to keep (focus mode settings), so the mode never locks the student
 * out of their own tools.
 */
export function FocusRail({ items, onOpenSubject, onOpenDocument, onOpenMaterial, onOpenLibrary }: {
  items: FocusRailItem[];
  onOpenSubject: (subjectId: string) => void;
  onOpenDocument: (documentId: string) => void;
  onOpenMaterial: (materialId: string) => void;
  onOpenLibrary: () => void;
}) {
  const focus = useStudyFocus();
  const { layout } = useStudyFocusLayout();
  const show = (id: string) => focusLayoutVisible(layout, id);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('nodus.focusRailCollapsed') === '1'; } catch { return false; } });
  const toggle = () => setCollapsed(value => {
    try { localStorage.setItem('nodus.focusRailCollapsed', value ? '0' : '1'); } catch { /* the choice just is not remembered */ }
    return !value;
  });
  const state = focus?.snapshot?.state;
  const vaultId = focus?.snapshot?.vaultId;
  return <aside data-testid="focus-rail" className={`focus-rail ${collapsed ? 'is-collapsed' : ''}`} aria-label={t('Modo concentración')}>
    <div className="focus-rail-head">
      <span className="focus-rail-title"><Icon name="focus" size={15} /><span>{t('Concentración')}</span></span>
      <span className="focus-rail-head-actions">
        <button type="button" data-testid="focus-rail-settings" className="focus-rail-icon-button focus-rail-settings" onClick={openFocusLayout} aria-label={t('Personalizar el modo concentración')} title={t('Personalizar el modo concentración')}><Icon name="settings" size={14} /></button>
        <button type="button" className="focus-rail-icon-button" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? t('Mostrar el panel de concentración') : t('Plegar el panel de concentración')} title={collapsed ? t('Mostrar el panel de concentración') : t('Plegar el panel de concentración')}><Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={14} /></button>
      </span>
    </div>
    <div className="focus-rail-scroll">
      {state && show('block:timer') && <button type="button" data-testid="focus-rail-timer" className="focus-rail-timer" onClick={openFocusTimer} title={t('Temporizador de concentración')} aria-label={`${t('Temporizador de concentración')}: ${state.status === 'ready' ? t('A tu ritmo') : `${phaseName(state.phase)} · ${focusClock(focusRemaining(state))}`}`}>
        <span className={`focus-dot ${state.status === 'running' ? 'active' : ''}`} />
        <span className="focus-rail-label">{state.status === 'ready' ? t('Iniciar un bloque') : state.status === 'paused' ? t('En pausa') : state.status === 'complete' ? t('Completado') : phaseName(state.phase)}</span>
        <strong>{focusClock(focusRemaining(state))}</strong>
      </button>}
      {vaultId && (show('block:subject') || show('block:shelf')) && <SubjectShelf key={vaultId} showSubject={show('block:subject')} showShelf={show('block:shelf')} subjectId={state?.subjectId ?? null} task={state?.task ?? null} onOpenSubject={onOpenSubject} onOpenDocument={onOpenDocument} onOpenMaterial={onOpenMaterial} onOpenLibrary={onOpenLibrary} />}
      {items.length > 0 && <RailNav items={items} />}
    </div>
    <div className="focus-rail-foot">
      <button type="button" data-testid="focus-exit" className="focus-rail-link focus-rail-exit" onClick={() => void focus?.exitFocusMode()} title={t('Salir del modo concentración')} aria-label={t('Salir del modo concentración')}><Icon name="minimize" size={15} /><span className="focus-rail-label">{t('Salir del modo concentración')}</span></button>
    </div>
  </aside>;
}

const RailNav = memo(function RailNav({ items }: { items: FocusRailItem[] }) {
  return <nav className="focus-rail-section" aria-label={t('Secciones de estudio')}>
    <h2 className="focus-rail-heading">{t('Estudiar')}</h2>
    {items.map(item => <button type="button" key={item.key} data-testid={`focus-rail-nav-${item.key}`} className={`focus-rail-link ${item.active ? 'is-active' : ''}`} aria-current={item.active ? 'page' : undefined} onClick={item.open} title={item.label}>
      <Icon name={item.icon} size={15} /><span className="focus-rail-label">{item.label}</span>
    </button>)}
  </nav>;
});

type ShelfEntry = { kind: 'document'; id: string; title: string; icon: string; updatedAt: string; pinned: boolean }
  | { kind: 'material'; id: string; title: string; icon: string; updatedAt: string; pinned: boolean };

const MATERIAL_ICON: Record<StudyMaterialPreviewKind, string> = { pdf: 'fileText', document: 'file', presentation: 'presentation', image: 'image', audio: 'audio', unknown: 'file' };
const SHELF_LIMIT = 8;

/** Notes and materials of the block's subject (or the latest ones, with no subject). */
const SubjectShelf = memo(function SubjectShelf({ showSubject, showShelf, subjectId, task, onOpenSubject, onOpenDocument, onOpenMaterial, onOpenLibrary }: {
  showSubject: boolean; showShelf: boolean;
  subjectId: string | null; task: string | null;
  onOpenSubject: (subjectId: string) => void;
  onOpenDocument: (documentId: string) => void;
  onOpenMaterial: (materialId: string) => void;
  onOpenLibrary: () => void;
}) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [materials, setMaterials] = useState<StudyMaterialSummary[] | null>(null);
  const [filter, setFilter] = useState('');
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);
  // A fresh note filed under the block's subject, dated so a week of them stays legible.
  const createNote = async (id: string) => {
    setCreating(true); setCreateError(null);
    try {
      const date = new Date().toLocaleDateString(getActiveLang(), { day: 'numeric', month: 'long' });
      const document = await window.nodus.createStudyDocument({ title: tx('Apuntes · {date}', { date }), placement: { subjectId: id } });
      announceStudyWorkspaceChanged();
      onOpenDocument(document.id);
    } catch (reason) { setCreateError(reason); } finally { setCreating(false); }
  };
  useEffect(() => {
    let alive = true;
    const load = () => {
      void Promise.all([
        window.nodus.getStudyWorkspace(),
        window.nodus.listStudyMaterials(subjectId ? { subjectId } : {}),
      ]).then(([nextWorkspace, nextMaterials]) => {
        if (!alive) return;
        setWorkspace(nextWorkspace); setMaterials(nextMaterials); setFailed(false);
      }).catch(() => { if (alive) setFailed(true); });
    };
    load();
    window.addEventListener(STUDY_WORKSPACE_CHANGED, load);
    return () => { alive = false; window.removeEventListener(STUDY_WORKSPACE_CHANGED, load); };
  }, [subjectId]);
  useEffect(() => { setFilter(''); }, [subjectId]);
  const subject = subjectId ? workspace?.subjects.find(item => item.id === subjectId) ?? null : null;
  const entries = useMemo<ShelfEntry[]>(() => {
    if (!workspace || !materials) return [];
    const inSubject = subjectId ? new Set(workspace.placements.filter(placement => placement.subjectId === subjectId && !placement.deletedAt).map(placement => placement.documentId)) : null;
    const documents = workspace.documents.filter((document: StudyDocument) => !document.deletedAt && !document.archivedAt && (!inSubject || inSubject.has(document.id)));
    const all: ShelfEntry[] = [
      ...documents.map(document => ({ kind: 'document' as const, id: document.id, title: document.title || t('Sin título'), icon: 'notebook', updatedAt: document.updatedAt, pinned: document.pinned || document.favorite })),
      ...materials.map(material => ({ kind: 'material' as const, id: material.id, title: material.title || material.fileName, icon: MATERIAL_ICON[material.previewKind] ?? 'file', updatedAt: material.updatedAt, pinned: material.pinned || material.favorite })),
    ];
    return all.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }, [workspace, materials, subjectId]);
  const query = filter.trim().toLocaleLowerCase();
  const visible = (query ? entries.filter(entry => entry.title.toLocaleLowerCase().includes(query)) : entries).slice(0, query ? 50 : SHELF_LIMIT);
  const loading = !workspace || !materials;
  return <>
    {showSubject && <section className="focus-rail-section focus-rail-session" aria-label={t('Bloque actual')}>
      <h2 className="focus-rail-heading">{t('Asignatura')}</h2>
      {subject
        ? <button type="button" data-testid="focus-rail-subject" className="focus-rail-link focus-rail-subject" onClick={() => onOpenSubject(subject.id)} title={t('Abrir la asignatura')}>
            <Icon name="graduation" size={15} /><span className="focus-rail-label">{subject.name}</span>
          </button>
        : <p className="focus-rail-note">{t('Sin asignatura. Elige una al iniciar el bloque para tener aquí sus apuntes y materiales.')}</p>}
      {task && <p className="focus-rail-task" data-testid="focus-rail-task"><Icon name="target" size={13} /><span>{task}</span></p>}
      {subject && <button type="button" data-testid="focus-rail-new-note" className="focus-rail-link focus-rail-new" disabled={creating} onClick={() => void createNote(subject.id)}><Icon name="plus" size={15} /><span className="focus-rail-label">{t('Nuevo apunte')}</span></button>}
      {createError != null && <p className="focus-rail-note" role="alert">{errorText(createError)}</p>}
    </section>}
    {showShelf && <section className="focus-rail-section focus-rail-shelf" aria-label={subject ? t('Apuntes y materiales de la asignatura') : t('Apuntes y materiales recientes')}>
      <h2 className="focus-rail-heading">{subject ? t('De esta asignatura') : t('Recientes')}</h2>
      {entries.length > SHELF_LIMIT && <input className="input focus-rail-filter" type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder={t('Filtrar apuntes y materiales')} aria-label={t('Filtrar apuntes y materiales')} />}
      {failed ? <p className="focus-rail-note" role="alert">{t('No se han podido cargar los materiales.')}</p>
        : loading ? <p className="focus-rail-note">{t('Cargando...')}</p>
        : visible.length === 0 ? <p className="focus-rail-note">{query ? t('Nada coincide con el filtro.') : subject ? t('Esta asignatura aún no tiene apuntes ni materiales.') : t('Aún no hay apuntes ni materiales.')}</p>
        : visible.map(entry => <button type="button" key={`${entry.kind}:${entry.id}`} data-testid={`focus-rail-${entry.kind}-${entry.id}`} className="focus-rail-link" title={`${entry.kind === 'document' ? t('Apunte') : t('Material')} · ${entry.title}`} onClick={() => entry.kind === 'document' ? onOpenDocument(entry.id) : onOpenMaterial(entry.id)}>
            <Icon name={entry.icon} size={15} /><span className="focus-rail-label">{entry.title}</span>
          </button>)}
      {!loading && !failed && (subject ? entries.length > SHELF_LIMIT : true) && <button type="button" className="focus-rail-more" onClick={() => subject ? onOpenSubject(subject.id) : onOpenLibrary()}>{subject ? t('Ver toda la asignatura') : t('Ver todos los materiales')}<Icon name="chevronRight" size={12} /></button>}
    </section>}
  </>;
});
