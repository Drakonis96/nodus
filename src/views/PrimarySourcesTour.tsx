import type { View } from '../navigation';
import { VAULT_TYPE_COLORS } from '@shared/vaultTypes';
import { TourOverlay, type TourStep } from './tourEngine';

/** Six-step, relaunchable orientation from archive to evidence-backed conclusion. */
export const PRIMARY_SOURCES_TOUR_STEPS: TourStep[] = [
  {
    target: 'nav-archive',
    view: 'archive',
    title: '1. El Archivo es el centro',
    body: 'Empieza en el Archivo: aquí conviven la descripción archivística, las representaciones digitales, los textos y la trazabilidad. Personas, fechas, mapas, relaciones y notas son vistas derivadas que siempre deben poder volver a una fuente.',
  },
  {
    target: 'primary-sources-import',
    view: 'archive',
    title: '2. Importa sin perder procedencia',
    body: 'Al añadir una fuente, conserva repositorio, signatura, unidad padre y sesión de captura. Nodus calcula el hash del máster y separa la ubicación archivística de tus colecciones personales de trabajo.',
  },
  {
    target: 'primary-sources-provenance-tree',
    view: 'archive',
    title: '3. La jerarquía no es una carpeta temática',
    body: 'Fondo, serie, expediente y documento expresan el contexto de producción y custodia. Las colecciones de trabajo sirven para organizar una investigación, pero nunca reescriben esa jerarquía.',
  },
  {
    target: 'primary-sources-view-modes',
    view: 'archive',
    title: '4. Preserva el original; trabaja en derivados y texto',
    body: 'El máster permanece inmutable. Las copias de acceso, miniaturas, OCR y transcripciones son versiones relacionadas y revisables. Una corrección crea una versión hija: no borra la lectura anterior.',
  },
  {
    target: 'nav-persons',
    view: 'persons',
    title: '5. Acepta propuestas antes de convertirlas en hechos',
    body: 'Las extracciones automáticas son propuestas, nunca hechos confirmados. Revisa la forma literal, la identidad, la certeza y el fragmento citado; acepta, aplaza o rechaza dejando una decisión trazable.',
  },
  {
    target: 'nav-notes',
    view: 'notes',
    title: '6. Vuelve de la conclusión a la evidencia',
    body: 'Enlaza cada hipótesis o conclusión con un fragmento estable y su localizador. Si encuentras una contradicción, conserva ambas evidencias y su incertidumbre: una nota interpretativa no sustituye lo que dice la fuente.',
  },
];

export function PrimarySourcesTour({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (view: View) => void;
}) {
  return (
    <TourOverlay
      steps={PRIMARY_SOURCES_TOUR_STEPS}
      label="Recorrido de fuentes primarias"
      vaultType="primary_sources"
      showUnavailableVideo
      accent={VAULT_TYPE_COLORS.primary_sources}
      onClose={onClose}
      onNavigate={(view) => onNavigate(view as View)}
    />
  );
}
