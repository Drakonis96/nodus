import { Icon } from './ui';
import { t } from '../i18n';
import { orderSidebarItems } from '../navigation';

/** Views the teaching vault has already wired up (reused from the study workspace). */
export type TeachingView =
  | 'studySearch'
  | 'studyCourses'
  | 'studySchedule'
  | 'studyCalendar'
  | 'studyLibrary'
  | 'studyRecordings'
  | 'studyChat'
  | 'studyIdeas'
  | 'studyGraph'
  | 'studyQuestions'
  | 'teachingGroups'
  | 'teachingGrades'
  | 'teachingExams'
  | 'teachingRubrics'
  | 'teachingUnits';

export interface TeachingItem { label: string; icon: string; view: TeachingView }
export interface TeachingGroup { id: string; label: string; items: TeachingItem[]; hint?: string }

export function teachingItemId(item: TeachingItem): string {
  return item.view;
}

/** Available sections of the teacher's workspace. */
export const TEACHING_GROUPS: TeachingGroup[] = [
  { id: 'teaching-organization', label: 'Organización', items: [
    { label: 'Buscar', icon: 'search', view: 'studySearch' },
    { label: 'Cursos, asignaturas y grupos', icon: 'graduation', view: 'studyCourses' },
    { label: 'Grupos', icon: 'users', view: 'teachingGroups' },
    { label: 'Horarios', icon: 'clock', view: 'studySchedule' },
    { label: 'Calendario', icon: 'calendar', view: 'studyCalendar' },
    { label: 'Materiales', icon: 'book', view: 'studyLibrary' },
    { label: 'Grabaciones', icon: 'microphone', view: 'studyRecordings' },
  ] },
  // Shared study-corpus readers, relabelled for a teacher's workspace.
  { id: 'teaching-analyze', label: 'Analizar', items: [
    { label: 'Research chat', icon: 'chat', view: 'studyChat' },
    { label: 'Ideas', icon: 'bulb', view: 'studyIdeas' },
    { label: 'Grafo', icon: 'layers', view: 'studyGraph' },
  ] },
  { id: 'teaching-assessment', label: 'Evaluación', items: [
    { label: 'Banco de preguntas', icon: 'help', view: 'studyQuestions' },
    { label: 'Rúbricas', icon: 'table', view: 'teachingRubrics' },
    { label: 'Exámenes', icon: 'notebook', view: 'teachingExams' },
    { label: 'Calificaciones', icon: 'chartBar', view: 'teachingGrades' },
  ] },
  { id: 'teaching-create', label: 'Crear', items: [
    { label: 'Diseño de unidades', icon: 'compass', view: 'teachingUnits' },
  ] },
];

export function TeachingSidebar({
  compact = false,
  activeView,
  onNavigate,
  sidebarOrder = [],
  sidebarHidden = [],
}: {
  compact?: boolean;
  activeView: string;
  onNavigate: (view: TeachingView) => void;
  sidebarOrder?: string[];
  sidebarHidden?: string[];
}) {
  return (
    <div data-testid="teaching-sidebar" className="flex flex-col gap-1">
      {TEACHING_GROUPS.map((group) => {
        const items = orderSidebarItems(
          group.items.map((item) => ({ ...item, id: teachingItemId(item) })),
          sidebarOrder,
        )
          .filter((item) => !sidebarHidden.includes(item.id));
        if (items.length === 0) return null;
        return (
          <section key={group.id} className={`${compact ? 'mt-1 border-t border-neutral-800/70 pt-1' : 'mt-2'} flex flex-col gap-1`}>
            <h2 className={compact ? 'sr-only' : 'px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600'}>{t(group.label)}</h2>
            {!compact && group.hint && (
              <p className="px-3 pb-1 text-[10px] leading-snug text-neutral-500">{t(group.hint)}</p>
            )}
            {items.map((item) => (
              <button
                key={item.id}
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
          </section>
        );
      })}
    </div>
  );
}
