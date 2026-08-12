import { TourOverlay, type TourStep } from './tourEngine';

type ViewId = 'library' | 'graph' | 'gaps' | 'reading' | 'settings' | 'search' | 'ideas' | 'notes';

/**
 * First-run usage tour. Distinct from the setup Onboarding: this teaches how to
 * *use* the app on the real UI — most importantly, how to add a work to the graph.
 * Steps spotlight live elements tagged with `data-tour`; target-less steps are centered.
 */
const STEPS: TourStep[] = [
  {
    title: '¡Bienvenido a Nodus!',
    body: '¿Es tu primera vez? En menos de un minuto te enseño cómo convertir la Biblioteca de Nodus o tu biblioteca de Zotero en un grafo de ideas. Puedes saltártelo cuando quieras.',
  },
  {
    target: 'vault-badge',
    title: 'Bóvedas independientes',
    body: 'Cada bóveda es un espacio separado: biblioteca, grafo, notas, proyectos, chats, ajustes, embeddings y claves API pueden vivir aislados. Pulsa esta insignia para crear otra, cambiar de bóveda o cargar claves desde una bóveda anterior.',
  },
  {
    target: 'nav-graph',
    view: 'graph',
    title: 'El grafo de ideas',
    body: 'Es el corazón de Nodus. Cada nodo es una idea extraída de tus lecturas y cada arista una relación entre ellas. Empieza vacío: se llena a medida que escaneas obras a fondo.',
  },
  {
    target: 'sync',
    title: 'Dos formas de añadir obras',
    body: 'Biblioteca acepta archivos, DOI, ISBN, referencias manuales e importaciones. Si ya usas Zotero, este botón sincroniza tus colecciones monitorizadas en modo solo lectura.',
  },
  {
    // Sin ancla: Colecciones ya no tiene icono propio en la cabecera. Se abre desde la
    // paleta de comandos, que no es un elemento que se pueda señalar en pantalla.
    title: 'Organiza a tu manera',
    body: 'Crea colecciones y subcolecciones propias dentro de Biblioteca. También puedes mantener la estructura de Zotero como fuente de solo lectura y combinar ambos sistemas sin perder tus cambios de Nodus.',
  },
  {
    target: 'nav-library',
    view: 'library',
    title: 'Tu biblioteca',
    body: 'Global reúne referencias, archivos y colecciones de todos tus vaults. Este vault conserva el corpus tradicional y sus estados de análisis. Puedes usar solo Nodus, solo Zotero o combinar ambos.',
  },
  {
    target: 'library-actions',
    view: 'library',
    title: 'Añadir una obra al grafo',
    body: 'Pulsa «Analizar» en la fila de una obra, o selecciona varias y analízalas juntas. Nodus lee el texto, extrae temas padre, ideas con evidencia y relaciones, y las añade al grafo. La columna Estado te dice en qué punto va cada obra.',
  },
  {
    target: 'nav-ideas',
    view: 'ideas',
    title: 'Verificar ideas extraídas',
    body: 'Cada idea aparece con su tipo (afirmación, hallazgo, constructo, método o marco), la obra de la que procede y la cita textual que la sostiene. Abre el detalle para comprobar si la lectura automática coincide con la tuya.',
  },
  {
    target: 'queue',
    title: 'La cola de escaneo',
    body: 'Sigue aquí el progreso. Si falta el modelo de IA o la clave, la cola se pausa y te avisa en vez de fallar en silencio: lo arreglas en Ajustes y pulsas «Reanudar».',
  },
  {
    target: 'model',
    title: 'Modelo de IA',
    body: 'Comprueba que hay un modelo seleccionado: sin él, Nodus no puede escanear. Puedes cambiarlo aquí o en Ajustes, y marcar tus favoritos.',
  },
  {
    target: 'nav-search',
    view: 'search',
    title: 'Búsqueda global',
    body: 'Busca por palabras clave a través de ideas, obras, huecos, temas, autores y notas. Los resultados te llevan directamente al detalle correspondiente en cada vista.',
  },
  {
    target: 'nav-notes',
    view: 'notes',
    title: 'Tu espacio de notas',
    body: 'Crea carpetas y notas en Markdown. Captura respuestas del asistente, borradores del taller de escritura, síntesis de debates e ideas individuales. Las citas internas (nodus://) permanecen clicables.',
  },
  {
    title: 'Y hay mucho más',
    body: 'Esto es solo la mecánica básica. Nodus incluye también Autores (fichas y matriz de síntesis), un Laboratorio de hipótesis, Mapa de argumentos, Debates, Cobertura de tu pregunta, Ruta de lectura, un Taller de escritura con Deep Research y Proyectos de manuscrito con verificador de citas. ¿Quieres el recorrido completo de este flujo? Lánzalo desde Ajustes → Ayuda → Tutorial avanzado.',
  },
  {
    title: '¡Listo para empezar!',
    body: 'Explora el grafo, descubre huecos de investigación y sigue la ruta de lectura sugerida. Podrás volver a ver este recorrido desde Ajustes cuando quieras.',
  },
];

export function Tour({ onClose, onNavigate }: { onClose: () => void; onNavigate: (v: ViewId) => void }) {
  return (
    <TourOverlay
      steps={STEPS}
      vaultType="academic"
      onClose={onClose}
      onNavigate={(v) => onNavigate(v as ViewId)}
    />
  );
}
