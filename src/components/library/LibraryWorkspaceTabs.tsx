import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { LibraryScope } from '@shared/libraryTypes';
import type { LibraryReaderReference } from '@shared/types';
import { t } from '../../i18n';
import { Icon } from '../ui';

export interface LibraryWorkspaceTab {
  key: string;
  scope: LibraryScope;
  reference: LibraryReaderReference;
  sourceId?: string;
}

export function libraryWorkspaceTabKey(scope: LibraryScope, reference: LibraryReaderReference): string {
  return `${scope}:${reference.id}`;
}

/** Una pestaña cualquiera de la tira: lo que se abre junto a la vista principal. */
export interface WorkspaceStripTab {
  key: string;
  title: string;
  icon: string;
}

/**
 * La tira de pestañas que estrenó la Biblioteca y que ahora comparte con el Workspace.
 *
 * La primera pestaña es siempre la vista principal —la Biblioteca, el Workspace— y no se
 * cierra: es el sitio al que se vuelve. Las demás son lo que se ha abierto desde ella.
 * Vive aquí, y no duplicada en cada vista, porque el gesto tiene que ser el mismo en las
 * dos: mismas teclas, mismo botón de cerrar, mismo desplazamiento a la pestaña activa.
 */
export function WorkspaceTabStrip({
  homeLabel,
  homeIcon,
  homeTestId,
  tabTestId,
  closeTestId,
  tabs,
  activeKey,
  onActivateHome,
  onActivateTab,
  onCloseTab,
}: {
  homeLabel: string;
  homeIcon: string;
  homeTestId: string;
  tabTestId: (tab: WorkspaceStripTab) => string;
  closeTestId: (tab: WorkspaceStripTab) => string;
  tabs: WorkspaceStripTab[];
  activeKey: string | null;
  onActivateHome: () => void;
  onActivateTab: (key: string) => void;
  onCloseTab: (key: string) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeKey, tabs.length]);

  if (!tabs.length) return null;

  const activateAdjacentTab = (currentKey: string | null, direction: -1 | 1) => {
    const keys: Array<string | null> = [null, ...tabs.map((tab) => tab.key)];
    const currentIndex = Math.max(0, keys.indexOf(currentKey));
    const nextKey = keys[(currentIndex + direction + keys.length) % keys.length];
    if (nextKey === null) onActivateHome();
    else onActivateTab(nextKey);
  };

  const tabKeyDown = (event: KeyboardEvent, key: string | null) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    activateAdjacentTab(key, event.key === 'ArrowLeft' ? -1 : 1);
    requestAnimationFrame(() => {
      stripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    });
  };

  const closeTab = (key: string) => {
    onCloseTab(key);
    requestAnimationFrame(() => {
      stripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    });
  };

  return (
    <div data-testid="library-workspace-tabs" className="library-workspace-tabs shrink-0">
      <div ref={stripRef} className="library-workspace-tabs-scroll" role="tablist" aria-label={homeLabel}>
        <div className={`library-workspace-tab is-library ${activeKey === null ? 'is-active' : ''}`}>
          <button
            type="button"
            role="tab"
            aria-selected={activeKey === null}
            tabIndex={activeKey === null ? 0 : -1}
            data-testid={homeTestId}
            className="library-workspace-tab-main"
            onClick={onActivateHome}
            onKeyDown={(event) => tabKeyDown(event, null)}
          >
            <Icon name={homeIcon} size={13} />
            <span>{homeLabel}</span>
          </button>
        </div>
        {tabs.map((tab) => {
          const active = activeKey === tab.key;
          return (
            <div key={tab.key} className={`library-workspace-tab ${active ? 'is-active' : ''}`} title={tab.title}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                data-testid={tabTestId(tab)}
                className="library-workspace-tab-main"
                onClick={() => onActivateTab(tab.key)}
                onAuxClick={(event) => {
                  if (event.button === 1) closeTab(tab.key);
                }}
                onKeyDown={(event) => tabKeyDown(event, tab.key)}
              >
                <Icon name={tab.icon} size={12} />
                <span className="truncate">{tab.title}</span>
              </button>
              <button
                type="button"
                data-testid={closeTestId(tab)}
                className="library-workspace-tab-close"
                aria-label={`${t('Cerrar pestaña')}: ${tab.title}`}
                title={t('Cerrar pestaña')}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.key);
                }}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LibraryWorkspaceTabs({
  tabs,
  activeKey,
  onActivateLibrary,
  onActivateTab,
  onCloseTab,
}: {
  tabs: LibraryWorkspaceTab[];
  activeKey: string | null;
  onActivateLibrary: () => void;
  onActivateTab: (key: string) => void;
  onCloseTab: (key: string) => void;
}) {
  return (
    <WorkspaceTabStrip
      homeLabel={t('Biblioteca')}
      homeIcon="library"
      homeTestId="library-workspace-tab-library"
      tabTestId={(tab) => `library-workspace-tab-document-${tab.key.split(':').slice(1).join(':')}`}
      closeTestId={(tab) => `library-workspace-close-${tab.key.split(':').slice(1).join(':')}`}
      tabs={tabs.map((tab) => ({ key: tab.key, title: tab.reference.title, icon: 'file' }))}
      activeKey={activeKey}
      onActivateHome={onActivateLibrary}
      onActivateTab={onActivateTab}
      onCloseTab={onCloseTab}
    />
  );
}
