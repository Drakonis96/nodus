import { Icon } from './ui';
import { t } from '../i18n';
import { orderSidebarItems } from '../navigation';

/** Las secciones que el vault de Testimonios tiene cableadas. */
export type TestimonyView =
  | 'search'
  | 'testimonyInterviews'
  | 'testimonyParticipants'
  | 'testimonyContrasts'
  | 'notes';

export interface TestimonyItem { label: string; icon: string; view: TestimonyView }
export interface TestimonyGroup { id: string; label: string; items: TestimonyItem[] }

/**
 * El menú del investigador de historia oral. Cinco entradas, y ninguna más.
 *
 * La regla que organiza el vault entero: **el trabajo específico sucede dentro de cada
 * entrevista; solo sale al menú lo que atraviesa varias entrevistas.** Por eso aquí no
 * hay Grabaciones, ni Transcripciones, ni Fragmentos, ni «Temas y códigos»: todo eso
 * existe — con su catálogo compartido a nivel de bóveda — pero se usa desde el dossier
 * de la entrevista, que es donde el investigador está mirando cuando lo necesita.
 * Sacarlo al menú reproduciría exactamente la fragmentación entre carpetas, grabadora
 * y programa de análisis que este vault existe para deshacer.
 *
 * «Registrar» y no «Escribir»: un grupo llamado Escribir que solo contuviera Notas
 * prometería un taller de escritura que este vault no ofrece.
 *
 * Se exporta porque Ajustes pinta esta misma agrupación cuando el usuario reordena u
 * oculta secciones; una sola lista impide que el configurador y el sidebar se separen.
 */
export const TESTIMONY_GROUPS: TestimonyGroup[] = [
  { id: 'explore', label: 'Explorar', items: [
    { label: 'Buscar', icon: 'search', view: 'search' },
    { label: 'Entrevistas', icon: 'microphone', view: 'testimonyInterviews' },
    { label: 'Participantes', icon: 'users', view: 'testimonyParticipants' },
  ] },
  { id: 'analyze', label: 'Analizar', items: [
    { label: 'Contrastes', icon: 'scale', view: 'testimonyContrasts' },
  ] },
  { id: 'register', label: 'Registrar', items: [
    { label: 'Notas', icon: 'notebook', view: 'notes' },
  ] },
];

export function TestimonySidebar({
  compact = false,
  activeView,
  onNavigate,
  sidebarOrder = [],
  sidebarHidden = [],
}: {
  compact?: boolean;
  activeView: string;
  onNavigate: (view: TestimonyView) => void;
  sidebarOrder?: string[];
  sidebarHidden?: string[];
}) {
  return (
    <div data-testid="testimony-sidebar" className="flex flex-col gap-1">
      {TESTIMONY_GROUPS.map((group) => {
        const items = orderSidebarItems(
          group.items.map((item) => ({ ...item, id: item.view })),
          sidebarOrder,
        ).filter((item) => !sidebarHidden.includes(item.id));
        if (items.length === 0) return null;
        return (
          <section key={group.id} className={`${compact ? 'mt-1 border-t border-neutral-800/70 pt-1' : 'mt-2'} flex flex-col gap-1`}>
            <h2 className={compact ? 'sr-only' : 'px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600'}>
              {t(group.label)}
            </h2>
            {items.map((item) => (
              <button
                key={item.id}
                data-tour={`nav-${item.view}`}
                onClick={() => onNavigate(item.view)}
                aria-label={compact ? t(item.label) : undefined}
                title={compact ? t(item.label) : undefined}
                className={`flex items-center rounded-lg py-2 text-left text-sm ${compact ? 'justify-center px-2' : 'gap-2 px-3'} ${
                  activeView === item.view
                    ? 'bg-indigo-600 text-white'
                    : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
                }`}
              >
                <Icon name={item.icon} className="shrink-0" />
                <span className={compact ? 'sr-only' : undefined}>{t(item.label)}</span>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}
