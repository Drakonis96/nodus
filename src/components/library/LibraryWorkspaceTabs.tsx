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
    if (nextKey === null) onActivateLibrary();
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
      <div ref={stripRef} className="library-workspace-tabs-scroll" role="tablist" aria-label={t('Biblioteca')}>
        <div className={`library-workspace-tab is-library ${activeKey === null ? 'is-active' : ''}`}>
          <button
            type="button"
            role="tab"
            aria-selected={activeKey === null}
            tabIndex={activeKey === null ? 0 : -1}
            data-testid="library-workspace-tab-library"
            className="library-workspace-tab-main"
            onClick={onActivateLibrary}
            onKeyDown={(event) => tabKeyDown(event, null)}
          >
            <Icon name="library" size={13} />
            <span>{t('Biblioteca')}</span>
          </button>
        </div>
        {tabs.map((tab) => {
          const active = activeKey === tab.key;
          return (
            <div key={tab.key} className={`library-workspace-tab ${active ? 'is-active' : ''}`} title={tab.reference.title}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                data-testid={`library-workspace-tab-document-${tab.reference.id}`}
                className="library-workspace-tab-main"
                onClick={() => onActivateTab(tab.key)}
                onAuxClick={(event) => {
                  if (event.button === 1) closeTab(tab.key);
                }}
                onKeyDown={(event) => tabKeyDown(event, tab.key)}
              >
                <Icon name="file" size={12} />
                <span className="truncate">{tab.reference.title}</span>
              </button>
              <button
                type="button"
                data-testid={`library-workspace-close-${tab.reference.id}`}
                className="library-workspace-tab-close"
                aria-label={`${t('Cerrar pestaña')}: ${tab.reference.title}`}
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
