import type { View } from '../navigation';
import { VAULT_TYPE_COLORS } from '@shared/vaultTypes';
import { TourOverlay, type TourStep } from './tourEngine';

/**
 * First-run orientation for the teaching workspace.
 *
 * Longer than the other vault tours on purpose: teaching is the only mode whose three
 * central surfaces — rubric, exam and gradebook — are *documents the teacher builds*
 * rather than places data lands, so each gets two steps, one on the entry point and one
 * on the list, where the seeded demo gives the spotlight something real to land on.
 *
 * Every string here is Spanish source text used verbatim as the i18n key, translated by
 * `TourOverlay` through `t()`. `scripts/test-i18n-coverage.mjs` reads this file from its
 * INDIRECT_KEY_SOURCES list, so a step added without translations fails the suite.
 */
const STEPS: TourStep[] = [
  {
    title: 'Bienvenido al modo docencia',
    body: 'Este vault reúne lo que necesitas para dar clase: organizar el curso, llevar la lista del alumnado y evaluar con rúbricas, exámenes y un cuaderno de notas. En un par de minutos te enseño dónde está cada pieza.',
  },
  {
    target: 'nav-studyCourses',
    view: 'studyCourses',
    title: 'Cursos, asignaturas y unidades',
    body: 'El punto de partida: crea el curso, sus asignaturas y las carpetas y temas de cada unidad. Todo lo demás —horario, materiales, evaluación— se cuelga de esta jerarquía.',
  },
  {
    target: 'nav-teachingGroups',
    view: 'teachingGroups',
    title: 'Grupos de alumnado',
    body: 'Cada grupo pertenece a una asignatura y a un curso académico, así que el año siguiente empiezas con la lista vacía en lugar de arrastrar la anterior. Puedes importar el alumnado de otro grupo con un clic.',
  },
  {
    target: 'group-table',
    view: 'teachingGroups',
    title: 'Los nombres no salen del programa',
    body: 'Cuando pides ayuda a la IA, cada estudiante viaja como un código del tipo STU_4K7M y el nombre real se restituye al recibir la respuesta. El modelo nunca ve a quién estás evaluando.',
  },
  {
    target: 'nav-studySchedule',
    view: 'studySchedule',
    title: 'Tu horario',
    body: 'Coloca las asignaturas en la rejilla de días y franjas. Los colores e iconos que asignes se reutilizan en el calendario y en el resto del vault.',
  },
  {
    target: 'nav-studyCalendar',
    view: 'studyCalendar',
    title: 'Calendario del curso',
    body: 'Sesiones, entregas, exámenes y reuniones, con vista de mes, semana y año. Los recordatorios son locales: nada sale de tu equipo.',
  },
  {
    target: 'nav-studyLibrary',
    view: 'studyLibrary',
    title: 'Materiales de clase',
    body: 'Importa PDF, documentos, presentaciones o imágenes y colócalos en la unidad que corresponda. De aquí saldrán después las preguntas y las rúbricas que genere la IA.',
  },
  {
    target: 'nav-studyRecordings',
    view: 'studyRecordings',
    title: 'Grabaciones y transcripción',
    body: 'Graba una sesión o importa audio, transcríbelo y enlaza fragmentos con tus materiales. Útil para recuperar lo que se dijo en clase al preparar la evaluación.',
  },
  {
    target: 'nav-studyQuestions',
    view: 'studyQuestions',
    title: 'Banco de preguntas',
    body: 'Un almacén reutilizable de preguntas por asignatura y tema, con su solución y su nivel cognitivo. Es independiente del examen impreso: aquí se guarda, allí se maqueta.',
  },
  {
    target: 'rubric-new',
    view: 'teachingRubrics',
    title: 'Crear una rúbrica',
    body: 'Pulsa aquí y tendrás una rúbrica analítica en blanco: filas de criterios por columnas de niveles, con un descriptor en cada celda. También puedes generarla con IA desde un material o describiendo la tarea.',
  },
  {
    target: 'rubric-table',
    view: 'teachingRubrics',
    title: 'Criterios, niveles y pesos',
    body: 'El peso va por criterio (la fila) y debe sumar 100; el nivel más alto se coloca a la izquierda. Cuatro niveles es el valor por defecto porque un número par evita el punto medio cómodo.',
  },
  {
    target: 'rubric-table',
    view: 'teachingRubrics',
    title: 'Avisos de calidad',
    body: 'Al editar, la rúbrica se revisa sola: descriptores que solo emiten un juicio, redactados en negativo, niveles que se diferencian por adverbios o criterios que mezclan dos aspectos. Son sugerencias, nunca bloqueos.',
  },
  {
    target: 'exam-new',
    view: 'teachingExams',
    title: 'Configurar un examen',
    body: 'Un examen es aquí un documento imprimible. Eliges cabecera, logotipos y duración, y añades preguntas de trece tipos: desarrollo, definición, cuestionario, verdadero o falso, relacionar, ordenar, imagen o problema.',
  },
  {
    target: 'exam-list',
    view: 'teachingExams',
    title: 'Enunciados comunes y descargas',
    body: 'Un enunciado de sección agrupa varias preguntas y se numera 2.1, 2.2…, sin puntuar por sí mismo: su nota es la suma de sus partes. Descárgalo en Word o PDF como examen, con solucionario o solo el solucionario.',
  },
  {
    target: 'plan-new',
    view: 'teachingGrades',
    title: 'El cuaderno de calificaciones',
    body: 'Un cuaderno parte de un plan de evaluación, que es tu programación: bloques, actividades y pesos. Al publicarlo queda congelado, y revisarlo crea una versión nueva, de modo que cualquier nota se puede recalcular con las reglas que estaban vigentes.',
  },
  {
    target: 'plan-table',
    view: 'teachingGrades',
    title: 'La nota es una proyección',
    body: 'Lo que se guarda es un valor y un estado —evaluado, no entregado, sin evaluar o exento—, y cada estado reparte los pesos de otra forma. La nota numérica o el término cualitativo se derivan de ahí según las reglas que tú configuras.',
  },
  {
    title: 'Lo que todavía está en diseño',
    body: 'Las secciones del grupo «Crear» —guía docente, unidades didácticas, situaciones de aprendizaje, adaptaciones— aún no existen: ábrelas para contarme qué necesitas antes de que se construyan. Puedes repetir este tutorial desde Ajustes.',
  },
];

export function TeachingTour({ onClose, onNavigate }: { onClose: () => void; onNavigate: (view: View) => void }) {
  return (
    <TourOverlay
      steps={STEPS}
      label="Tutorial de docencia"
      accent={VAULT_TYPE_COLORS.docencia}
      onClose={onClose}
      onNavigate={(view) => onNavigate(view as View)}
    />
  );
}
