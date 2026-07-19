import { Icon } from './ui';
import { t } from '../i18n';
import type { RoadmapTopicKey } from '../views/RoadmapFeedbackModal';

/** Views the teaching vault has already wired up (reused from the study workspace). */
export type TeachingView =
  | 'studyCourses'
  | 'studySchedule'
  | 'studyCalendar'
  | 'studyLibrary'
  | 'studyRecordings'
  | 'studyQuestions'
  | 'teachingGroups'
  | 'teachingGrades'
  | 'teachingExams'
  | 'teachingRubrics';

interface TeachingItem { label: string; icon: string; view?: TeachingView; topic?: RoadmapTopicKey }
interface TeachingGroup { label: string; items: TeachingItem[]; hint?: string }

/**
 * The teacher's workspace. Items with a `view` are configured and navigate to the
 * shared study surface behind them; items with a `topic` are planned but not built,
 * and open the feedback thread for that section instead, so the roadmap is visible
 * and the people who would use it get to shape it before it exists.
 */
export const TEACHING_GROUPS: TeachingGroup[] = [
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
    { label: 'Calificaciones', icon: 'chartBar', view: 'teachingGrades' },
  ] },
  { label: 'Crear', items: [
    { label: 'Guía docente / Programación', icon: 'book', topic: 'guiaDocente' },
    { label: 'Unidades didácticas', icon: 'layers', topic: 'unidadesDidacticas' },
    { label: 'Situaciones de aprendizaje', icon: 'bulb', topic: 'situacionesAprendizaje' },
    { label: 'Adaptaciones', icon: 'users', topic: 'adaptaciones' },
    { label: 'Notas', icon: 'notebook', topic: 'notas' },
    { label: 'Proyectos de innovación', icon: 'flask', topic: 'proyectosInnovacion' },
  ], hint: 'En diseño. Ábrelas para contar qué necesitas.' },
];

export function TeachingSidebar({
  activeView,
  onNavigate,
  onOpenRoadmap,
}: {
  activeView: string;
  onNavigate: (view: TeachingView) => void;
  onOpenRoadmap: (topic: RoadmapTopicKey) => void;
}) {
  return (
    <div data-testid="teaching-sidebar" className="flex flex-col gap-1">
      {TEACHING_GROUPS.map((group) => (
        <section key={group.label} className="mt-2 flex flex-col gap-1">
          <h2 className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t(group.label)}</h2>
          {group.hint && (
            <p className="px-3 pb-1 text-[10px] leading-snug text-neutral-500">{t(group.hint)}</p>
          )}
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
              data-testid={`teaching-roadmap-${item.topic}`}
              onClick={() => onOpenRoadmap(item.topic!)}
              title={`${t('En diseño')} · ${t('Cuéntame qué necesitas en esta sección')}`}
              className="group flex w-full items-center gap-2 rounded-lg border border-dashed border-indigo-400 px-3 py-2 text-left text-sm text-neutral-500 transition-colors hover:bg-indigo-600/20 hover:text-indigo-700 dark:hover:text-indigo-300"
            >
              <Icon name={item.icon} className="shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
              <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
              <Icon
                name="sparkles"
                size={13}
                className="shrink-0 text-indigo-500 opacity-70 transition-opacity group-hover:opacity-100"
              />
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
