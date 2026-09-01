import { TourOverlay, type TourStep } from './tourEngine';

type ViewId = 'library' | 'graph' | 'ideas' | 'workspace';

/**
 * First-run usage tour. Distinct from the setup Onboarding: this teaches how to
 * *use* the app on the real UI — most importantly, how to add a work to the graph.
 * Steps spotlight live elements tagged with `data-tour`; target-less steps are centered.
 */
export const ACADEMIC_TOUR_STEPS: TourStep[] = [
  {
    title: 'Bienvenido a tu vault académico',
    body: 'Aunque veas muchas opciones, para empezar solo necesitas una ruta: Biblioteca → Ideas → Grafo. En un minuto harás ese recorrido; puedes saltarlo o repetirlo desde Ajustes cuando quieras.',
  },
  {
    target: 'vault-badge',
    title: 'Empieza por una sola ruta',
    body: 'Este distintivo indica en qué vault estás. Cada vault separa un proyecto de los demás, para que sus fuentes, análisis y borradores no se mezclen. Úsalo solo cuando quieras cambiar de proyecto o crear otro.',
  },
  {
    target: 'nav-library',
    view: 'library',
    title: 'Biblioteca: dos ámbitos, una decisión',
    body: 'Global guarda las fuentes disponibles para todos tus proyectos; «Este vault» muestra solo las que participan aquí. Puedes añadir archivos, DOI, ISBN o referencias manuales, o sincronizar Zotero. No necesitas configurar todas las opciones para comenzar.',
  },
  {
    target: 'library-scope',
    view: 'library',
    title: 'Analiza solo lo que necesites',
    body: 'Añade una fuente al vault y cambia a «Este vault». Allí selecciona una o varias obras y pulsa «Analizar». Nodus extraerá temas, ideas, evidencia y relaciones. Empieza con una sola fuente: siempre podrás analizar más después.',
  },
  {
    title: 'La cola te cuenta qué ocurre',
    body: 'La barra inferior muestra el progreso de los análisis. Puedes seguir usando Nodus mientras trabaja. Si falta un modelo o una clave de IA, la tarea se pausa y te indica qué revisar en Ajustes; no tienes que adivinar qué falló.',
  },
  {
    target: 'nav-ideas',
    view: 'ideas',
    title: 'Comprueba antes de confiar',
    body: 'Ideas reúne lo extraído de tus lecturas. Abre una idea y revisa la cita o el pasaje que la sostiene. La IA ayuda a leer, pero la fuente sigue siendo la autoridad: esta comprobación es el hábito más importante del vault académico.',
  },
  {
    target: 'nav-graph',
    view: 'graph',
    title: 'Las conexiones aparecen después',
    body: 'Grafo muestra cada idea como un nodo y sus relaciones como enlaces. Al principio puede estar vacío o ser pequeño: es normal. Se vuelve útil a medida que analizas fuentes verificadas, no antes.',
  },
  {
    target: 'nav-workspace',
    view: 'workspace',
    title: 'Escribe sin salir del corpus',
    body: 'Espacio de trabajo reúne notas, borradores y proyectos de escritura. Conserva los enlaces internos a fuentes e ideas para que puedas volver a la evidencia mientras redactas. No hace falta usarlo hasta que tengas algo que desarrollar.',
  },
  {
    title: 'Lo demás puede esperar',
    body: 'El menú agrupa funciones por intención: Explorar, Analizar, Escribir y Herramientas. Ábrelas cuando tu investigación las necesite; en Ajustes puedes ocultar o reordenar secciones. Tu primera misión es sencilla: añade una fuente, analízala y verifica una idea.',
  },
];

export function Tour({ onClose, onNavigate }: { onClose: () => void; onNavigate: (v: ViewId) => void }) {
  return (
    <TourOverlay
      steps={ACADEMIC_TOUR_STEPS}
      vaultType="academic"
      onClose={onClose}
      onNavigate={(v) => onNavigate(v as ViewId)}
    />
  );
}
