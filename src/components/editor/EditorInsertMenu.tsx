import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { autoPlacement, offset, shift, size } from '@floating-ui/react';
import { DragHandleButton, GenericPopover, SideMenu, useBlockNoteEditor, useComponentsContext, useDictionary, useExtension, useExtensionState, type DefaultReactSuggestionItem, type FloatingUIOptions, type SideMenuProps } from '@blocknote/react';
import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions';
import { Icon } from '../ui';
import { t } from '../../i18n';

export type EditorInsertItem = DefaultReactSuggestionItem & { key: string };
export interface EditorInsertHandle { openAtBlock(blockId: string): void; }
export const editorInsertMenuOptions: FloatingUIOptions = {
  useTransitionStatusProps: { duration: 0 },
  useTransitionStylesProps: { duration: 0 },
  elementProps: { className: 'nodus-insert-popover', style: { zIndex: 80 } },
};
const followDocumentScroll: NonNullable<NonNullable<FloatingUIOptions['useFloatingOptions']>['whileElementsMounted']> = (_reference, _floating, update) => {
  document.addEventListener('scroll', update, true);
  window.addEventListener('resize', update);
  return () => { document.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
};

/** Attach the action to the whole button, including keyboard activation. */
export function EditorSideMenu(props: SideMenuProps & { onAddBlock(blockId: string): void }) {
  const editor = useBlockNoteEditor();
  const components = useComponentsContext()!;
  const dictionary = useDictionary();
  const block = useExtensionState(SideMenuExtension, { selector: state => state?.block });
  const Button = components.SideMenu.Button;
  return <SideMenu><span style={{display:'flex'}} onMouseDown={event => event.preventDefault()}><Button className="bn-button" label={dictionary.side_menu.add_block_label} icon={<Icon name="plus" size={24} />} onClick={() => {
    if (!block || !editor.isEditable) return;
    props.onAddBlock(block.id);
  }} /></span><DragHandleButton dragHandleMenu={props.dragHandleMenu} /></SideMenu>;
}

/** Synchronous local catalog; search input never becomes document content. */
export const EditorInsertController = forwardRef<EditorInsertHandle, { items: EditorInsertItem[] }>(({ items: catalog }, ref) => {
  const editor = useBlockNoteEditor(), suggestions = useExtension(SuggestionMenu);
  const state = useExtensionState(SuggestionMenu);
  const nativeOpen = Boolean(state?.show && state.triggerCharacter === '/');
  const [searching, setSearching] = useState(false), [search, setSearch] = useState(''), [selectedIndex, setSelectedIndex] = useState(0);
  const [buttonBlockId, setButtonBlockId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null), wasOpen = useRef(false);
  const anchor = useRef<{ rect: DOMRect; element: HTMLElement | null; box: DOMRect } | null>(null);
  if (nativeOpen && state && !buttonBlockId) {
    const element = editor.domElement?.querySelector<HTMLElement>(`[data-id="${CSS.escape(editor.getTextCursorPosition().block.id)}"] .bn-block-content`) ?? null;
    anchor.current = { rect: new DOMRect(state.referencePos.x,state.referencePos.y,state.referencePos.width,state.referencePos.height), element, box: element?.getBoundingClientRect() ?? new DOMRect() };
  }
  useImperativeHandle(ref, () => ({ openAtBlock(blockId) {
    const element = editor.domElement?.querySelector<HTMLElement>(`[data-id="${CSS.escape(blockId)}"] .bn-block-content`);
    if (!element) return;
    const box = element.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 32;
    anchor.current = { element, box, rect: new DOMRect(box.x, box.y, 0, Math.min(box.height, lineHeight)) };
    setButtonBlockId(blockId);
    setSearch('');
    setSelectedIndex(0);
    setSearching(true);
  } }), [editor]);
  const query = searching ? search : nativeOpen ? state!.query : '';
  const items = useMemo(() => {
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const terms = normalize(query.trim()).split(/\s+/);
    return catalog.filter(item => { const text = normalize([item.title,...(item.aliases ?? [])].join(' ')); return terms.every(term => text.includes(term)); });
  }, [catalog, query]);
  const open = nativeOpen || searching;
  const close = useCallback((returnFocus = false) => { setSearching(false); setSearch(''); setButtonBlockId(null); suggestions.closeMenu(); if (returnFocus) editor.focus(); }, [suggestions,editor]);
  const choose = useCallback((item: EditorInsertItem) => {
    close();
    if (buttonBlockId) {
      // Opening '+' is read-only. Only choosing an action inserts a paragraph.
      const block = editor.getBlock(buttonBlockId);
      if (!block) return;
      const target = Array.isArray(block.content) && block.content.length === 0
        ? block : editor.insertBlocks([{ type: 'paragraph' }], block, 'after')[0];
      editor.setTextCursorPosition(target);
      editor.focus();
    } else {
      // Clear only the native '/' query, never the separate search input.
      suggestions.clearQuery();
    }
    item.onItemClick();
  }, [buttonBlockId,close,suggestions,editor]);
  useLayoutEffect(() => { if (buttonBlockId) input.current?.focus({preventScroll:true}); }, [buttonBlockId]);
  useLayoutEffect(() => {
    if (nativeOpen && !wasOpen.current) {
      setSelectedIndex(0);
    }
    wasOpen.current = nativeOpen;
  }, [nativeOpen]);
  useEffect(() => { setSelectedIndex(0); }, [query]);
  useEffect(() => { if (nativeOpen && !searching && query && !items.length) suggestions.closeMenu(); }, [nativeOpen,searching,query,items.length,suggestions]);
  useLayoutEffect(() => {
    if (!open) return;
    const handle = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.target instanceof Node) || !(input.current === event.target || editor.domElement?.contains(event.target))) return;
      if (!['ArrowDown','ArrowUp','PageDown','PageUp','Enter','Escape'].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') { close(true); return; }
      if (!items.length) return;
      if (event.key === 'Enter') choose(items[Math.min(selectedIndex,items.length - 1)]);
      else setSelectedIndex(index => event.key === 'PageUp' ? 0 : event.key === 'PageDown' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    };
    document.addEventListener('keydown',handle,true);
    return () => document.removeEventListener('keydown',handle,true);
  }, [open,editor,items,selectedIndex,choose,close]);
  const reference = useMemo(() => ({
    // A virtual reference avoids focus guards inside ProseMirror and avoids
    // observing/reflowing the whole manuscript while the palette is open.
    element: undefined,
    getBoundingClientRect: () => {
      const saved = anchor.current;
      if (!saved) return new DOMRect();
      const current = saved.element?.getBoundingClientRect() ?? saved.box;
      return new DOMRect(saved.rect.x + current.x - saved.box.x,saved.rect.y + current.y - saved.box.y,saved.rect.width,saved.rect.height);
    },
  }), [editor]);
  // The registered public extension still owns '/' detection and document ranges.
  useLayoutEffect(() => { suggestions.addSuggestionMenu({triggerCharacter:'/'}); return () => suggestions.removeSuggestionMenu('/'); }, [suggestions]);
  return <GenericPopover reference={reference} {...editorInsertMenuOptions} focusManagerProps={{disabled:true}} useFloatingOptions={{open,onOpenChange:value=>{if(!value)close();},placement:'bottom-start',whileElementsMounted:followDocumentScroll,middleware:[offset(10),autoPlacement({allowedPlacements:['bottom-start','top-start'],padding:10}),shift(),size({padding:10,apply:({elements,availableHeight})=>{elements.floating.style.maxHeight=`${Math.max(0,availableHeight)}px`;}})]}} elementProps={{...editorInsertMenuOptions.elementProps,onMouseDownCapture:event=>{if(!(event.target instanceof HTMLInputElement))event.preventDefault();}}}>
    <EditorInsertMenu items={items} selectedIndex={items.length ? Math.min(selectedIndex,items.length - 1) : undefined} onItemClick={choose} searchInput={<label className="editorial-insert-search"><Icon name="search" size={14}/><input ref={input} type="search" aria-label={t('Buscar bloques')} placeholder={t('Buscar bloques…')} value={query} autoFocus={Boolean(buttonBlockId)} autoComplete="off" role="combobox" aria-expanded={open} aria-controls="bn-suggestion-menu" aria-activedescendant={items.length ? `bn-suggestion-menu-item-${Math.min(selectedIndex,items.length - 1)}` : undefined} onFocus={()=>{if(!searching){setSearch(query);setSearching(true);}}} onPointerDown={()=>{if(!searching){setSearch(query);setSearching(true);}}} onChange={event=>{setSearch(event.target.value);setSelectedIndex(0);}}/>{query && <button type="button" aria-label={t('Borrar búsqueda')} title={t('Borrar búsqueda')} onClick={()=>{input.current?.focus();setSearching(true);setSearch('');setSelectedIndex(0);}}><Icon name="x" size={12}/></button>}</label>} />
  </GenericPopover>;
});
EditorInsertController.displayName = 'EditorInsertController';

