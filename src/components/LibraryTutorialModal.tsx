import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import { Icon } from './ui';
import { NodiAvatar } from './nodi/NodiAvatar';
import nodusLogo from '../assets/nodus-logo.svg';
import zoteroMark from '../assets/nodus-logo-zotero.svg';
import wordLogo from '../assets/brands/microsoft-word.svg';
import chromeLogo from '../assets/brands/chrome-web-store.svg';

/**
 * The Library greeting: two tabs, because the section really is two products.
 * One tab is the analysis pipeline that turns a vault into a graph; the other is
 * the standalone reference manager, which is in beta and says so.
 *
 * Everyone meets it once, the first time they open Biblioteca; the flag below is
 * written the moment it is presented, so it never queues twice. The «?» button in
 * the Library header is the way back in, and that one ignores the flag.
 */
export const LIBRARY_TUTORIAL_SEEN_KEY = 'nodus.libraryTutorialSeen.v1';

export type LibraryTutorialTab = 'analysis' | 'manager';

export function libraryTutorialSeen(): boolean {
  // Storage can be unavailable (a locked-down profile). Treating that as "seen"
  // is the safe failure: a guide that cannot remember being shown would open on
  // every single visit to the section.
  try { return localStorage.getItem(LIBRARY_TUTORIAL_SEEN_KEY) === '1'; } catch { return true; }
}

export function markLibraryTutorialSeen(): void {
  try { localStorage.setItem(LIBRARY_TUTORIAL_SEEN_KEY, '1'); } catch { /* nothing to remember it with */ }
}

function SourceCard({ logo, name, badge, badgeTone, children }: {
  logo: string;
  name: string;
  badge: string;
  badgeTone: 'beta' | 'recommended';
  children: ReactNode;
}) {
  return (
    <div className="library-tutorial-source">
      <span className="library-tutorial-brand"><img src={logo} alt="" /></span>
      <div>
        <span className="library-tutorial-source-heading">
          <b>{name}</b>
          <em className={badgeTone === 'beta' ? 'is-beta' : 'is-recommended'}>{badge}</em>
        </span>
        <small>{children}</small>
      </div>
    </div>
  );
}

function Step({ number, title, badge, children }: { number: number; title: string; badge?: string; children: ReactNode }) {
  return (
    <section className="library-tutorial-step">
      <span className="library-tutorial-step-number" aria-hidden="true">{number}</span>
      <div>
        <h4>{title}{badge && <em className="library-tutorial-step-badge">{badge}</em>}</h4>
        {children}
      </div>
    </section>
  );
}

function AnalysisTab() {
  return (
    <div className="library-tutorial-panel" data-testid="library-tutorial-panel-analysis">
      <p className="toolkit-guide-summary">{t('En «Este vault» reúnes las obras que quieres analizar. Cada una queda vinculada al vault y alimenta sus ideas, sus temas y sus conexiones.')}</p>

      <Step number={1} title={t('Abre «Colecciones»')}>
        <p>{t('Pulsa «Colecciones» en la cabecera y elige de dónde vienen tus obras.')}</p>
        <div className="library-tutorial-sources">
          <SourceCard logo={nodusLogo} name={t('Colecciones de Nodus')} badge="BETA" badgeTone="beta">
            {t('La biblioteca propia de Nodus, compartida por todos tus vaults.')}
          </SourceCard>
          <SourceCard logo={zoteroMark} name={t('Colecciones de Zotero')} badge={t('Recomendado')} badgeTone="recommended">
            {t('Tu biblioteca de Zotero en modo solo lectura: Nodus nunca escribe en ella.')}
          </SourceCard>
        </div>
      </Step>

      <Step number={2} title={t('Elige qué colecciones seguir')}>
        <p>{t('En Zotero, pulsa «Monitorizar» en cada colección que quieras traer. Nodus sincroniza esas obras en este vault y mantiene la lista al día.')}</p>
        <div className="library-tutorial-chips">
          <span><Icon name="folder" size={13} /> {t('Colecciones')}</span>
          <Icon name="arrowRight" size={13} className="library-tutorial-arrow" />
          <span><Icon name="check" size={13} /> {t('Monitorizar')}</span>
        </div>
      </Step>

      <Step number={3} title={t('Vuelve a «Este vault» y procesa')}>
        <div className="library-tutorial-actions">
          <div>
            <b><Icon name="compass" size={13} /> {t('Analizar las seleccionadas')}</b>
            <small>{t('Selecciona una o varias obras y pulsa «Analizar las seleccionadas» para procesar solo esas.')}</small>
          </div>
          <div>
            <b><Icon name="compass" size={13} /> {t('Procesar biblioteca')}</b>
            <small>{t('O pulsa «Procesar biblioteca» para lanzar todas las obras que pasen los filtros actuales.')}</small>
          </div>
        </div>
        <div className="toolkit-guide-notice">
          <Icon name="bulb" size={16} />
          <span>{t('En los dos casos Nodus extrae temas e ideas, redacta el resumen, indexa el texto citable y descubre relaciones entre obras.')}</span>
        </div>
      </Step>

      <Step number={4} title={t('Para qué sirve el «Índice documental»')} badge="BETA">
        <p>{t('Es la lectura profunda de un documento entero: Nodus recorre todo el texto, reconstruye su estructura por capítulos y secciones y deja un índice que el asistente puede consultar. Se gestiona desde el botón de la cabecera.')}</p>
        <p>{t('Está en beta: en documentos muy largos puede tardar bastante y no siempre acierta con la estructura.')}</p>
      </Step>
    </div>
  );
}

