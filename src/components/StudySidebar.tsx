import { useState } from 'react';
import { Icon } from './ui';
import { t } from '../i18n';
import { orderSidebarItems } from '../navigation';

export type StudyNavigationTarget = {
  kind: 'course' | 'subject' | 'topic' | 'folder' | 'document';
  id: string;
};

export const STUDY_WORKSPACE_CHANGED = 'nodus:study-workspace-changed';

export function announceStudyWorkspaceChanged(): void {
  window.dispatchEvent(new Event(STUDY_WORKSPACE_CHANGED));
}

export const STUDY_SECTIONS = [
  { view: 'studyCourses', icon: 'graduation', label: 'Cursos y asignaturas' },
  { view: 'studySchedule', icon: 'clock', label: 'Horarios' },
  { view: 'studyCalendar', icon: 'calendar', label: 'Calendario' },
  { view: 'studySearch', icon: 'search', label: 'Buscar' },
  { view: 'studyLibrary', icon: 'book', label: 'Materiales' },
  { view: 'studyRecordings', icon: 'microphone', label: 'Grabaciones' },
] as const;

/**
 * Study's sidebar is deliberately section-only. Courses, subjects, folders and
 * topics belong to the organization browser in the main pane, where there is
 * enough room to understand and navigate their hierarchy.
 */
export function StudySidebar({
  compact = false,
  activeView,
  onNavigate,
  sidebarOrder = [],
  sidebarHidden = [],
}: {
  compact?: boolean;
  activeView: string;
  onNavigate: (view: (typeof STUDY_SECTIONS)[number]['view']) => void;
  sidebarOrder?: string[];
  sidebarHidden?: string[];
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('nodus.studyOrganizationCollapsed') === '1');
  const toggle = () => setCollapsed((value) => {
    localStorage.setItem('nodus.studyOrganizationCollapsed', value ? '0' : '1');
    return !value;
  });
  const visibleSections = orderSidebarItems(
    STUDY_SECTIONS.map((item) => ({ ...item, id: item.view })),
    sidebarOrder,
  )
    .filter((item) => !sidebarHidden.includes(item.id));
  if (visibleSections.length === 0) return null;
  return (
    <div data-testid="study-sidebar-organization" className={`${compact ? 'mt-1 border-t border-neutral-800/70 pt-1' : 'mt-2'} flex flex-col gap-1`}>
      {!compact && (
        <button data-testid="study-sidebar-organization-toggle" aria-expanded={!collapsed} onClick={toggle} title={collapsed ? t('Mostrar grupo') : t('Plegar grupo')} className="flex items-center gap-1 px-3 pb-0.5 pt-1 text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-600 transition-colors hover:text-neutral-400">
          <Icon name="chevronRight" size={11} className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`} />
          {t('Organización')}
        </button>
      )}
      {(compact || !collapsed) && visibleSections.map((item) => (
        <button
          key={item.view}
          data-tour={`nav-${item.view}`}
          onClick={() => onNavigate(item.view)}
          aria-label={compact ? t(item.label) : undefined}
          title={compact ? t(item.label) : undefined}
          className={`flex items-center rounded-lg py-2 text-left text-sm ${compact ? 'justify-center px-2' : 'gap-2 px-3'} ${
            activeView === item.view ? 'bg-indigo-600 text-white' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
          }`}
        >
          <Icon name={item.icon} className="shrink-0" />
          <span className={compact ? 'sr-only' : undefined}>{t(item.label)}</span>
        </button>
      ))}
    </div>
  );
}