/** Only the results scroll; selecting an item never scrolls the document. */
function EditorInsertMenu({ items, selectedIndex, onItemClick, searchInput }: { items: EditorInsertItem[]; selectedIndex: number | undefined; onItemClick(item: EditorInsertItem): void; searchInput: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const results = list.current;
    const option = results?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!results || !option) return;
    const bounds = results.getBoundingClientRect(), selected = option.getBoundingClientRect();
    const top = bounds.top + 6, bottom = bounds.bottom - 6;
    if (selected.bottom > bottom) results.scrollTop += selected.bottom - bottom;
    else if (selected.top < top) results.scrollTop += selected.top - top;
  }, [selectedIndex, items]);
  return <div className="editorial-insert-menu" data-testid="editor-insert-menu">
    <header><Icon name="plus" size={14} /><b>{t('Insertar bloque')}</b></header>
    {searchInput}
    <div ref={list} id="bn-suggestion-menu" role="listbox" aria-label={t('Insertar bloque')} className="editorial-insert-results">
      {!items.length && <p role="status" className="editorial-insert-empty">{t('No hay bloques coincidentes.')}</p>}
      {items.map((item, index) => <div key={item.key}>
        {item.group && item.group !== items[index - 1]?.group && <div className="editorial-insert-group" role="presentation">{item.group}</div>}
        <button type="button" role="option" tabIndex={-1} id={`bn-suggestion-menu-item-${index}`} aria-label={item.title} aria-selected={selectedIndex === index} data-insert-key={item.key} onMouseDown={event => event.preventDefault()} onClick={() => onItemClick(item)}>
          <span className="editorial-insert-icon">{item.icon}</span><span className="editorial-insert-label"><b>{item.title}</b>{item.subtext && <small>{item.subtext}</small>}</span>{item.badge && <kbd>{item.badge}</kbd>}
        </button>
      </div>)}
    </div>
    <footer>{t('↑↓ elegir · Enter insertar · Esc cerrar')}</footer>
  </div>;
}
