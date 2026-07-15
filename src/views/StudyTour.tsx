import type { View } from '../navigation';
import { TourOverlay, type TourStep } from './tourEngine';

/** First-run orientation for the dedicated study workspace. */
const STEPS: TourStep[] = [
  {
    title: 'Bienvenido al modo estudio',
    body: 'Este vault organiza tu aprendizaje sin obligarte a usar Zotero. Puedes crear apuntes, importar archivos, grabar clases, conectar conceptos y preparar repasos. En un minuto te enseño dónde está cada pieza.',
  },
  {
    target: 'nav-studyCourses',
    view: 'studyCourses',
    title: 'Cursos, asignaturas y apuntes',
    body: 'Empieza aquí: crea un curso, añade sus asignaturas y organiza temas, carpetas y documentos. Esta jerarquía mantiene separado el contexto de cada materia.',
  },
  {
    target: 'nav-studySchedule',
    view: 'studySchedule',
    title: 'Tu horario',
    body: 'Distribuye asignaturas y actividades por días y franjas horarias. Los colores e iconos que asignes a una materia se reutilizan en todo el vault.',
  },
  {
    target: 'nav-studyCalendar',
    view: 'studyCalendar',
    title: 'Calendario y recordatorios',
    body: 'Planifica clases, entregas, sesiones de estudio y exámenes. Puedes cambiar entre mes, semana y año y añadir recordatorios locales.',
  },
  {
    target: 'nav-studyLibrary',
    view: 'studyLibrary',
    title: 'Materiales de estudio',
    body: 'Importa PDF, documentos, presentaciones, audio y otros archivos. Zotero también está disponible como opción, pero no es necesario para usar este vault.',
  },
  {
    target: 'nav-studyRecordings',
    view: 'studyRecordings',
    title: 'Grabaciones y transcripción',
    body: 'Graba una clase o importa audio, transcríbelo y vincula fragmentos con tus apuntes para volver siempre a la evidencia original.',
  },
  {
    target: 'nav-studyChat',
    view: 'studyChat',
    title: 'Pregunta sobre tus contenidos',
    body: 'El chat de estudio responde con el contexto que selecciones y puede llevarte de vuelta al apunte, material o grabación que sustenta la respuesta.',
  },
  {
    target: 'nav-studyIdeas',
    view: 'studyIdeas',
    title: 'Ideas y grafo por asignatura',
    body: 'Extrae conceptos de tus materiales y explora cómo se relacionan. El aislamiento por asignatura evita mezclar materias que no pertenecen al mismo contexto.',
  },
  {
    target: 'nav-studyQuestions',
    view: 'studyQuestions',
    title: 'Banco de preguntas',
    body: 'Crea preguntas, tests, exámenes y flashcards desde contenidos concretos. Revisa siempre lo generado antes de usarlo para evaluar tu aprendizaje.',
  },
  {
    target: 'nav-studyReview',
    view: 'studyReview',
    title: 'Repaso',
    body: 'Reúne las tarjetas y preguntas que quieras practicar y convierte el resultado en un ciclo de revisión. Puedes volver a abrir este tutorial desde Ajustes.',
  },
];

export function StudyTour({ onClose, onNavigate }: { onClose: () => void; onNavigate: (view: View) => void }) {
  return <TourOverlay steps={STEPS} label="Tutorial de estudio" onClose={onClose} onNavigate={(view) => onNavigate(view as View)} />;
}
