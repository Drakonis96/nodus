import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ChatHistoryNotebook, ChatHistoryNotebookSurface } from '@shared/types';
import { ChatNotebookDialog } from '../components/ChatNotebookDialog';
import { t } from '../i18n';
import type { ChatHistoryNotebooks } from './researchChatAdapter';

/**
 * The notebooks a chat history keeps of its own (Databases, Worldbuilding), as Research
 * Chat's: a named set of sources that its chats read. Opening one, or a chat inside one,
 * points the surface's context at the notebook's current sources and locks it there until
 * a new chat starts; editing the notebook's sources changes what its chats read.
 */
export function useSurfaceNotebooks<Selection>({ surface, current, apply, parse, picker, ready }: {
  surface: ChatHistoryNotebookSurface;
  /** The context as it is now: what a new notebook starts with. */
  current: Selection;
  /** Point the context at a notebook's sources. */
  apply: (selection: Selection) => void;
  /** A stored selection, cleaned into the surface's shape. */
  parse: (stored: unknown) => Selection;
  picker: (selection: Selection, onChange: (next: Selection) => void, disabled: boolean) => ReactNode;
  ready: (selection: Selection) => boolean;
}) {
  const available = typeof window.nodus.listChatHistoryNotebooks === 'function';
  const [list, setList] = useState<ChatHistoryNotebook[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ notebook: ChatHistoryNotebook | null; opened?: (id: string) => void } | null>(null);
  const refresh = useCallback(async () => {
    if (available) setList(await window.nodus.listChatHistoryNotebooks!(surface));
  }, [available, surface]);
  useEffect(() => { void refresh(); }, [refresh]);
  const find = useCallback((id: string | null) => (id ? list.find(notebook => notebook.id === id) ?? null : null), [list]);
  const open = useCallback((id: string) => {
    const notebook = find(id);
    if (!notebook) return;
    setActiveId(id);
    apply(parse(notebook.selection));
  }, [apply, find, parse]);
  const overlay = editing && <ChatNotebookDialog<Selection>
    name={editing.notebook?.name ?? t('Nuevo cuaderno')}
    selection={editing.notebook ? parse(editing.notebook.selection) : current}
    editing={!!editing.notebook} picker={picker} ready={ready}
    onClose={() => setEditing(null)}
    onSave={async (name, selection) => {
      if (editing.notebook) {
        await window.nodus.updateChatHistoryNotebook!(surface, editing.notebook.id, { name, selection });
        if (activeId === editing.notebook.id) apply(selection);
        await refresh();
        setEditing(null);
        return;
      }
      const created = await window.nodus.createChatHistoryNotebook!(surface, { name, selection });
      await refresh();
      setEditing(null);
      editing.opened?.(created.id);
    }} />;
  const notebooks: ChatHistoryNotebooks | undefined = available ? {
    kind: 'notebook',
    entries: list.map(({ id, name, icon, color }) => ({ id, name, icon, color })),
    locksMoves: true,
    open,
    create: opened => setEditing({ notebook: null, opened }),
    editSources: id => { const notebook = find(id); if (notebook) setEditing({ notebook }); },
    update: async (id, patch) => { await window.nodus.updateChatHistoryNotebook!(surface, id, patch); await refresh(); },
    remove: async id => { await window.nodus.deleteChatHistoryNotebook!(surface, id); setActiveId(current => current === id ? null : current); await refresh(); },
    overlay,
  } : undefined;
  return {
    notebooks,
    /** The notebook the open chat or page reads, if any. */
    active: find(activeId),
    /** A chat was opened: it reads its notebook, if it has one. */
    follow: (notebookId: string | null | undefined) => { if (notebookId && find(notebookId)) open(notebookId); else setActiveId(null); },
    clear: () => setActiveId(null),
    editSources: (id: string) => { const notebook = find(id); if (notebook) setEditing({ notebook }); },
  };
}
