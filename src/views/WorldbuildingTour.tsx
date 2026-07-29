import { VAULT_TYPE_COLORS } from '@shared/vaultTypes';
import type { View } from '../navigation';
import { TourOverlay, type TourStep } from './tourEngine';

/**
 * A compact first orientation for the Worldbuilding workspace.
 *
 * The copy deliberately reuses the established, translated explanations from the
 * workspace itself. The future video route is visible now, but remains disabled until
 * the catalogue publishes a video whose vaultType is `worldbuilding`.
 */
const STEPS: TourStep[] = [
  {
    title: 'Tu mundo',
    body: 'Construye un mundo de ficción pieza a pieza: personajes, lugares, facciones, culturas, escenas y mapas. La enciclopedia los reúne todos en un solo índice y te deja escribir el resto del mundo —la magia, una religión, una lengua— enlazándolo con [[dobles corchetes]].',
  },
  {
    target: 'nav-encyclopedia',
    view: 'encyclopedia',
    title: 'Enciclopedia',
    body: 'Construye un mundo de ficción pieza a pieza: personajes, lugares, facciones, culturas, escenas y mapas. La enciclopedia los reúne todos en un solo índice y te deja escribir el resto del mundo —la magia, una religión, una lengua— enlazándolo con [[dobles corchetes]].',
  },
  {
    target: 'nav-characters',
    view: 'characters',
    title: 'Personajes',
    body: 'Todavía no hay personajes en este mundo.',
  },
  {
    target: 'nav-worldChat',
    view: 'worldChat',
    title: 'Chat del mundo',
    body: 'Nodus reúne personajes, lugares, reglas, conflictos y escenas para responder sin inventar canon.',
  },
  {
    target: 'nav-scenes',
    view: 'scenes',
    title: 'Escenas',
    body: 'El año es cuándo ocurre en el mundo; el orden es dónde va en el relato. Un prólogo ambientado siglos antes va primero en el relato y último en la cronología.',
  },
  {
    target: 'nav-manuscript',
    view: 'manuscript',
    title: 'Manuscrito',
    body: 'El manuscrito son tus escenas en orden de relato. Crea la primera en Escenas y aquí la escribes.',
  },
];

export function WorldbuildingTour({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (view: View) => void;
}) {
  return (
    <TourOverlay
      steps={STEPS}
      label="Worldbuilding"
      vaultType="worldbuilding"
      showUnavailableVideo
      accent={VAULT_TYPE_COLORS.worldbuilding}
      onClose={onClose}
      onNavigate={(view) => onNavigate(view as View)}
    />
  );
}
