import type { View } from '../navigation';
import { TourOverlay, type TourStep } from './tourEngine';

/**
 * El recorrido del vault de Testimonios, sobre la demo «Memoria del valle».
 *
 * Sigue el orden del trabajo real —qué es una entrevista, quién participa, qué se grabó,
 * qué dice, qué pienso, qué se puede hacer con ello— y no el orden del menú. Los dos
 * pasos que no son «aquí está el botón» son deliberados: el que explica que el original y
 * el literal no se tocan, y el que explica que el acuerdo, el acceso y el flujo son ejes
 * distintos. Sin esos dos, todo lo demás parece un gestor de archivos con transcripción.
 */
const STEPS: TourStep[] = [
  {
    title: 'Bienvenido al vault de Testimonios',
    body: 'Este modo está hecho para historia oral y periodismo. Su unidad no es la grabación ni la transcripción: es LA ENTREVISTA, con su preparación, sus participantes, sus sesiones, sus archivos, sus transcripciones y el acuerdo con el que se hizo. Te enseño el recorrido con un proyecto de ejemplo ya cargado. Puedes salir cuando quieras y volver desde Ajustes.',
  },
  {
    target: 'nav-testimonyInterviews',
    view: 'testimonyInterviews',
    title: 'Las entrevistas',
    body: 'Aquí están todas, con su estado de trabajo, su transcripción, su acuerdo y su acceso en columnas separadas. Las pestañas de arriba son las siete preguntas que uno se hace al abrir el proyecto: qué tengo próximo, qué falta transcribir, qué espera al narrador, qué lleva restricciones.',
  },
  {
    target: 'nav-testimonyParticipants',
    view: 'testimonyParticipants',
    title: 'Quién cuenta',
    body: 'Cada persona tiene un nombre de trabajo —el que usas tú— y un nombre público. Esa separación es la que hace posible anonimizar sin perder de vista con quién hablaste: el nombre real no sale nunca en una cita, una exportación o un prompt si el acuerdo no lo permite. Nodus no guarda datos de contacto: no es una agenda.',
  },
  {
    target: 'nav-testimonyInterviews',
    view: 'testimonyInterviews',
    title: 'Una entrevista, varias sesiones',
    body: 'Abre una entrevista y verás su dossier. Una historia de vida no cabe en una tarde: puede tener varias sesiones, cada una con su grabación, su lugar y sus notas de campo. Puedes grabar dentro de Nodus o importar lo que traigas de la grabadora.',
  },
  {
    target: 'nav-testimonyInterviews',
    view: 'testimonyInterviews',
    title: 'El original no se corrige',
    body: 'El archivo entra tal y como se recibió, con su huella SHA-256, y se marca inmutable. La transcripción automática tampoco se toca: corregir, revisar, aprobar, anonimizar o traducir CREA UNA VERSIÓN NUEVA que recuerda de cuál viene. Así, meses después, sigue siendo posible saber qué oyó el modelo y qué decidiste tú. Y aquí no se recortan silencios: una pausa puede ser parte de lo que se está contando.',
  },
  {
    target: 'nav-testimonyInterviews',
    view: 'testimonyInterviews',
    title: 'Codificar y citar',
    body: 'En la pestaña Análisis seleccionas un pasaje y le pones códigos. El fragmento guarda el texto, el tiempo y su versión, así que la cita siempre puede volver al audio. Los códigos se crean desde aquí pero se guardan para toda la bóveda: por eso no hay una sección «Temas y códigos» en el menú.',
  },
  {
    target: 'nav-notes',
    view: 'notes',
    title: 'Las notas son tuyas',
    body: 'Desde un fragmento puedes crear una nota que ya trae la cita, el hablante, el minuto y un enlace de vuelta. La nota es interpretación; la transcripción es material. Por eso viven separadas, y por eso una nota sobrevive aunque su fragmento desaparezca.',
  },
  {
    target: 'nav-testimonyContrasts',
    view: 'testimonyContrasts',
    title: 'Contrastar sin decidir quién tiene razón',
    body: 'Eliges varias entrevistas y uno o varios códigos, y Nodus pone los fragmentos uno al lado de otro con su narrador y su minuto. Marca lo que comparten, lo que difiere y — esto importa — qué entrevistas no dijeron nada, sin convertir esa ausencia en una conclusión. Todo funciona sin IA.',
  },
  {
    target: 'nav-testimonyInterviews',
    view: 'testimonyInterviews',
    title: 'Acuerdo, acceso y flujo son cosas distintas',
    body: 'En la pestaña «Acuerdo y acceso» se documenta qué se explicó y qué se autorizó. Cada cambio crea una versión fechada, porque un narrador puede ampliar los usos, pedir un embargo o retirarlo todo. Y esas condiciones tienen efecto de verdad: bloquean exportaciones, paquetes de consulta y lo que la IA puede ver.',
  },
  {
    target: 'nav-search',
    view: 'search',
    title: 'Buscar y preservar',
    body: 'Buscar una frase devuelve el pasaje con su hablante, su minuto y su condición de acceso, y abre la entrevista exacta. En Inicio verás lo que requiere atención — acuerdos sin documentar, transcripciones sin revisar, embargos que vencen — y el estado de preservación. Guardar el audio dentro de la bóveda no es, por sí solo, preservación a largo plazo: hace falta una copia fuera de este equipo.',
  },
  {
    title: 'Tu proyecto',
    body: 'Esto es una demostración con material ficticio y audio sintético; no hay ninguna voz real. Cuando quieras empezar con lo tuyo, crea una entrevista: el audio, la transcripción y el acuerdo vienen después. Puedes borrar la demo desde Ajustes.',
  },
];

export function TestimonyTour({ onClose, onNavigate }: { onClose: () => void; onNavigate: (v: View) => void }) {
  return (
    <TourOverlay
      steps={STEPS}
      label="Tutorial de testimonios"
      vaultType="testimonios"
      showUnavailableVideo
      onClose={onClose}
      onNavigate={(v) => onNavigate(v as View)}
    />
  );
}
