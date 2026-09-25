import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ResearchChatSidebar } from '../../../src/components/ResearchChatSidebar';
import { setActiveLang } from '../../../src/i18n';
import type { ChatConversationSummary, ResearchChatProject } from '../../../shared/types';

const fixture = window as any;
fixture.actions = [];
const now = new Date().toISOString();
const chat = (id: string, title: string, extra: Partial<ChatConversationSummary> = {}): ChatConversationSummary =>
  ({ id, title, created_at: now, updated_at: now, archived: false, model: null, messageCount: 2, projectId: null, pinnedAt: null, ...extra });
const project = (id: string, name: string, icon = 'folder', color: string | null = null): ResearchChatProject => ({ id, name, icon, color, createdAt: now, updatedAt: now });

function App() {
  const [projects, setProjects] = useState<ResearchChatProject[]>([project('p-z', 'Zeta'), project('p-a', 'Alfa', 'flask', '#3b82f6')].sort((a, b) => a.name.localeCompare(b.name)));
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([
    chat('c1', 'Sevilla en guías de viaje', { pinnedAt: '2026-09-24T10:00:00Z' }),
    chat('c2', 'Regadío del Tormeral', { projectId: 'p-a' }),
    chat('c3', 'Réplica y cifras'),
    chat('c4', 'Cartografía medieval'),
    chat('c5', 'Pozos y norias', { notebookId: 'n1' }),
  ]);
  const [notebooks, setNotebooks] = useState<any[]>([{ id: 'n1', name: 'Cuaderno de riegos', icon: 'notebook', color: null, sources: [], exclusions: [], mode: 'linked', revision: 1, resolvedDocumentIds: [], createdAt: now, updatedAt: now }]);
  const log = (...entry: unknown[]) => fixture.actions.push(entry);
  return <aside style={{ width: 280, height: 640, display: 'flex', flexDirection: 'column' }} data-testid="research-history-sidebar" className="research-chat-history">
    <ResearchChatSidebar
      conversations={conversations} projects={projects} notebooks={notebooks}
      supportsProjects notebooksOn activeId={null} activeProjectId={null} activeNotebookId={null} sending={false} archivedCount={0} showArchived={false}
      onToggleArchived={() => log('toggleArchived')}
      onNewConversation={() => log('new')}
      onNewNotebook={() => log('newNotebook')}
      onNewProject={async () => { const created = project(`p-${projects.length}`, 'Nuevo proyecto'); setProjects(current => [...current, created].sort((a, b) => a.name.localeCompare(b.name))); log('newProject'); return created; }}
      onOpenConversation={id => log('open', id)}
      onOpenProject={id => log('openProject', id)}
      onOpenNotebook={id => log('notebook', id)}
      onEditNotebook={notebook => log('editNotebook', notebook.id)}
      onUpdateNotebook={async (notebook, patch) => { log('updateNotebook', notebook.id, patch); setNotebooks(current => current.map(item => item.id === notebook.id ? { ...item, ...patch } : item)); }}
      onDeleteNotebook={async notebook => { log('deleteNotebook', notebook.id); setNotebooks(current => current.filter(item => item.id !== notebook.id)); }}
      onRenameConversation={async (conversation, title) => { log('rename', conversation.id, title); setConversations(current => current.map(item => item.id === conversation.id ? { ...item, title } : item)); }}
      onPinConversation={async (conversation, pinned) => {
        log('pin', conversation.id, pinned);
        if (pinned && fixture.pinLimitReached) throw new Error('research_chat_pin_limit');
        setConversations(current => current.map(item => item.id === conversation.id ? { ...item, pinnedAt: pinned ? now : null } : item));
      }}
      onArchiveConversation={async conversation => log('archive', conversation.id)}
      onDeleteConversation={conversation => log('delete', conversation.id)}
      onMoveConversation={async (conversation, projectId) => { log('move', conversation.id, projectId); setConversations(current => current.map(item => item.id === conversation.id ? { ...item, projectId } : item)); }}
      onUpdateProject={async (target, patch) => { log('updateProject', target.id, patch); setProjects(current => current.map(item => item.id === target.id ? { ...item, ...patch } : item)); }}
      onDeleteProject={async target => { log('deleteProject', target.id); setProjects(current => current.filter(item => item.id !== target.id)); }}
    />
  </aside>;
}
setActiveLang('es');
createRoot(document.getElementById('root')!).render(<App />);
