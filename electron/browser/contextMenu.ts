// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * The right-click menu inside a browser page.
 *
 * Built with Electron's native `Menu` rather than as HTML, and that is the
 * correct choice here for a reason that bit this feature once already: a
 * WebContentsView is a native view that paints above the window's HTML AND takes
 * the pointer, so an HTML context menu drawn over a page would look right and
 * send every click to the website underneath. A native menu is composited by the
 * OS above everything, and needs no visibility juggling at all.
 *
 * Everything the page contributes — selected text, link target, page title — is
 * DATA. It is length-capped, never evaluated, and never used to build a path.
 */

import { Menu, MenuItem, clipboard, shell, type WebContents } from 'electron';
import { searchUrlFor, type BrowserSearchEngineId } from '@shared/browserOmnibox';
import { decideNavigation } from '@shared/browserNavigation';
import { browserMenuIcon } from './menuIcons';

const MAX_LABEL_CHARS = 40;
const MAX_SELECTION_CHARS = 20_000;

export interface ContextMenuActions {
  /** Open a URL in a new Nodus Browser tab. */
  openInNewTab(url: string): void;
  /** Hand selected text to Nodi as a quote. */
  quoteToNodi(text: string): void;
  /** Ask Nodi about the whole page. */
  askNodiAboutPage(): void;
  /** Start an Add-to-Library capture of this page. */
  addToLibrary(): void;
  /** Ask the trusted Nodus renderer to open its bookmark dialog. */
  addBookmark(): void;
  searchEngine(): BrowserSearchEngineId;
  customSearchTemplate(): string;
  /** Localised label, so the menu speaks the app's language. */
  t(key: string): string;
}

/** A short, single-line label for a menu entry built from page text. */
function label(raw: string, limit = MAX_LABEL_CHARS): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

export function installContextMenu(contents: WebContents, actions: ContextMenuActions): void {
  contents.on('context-menu', (_event, params) => {
    const menu = new Menu();
    const t = actions.t;
    const selection = String(params.selectionText ?? '').slice(0, MAX_SELECTION_CHARS).trim();
    const linkUrl = String(params.linkURL ?? '');
    const linkIsNavigable = Boolean(linkUrl) && decideNavigation(linkUrl, { isMainFrame: true }).allowed;

    if (params.isEditable || selection) {
      menu.append(new MenuItem({
        label: t('Copiar'),
        icon: browserMenuIcon('copy'),
        enabled: Boolean(selection),
        click: () => clipboard.writeText(selection),
      }));
    }

    if (selection) {
      menu.append(new MenuItem({
        label: t('Buscar «{q}»').replace('{q}', label(selection)),
        icon: browserMenuIcon('search'),
        click: () => actions.openInNewTab(
          searchUrlFor(selection, actions.searchEngine(), actions.customSearchTemplate()),
        ),
      }));
      menu.append(new MenuItem({
        label: t('Abrir la selección en una pestaña nueva'),
        icon: browserMenuIcon('external'),
        // Only when the selection IS a URL — offering it otherwise would open a
        // search dressed up as a navigation.
        visible: decideNavigation(selection, { isMainFrame: true }).allowed,
        click: () => actions.openInNewTab(selection),
      }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: t('Citar con Nodi'),
        icon: browserMenuIcon('quote'),
        click: () => actions.quoteToNodi(selection),
      }));
    }

    if (linkIsNavigable) {
      if (menu.items.length > 0) menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: t('Abrir enlace en una pestaña nueva'),
        icon: browserMenuIcon('external'),
        click: () => actions.openInNewTab(linkUrl),
      }));
      menu.append(new MenuItem({
        label: t('Copiar dirección del enlace'),
        icon: browserMenuIcon('copy'),
        click: () => clipboard.writeText(linkUrl),
      }));
      menu.append(new MenuItem({
        label: t('Abrir enlace en el navegador del sistema'),
        icon: browserMenuIcon('globe'),
        // Scheme already validated above; shell.openExternal never receives
        // anything this policy has not allowed.
        click: () => void shell.openExternal(linkUrl).catch(() => undefined),
      }));
    }

    if (menu.items.length > 0) menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({
      label: t('Añadir a la Biblioteca'),
      icon: browserMenuIcon('book'),
      click: () => actions.addToLibrary(),
    }));
    menu.append(new MenuItem({
      label: t('Añadir marcador'),
      icon: browserMenuIcon('bookmark'),
      click: () => actions.addBookmark(),
    }));
    menu.append(new MenuItem({
      label: t('Preguntar a Nodi sobre esta página'),
      icon: browserMenuIcon('chat'),
      click: () => actions.askNodiAboutPage(),
    }));

    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: t('Atrás'), icon: browserMenuIcon('back'), enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() }));
    menu.append(new MenuItem({ label: t('Adelante'), icon: browserMenuIcon('forward'), enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() }));
    menu.append(new MenuItem({ label: t('Recargar'), icon: browserMenuIcon('refresh'), click: () => contents.reload() }));

    // Deliberately no "Inspect element": developer tools are not part of this
    // product, and opening them on an arbitrary website is a way to run code in
    // a context the user has no reason to trust.

    menu.popup();
  });
}
