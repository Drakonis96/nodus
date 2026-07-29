import { VAULT_TYPE_COLORS } from '@shared/vaultTypes';
import type { View } from '../navigation';
import { TourOverlay, type TourStep } from './tourEngine';

/**
 * Method-first orientation for the Prosopography workspace.
 *
 * Prosopography used to fall through to the academic/Zotero tour. Keeping its own
 * steps avoids teaching an unrelated workflow and gives the future video tutorial a
 * stable place in the same opening card as every other dedicated vault.
 */
const STEPS: TourStep[] = [
  {
    title: 'Prosopografía',
    body: 'Prosopografía estudia una población histórica sin separar los datos de la evidencia que los sostiene.',
  },
  {
    target: 'nav-prosopPopulation',
    view: 'prosopPopulation',
    title: 'Población antes que fichas',
    body: 'Define quién entra, qué preguntas se formulan y cómo se codifican las respuestas.',
  },
  {
    target: 'nav-prosopSources',
    view: 'prosopSources',
    title: 'Evidencia antes que resumen',
    body: 'Cada observación vuelve a un segmento citable de una fuente.',
  },
  {
    target: 'nav-prosopPersons',
    view: 'prosopPersons',
    title: 'Mención antes que identidad',
    body: 'Toda afirmación vuelve a su fuente y conserva incertidumbre, contradicción y literal.',
  },
  {
    target: 'nav-prosopAnalysis',
    view: 'prosopAnalysis',
    title: 'Análisis con denominador',
    body: 'Cada resultado declara población, denominador, ausencias y huella de entrada.',
  },
  {
    target: 'nav-prosopNetworks',
    view: 'prosopNetworks',
    title: 'Redes por origen',
    body: 'Lo documentado, lo derivado y las hipótesis se muestran con gramáticas visuales distintas.',
  },
];

export function ProsopographyTour({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (view: View) => void;
}) {
  return (
    <TourOverlay
      steps={STEPS}
      label="Prosopografía"
      vaultType="prosopography"
      showUnavailableVideo
      accent={VAULT_TYPE_COLORS.prosopography}
      onClose={onClose}
      onNavigate={(view) => onNavigate(view as View)}
    />
  );
}
