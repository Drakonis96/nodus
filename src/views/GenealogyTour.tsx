import type { View } from '../navigation';
import { TourOverlay, type TourStep } from './tourEngine';

/**
 * The genealogy-specific guided tour, shown in the genealogy demo. Where the general
 * Tour teaches the Zotero→graph mechanics, this walks a genealogist through the whole
 * family-history workflow on the seeded Serrano–Vidal data: the tree, person fichas
 * with cited evidence, the evidence-driven kinship suggestions (the AI proposes, you
 * dispose), the Timeline, the evidence Archive with document↔person discovery, the
 * offline Map, GEDCOM interchange and period portraits.
 */
const STEPS: TourStep[] = [
  {
    title: 'Bienvenido al modo genealogía',
    body: 'Estás viendo Nodus con una familia de ejemplo, los Serrano–Vidal (Andalucía, siglo XIX). Todo está poblado: árbol, personas, documentos, evidencia y sugerencias de la IA. En un minuto te enseño cada pieza. Puedes salir cuando quieras.',
  },
  {
    target: 'nav-tree',
    view: 'tree',
    title: 'El árbol genealógico',
    body: 'Cuatro generaciones dispuestas por generación, con cónyuges juntos y retratos enmarcados. Haz doble clic en una persona para recentrar el árbol en ella, y abre su ficha completa desde el nodo.',
  },
  {
    target: 'nav-persons',
    view: 'persons',
    title: 'Fichas de persona',
    body: 'Cada persona reúne su parentesco, sus eventos, los documentos vinculados y la EVIDENCIA citada que la respalda. Puedes generar una biografía factual con un clic: se escribe solo a partir de la evidencia, sin inventar.',
  },
  {
    target: 'kin-suggestions',
    view: 'persons',
    title: 'Parentescos sugeridos por la IA',
    body: 'Aquí está el corazón de Nodus: la IA PROPONE parentescos a partir de la evidencia de las fuentes (una partida que nombra a los padres, un acta de matrimonio), pero nunca los añade sola al árbol. Revísalos con su cita literal y confírmalos o descártalos. Una simple coincidencia de nombres jamás crea un parentesco.',
  },
  {
    target: 'nav-timeline',
    view: 'timeline',
    title: 'Línea temporal',
    body: 'Todos los eventos de la familia ordenados en el tiempo, con fechas inciertas incluidas («hacia 1850»). Filtra por persona o por tipo de evento para seguir una vida o un lugar.',
  },
  {
    target: 'nav-archive',
    view: 'archive',
    title: 'Archivo de evidencias',
    body: 'Tus fuentes primarias —partidas, censos, diarios, cartas, fotografías— clasificadas por tipo documental y con sus metadatos, vinculadas a las personas que mencionan. La IA sugiere qué documento trata sobre quién (por nombre y por similitud). Es tu archivo, local; la bibliografía académica vive en la Biblioteca (Zotero).',
  },
  {
    target: 'nav-map',
    view: 'map',
    title: 'Mapa de lugares y migraciones',
    body: 'Los lugares de la familia y sus movimientos (Carmona → Sevilla), dibujados sobre un mapa offline, sin depender de servidores de mapas.',
  },
  {
    target: 'kin-suggestions',
    view: 'persons',
    title: 'GEDCOM: entra y sal cuando quieras',
    body: 'Importa un árbol GEDCOM desde Gramps o Ancestry, o exporta el tuyo, desde los botones de esta columna. Nodus complementa a tus herramientas; no te encierra.',
  },
  {
    title: 'Retratos de época',
    body: 'Los rostros son daguerrotipos en blanco y negro generados con un modelo de imagen económico, con la cara centrada en el marco. En cualquier ficha puedes sustituirlos por una fotografía real y encuadrarla arrastrando.',
  },
  {
    title: 'La IA propone; tú decides',
    body: 'Recuerda: ninguna relación entra en el árbol sin tu confirmación, cada dato lleva su evidencia y la IA nunca inventa parentescos. Cuando quieras empezar con tu propia familia, sal del modo demo desde la cabecera: se borrarán los datos de ejemplo.',
  },
];

export function GenealogyTour({ onClose, onNavigate }: { onClose: () => void; onNavigate: (v: View) => void }) {
  return (
    <TourOverlay
      steps={STEPS}
      label="Tutorial de genealogía"
      onClose={onClose}
      onNavigate={(v) => onNavigate(v as View)}
    />
  );
}