function ManagerTab() {
  return (
    <div className="library-tutorial-panel" data-testid="library-tutorial-panel-manager">
      <p className="toolkit-guide-summary">{t('La Biblioteca de Nodus funciona también como gestor bibliográfico independiente: guarda, organiza y cita tus referencias aunque no analices nada.')}</p>

      <div className="toolkit-guide-notice toolkit-guide-notice-warning" data-testid="library-tutorial-beta-notice">
        <Icon name="alert" size={16} />
        <span><b>BETA · </b>{t('Esta función está en beta: puede tener errores o comportamientos inesperados. Conserva una copia de seguridad de tu bibliografía.')}</span>
      </div>

      <div className="library-tutorial-cards">
        <div>
          <span><Icon name="refresh" size={17} /></span>
          <div>
            <b>{t('Importar desde Zotero')}</b>
            <small>{t('Trae colecciones, referencias y adjuntos de tu biblioteca de Zotero.')}</small>
          </div>
        </div>
        <div>
          <span><Icon name="plus" size={17} /></span>
          <div>
            <b>{t('Añadir a mano')}</b>
            <small>{t('Arrastra archivos, busca por DOI, ISBN o arXiv, importa RIS o BibTeX o crea la ficha a mano.')}</small>
          </div>
        </div>
        <div>
          <span><Icon name="tag" size={17} /></span>
          <div>
            <b>{t('Organizar y citar')}</b>
            <small>{t('Colecciones propias, etiquetas, búsquedas guardadas y exportación de citas.')}</small>
          </div>
        </div>
      </div>

      <h4 className="library-tutorial-subheading">{t('Además, llega a donde trabajas')}</h4>
      <div className="library-tutorial-integrations">
        <div data-testid="library-tutorial-word">
          <span className="library-tutorial-brand"><img src={wordLogo} alt="" /></span>
          <div>
            <b>{t('Complemento para Word')}</b>
            <small>{t('Escribe en Word con tus referencias e ideas de Nodus al lado e inserta citas sin salir del documento.')}</small>
          </div>
        </div>
        <div data-testid="library-tutorial-chrome">
          <span className="library-tutorial-brand"><img src={chromeLogo} alt="" /></span>
          <div>
            <b>{t('Extensión para Chrome')}</b>
            <small>{t('Guarda en la Biblioteca cualquier página, PDF o referencia que encuentres mientras navegas.')}</small>
          </div>
        </div>
      </div>
      <p className="toolkit-guide-trademark">{t('Las dos se activan en Ajustes → Integraciones.')}</p>
    </div>
  );
}

export function LibraryTutorialModal({ open, tab, onTabChange, onClose }: {
  open: boolean;
  tab: LibraryTutorialTab;
  onTabChange: (tab: LibraryTutorialTab) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Named exactly as the Library's own scope switcher names them: a guide that
  // invents its own words for the two halves teaches the wrong vocabulary.
  const tabs: Array<{ key: LibraryTutorialTab; icon: string; label: string }> = [
    { key: 'analysis', icon: 'compass', label: t('Este vault') },
    { key: 'manager', icon: 'library', label: t('Global') },
  ];

  return createPortal(
    <motion.div className="toolkit-guide-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .22 }}>
      <motion.section
        className="toolkit-guide-cinema library-tutorial-cinema"
        data-testid="library-tutorial-modal"
        data-tutorial-tab={tab}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-tutorial-title"
        initial={{ opacity: 0, y: 24, scale: .97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: .4, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <header className="toolkit-guide-hero library-tutorial-hero">
          <div className="toolkit-guide-aurora" aria-hidden="true" />
          <div className="toolkit-guide-hero-copy">
            <div className="toolkit-guide-kicker"><Icon name="book" size={14} /> {t('Guía de la Biblioteca')}</div>
            <h2 id="library-tutorial-title">{t('Dos formas de usar la Biblioteca')}</h2>
            <p>{t('Analiza obras dentro de este vault o gestiona toda tu bibliografía con Nodus. Esta guía cubre las dos.')}</p>
          </div>
          <div className="toolkit-guide-nodi"><NodiAvatar state={tab === 'analysis' ? 'discovering' : 'connecting'} height={172} /></div>
          <button
            type="button"
            className="library-tutorial-close"
            data-testid="library-tutorial-dismiss"
            aria-label={t('Cerrar')}
            title={t('Cerrar')}
            onClick={onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </header>

        <div className="library-tutorial-tabs" role="tablist" aria-label={t('Guía de la Biblioteca')}>
          {tabs.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={tab === entry.key}
              tabIndex={tab === entry.key ? 0 : -1}
              data-testid={`library-tutorial-tab-${entry.key}`}
              className={tab === entry.key ? 'is-active' : ''}
              onClick={() => onTabChange(entry.key)}
            >
              <Icon name={entry.icon} size={14} /> {entry.label}
            </button>
          ))}
        </div>

        <div className="toolkit-guide-stage">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -18 }}
              transition={{ duration: .22 }}
            >
              <div className="toolkit-guide-eyebrow">
                <Icon name={tab === 'analysis' ? 'compass' : 'library'} size={15} />
                {tab === 'analysis' ? t('Lo que añadas aquí es lo que Nodus analiza') : t('Tu bibliografía, sin salir de Nodus')}
              </div>
              {tab === 'analysis' ? <AnalysisTab /> : <ManagerTab />}
            </motion.div>
          </AnimatePresence>
        </div>

        <footer className="toolkit-guide-footer">
          <span className="library-tutorial-hint"><Icon name="help" size={13} /> {t('Puedes volver a abrir esta guía con el botón ? de la cabecera.')}</span>
          <button type="button" className="primary" data-testid="library-tutorial-close" onClick={onClose}>
            {t('Empezar')} <Icon name="check" size={14} />
          </button>
        </footer>
      </motion.section>
    </motion.div>,
    document.body
  );
}
