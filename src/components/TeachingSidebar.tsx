import { Icon } from './ui';
import { t } from '../i18n';

/** Views the teaching vault has already wired up (reused from the study workspace). */
export type TeachingView =
  | 'studyCourses'
  | 'studySchedule'
  | 'studyCalendar'
  | 'studyLibrary'
  | 'studyRecordings'
  | 'studyQuestions'
  | 'teachingGroups'
  | 'teachingExams'
  | 'teachingRubrics';

interface TeachingItem { label: string; icon: string; view?: TeachingView }
interface TeachingGroup { label: string; items: TeachingItem[] }

/**
 * The teacher's workspace. Items with a `view` are configured and navigate to the
 * shared study surface behind them; the rest are part of the planned structure and
 * render disabled ("coming soon") until they get their own product surface, so the
 * roadmap stays visible without pretending it works.
 */
const TEACHING_GROUPS: TeachingGroup[] = [
  { label: 'Organización', items: [
    { label: 'Cursos, asignaturas y grupos', icon: 'graduation', view: 'studyCourses' },
    { label: 'Grupos', icon: 'users', view: 'teachingGroups' },
    { label: 'Horarios', icon: 'clock', view: 'studySchedule' },
    { label: 'Calendario', icon: 'calendar', view: 'studyCalendar' },
    { label: 'Materiales', icon: 'book', view: 'studyLibrary' },
    { label: 'Grabaciones', icon: 'microphone', view: 'studyRecordings' },
  ] },
  { label: 'Evaluación', items: [
    { label: 'Banco de preguntas', icon: 'help', view: 'studyQuestions' },
    { label: 'Rúbricas', icon: 'table', view: 'teachingRubrics' },
    { label: 'Exámenes', icon: 'notebook', view: 'teachingExams' },
    { label: 'Calificaciones', icon: 'chartBar' },
  ] },
  { label: 'Crear', items: [
    { label: 'Guía docente / Programación', icon: 'book' },
    { label: 'Unidades didácticas', icon: 'layers' },
    { label: 'Situaciones de aprendizaje', icon: 'bulb' },
    { label: 'Adaptaciones', icon: 'users' },
    { label: 'Notas', icon: 'notebook' },
    { label: 'Proyectos de innovación', icon: 'flask' },
  ] },
];

export function TeachingSidebar({
  activeView,
  onNavigate,
}: {
  activeView: string;
  onNavigate: (view: TeachingView) => void;
}) {
  return (
    <div data-testid="teaching-sidebar" className="flex flex-col gap-1">
      {TEACHING_GROUPS.map((group) => (
        <section key={group.label} className="mt-2 flex flex-col gap-1">
          <h2 className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t(group.label)}</h2>
          {group.items.map((item) => item.view ? (
            <button
              key={item.label}
              data-tour={`nav-${item.view}`}
              onClick={() => onNavigate(item.view!)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                activeView === item.view ? 'bg-indigo-600 text-white' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
              }`}
            >
              <Icon name={item.icon} />
              <span>{t(item.label)}</span>
            </button>
          ) : (
            <button
              key={item.label}
              type="button"
              disabled
              aria-disabled="true"
              title={t('Disponible próximamente')}
              className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-500 opacity-60"
            >
              <Icon name={item.icon} className="opacity-70" />
              <span>{t(item.label)}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
