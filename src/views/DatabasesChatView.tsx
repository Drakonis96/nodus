import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, DatabaseSummary } from '@shared/types';
import { ChatMarkdown } from '../components/ChatMarkdown';
import { ChartFromSpec } from '../components/DatabaseChart';
import { parseChatSegments } from '@shared/chartSpec';
import { t } from '../i18n';
import { ResearchAssistantModal } from './ResearchAssistantModal';
import { nativeSummary, type ResearchChatAdapter } from './researchChatAdapter';

const STARTERS = [
  'Resume esta base de datos en 3 puntos.',
  'Muéstrame la distribución por categoría en un gráfico.',
  '¿Qué valores atípicos o problemas de calidad detectas?',
  'Compara los grupos y destaca las diferencias.',
];

/** Renders an assistant message: Markdown prose with any native chart specs inline. */
function AssistantMessage({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const segments = parseChatSegments(text);
  return (
    <div className="text-sm">
      {segments.map((seg, i) =>
        seg.kind === 'chart' ? <ChartFromSpec key={i} spec={seg.spec} /> : <ChatMarkdown key={i} streaming={streaming} content={seg.text} className="text-sm" />
      )}
    </div>
  );
}

export function DatabasesChatView({ settings, initialDatabaseId }: { settings: AppSettings; initialDatabaseId: string | null }) {
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [selected, setSelected] = useState<string[]>(initialDatabaseId ? [initialDatabaseId] : []);
  useEffect(() => { void window.nodus.listDatabases().then(list => { setDatabases(list); setSelected(current => current.length ? current : list[0] ? [list[0].id] : []); }); }, []);
  const adapter = useMemo<ResearchChatAdapter>(() => ({
    id: 'database', contextKey: JSON.stringify([...selected].sort()), canSend: selected.length > 0,
    subtitle: 'Pregunta a tus datos. Puede responder con cifras y gráficos, siempre a partir de tus filas.', suggestions: STARTERS,
    contextPanel: <div className="space-y-2">{databases.map(database => <label key={database.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(database.id)} onChange={event => setSelected(current => event.target.checked ? [...current, database.id] : current.filter(id => id !== database.id))} />{database.name}</label>)}{!selected.length && <p className="text-xs text-neutral-500">{t('Elige al menos una base de datos.')}</p>}</div>,
    listConversations: async () => (await window.nodus.listDatabaseChatConversations()).map(nativeSummary),
    getConversation: async id => { const chat = await window.nodus.getDatabaseChatConversation(id); if (!chat) return null; setSelected(chat.databaseIds); return { ...nativeSummary(chat), selection: null, messages: chat.messages.map((message, index) => ({ ...message, id: `${id}:${index}`, selectionKey: message.selectionKey ?? JSON.stringify([...chat.databaseIds].sort()) })) }; },
    createConversation: input => window.nodus.createDatabaseChatConversation({ title: input.title ?? 'Research chat', databaseIds: selected }),
    saveConversationMessages: (id, messages) => window.nodus.saveDatabaseChatConversation(id, messages, selected),
    deleteConversation: id => window.nodus.deleteDatabaseChatConversation(id),
    researchChatStream: async (request, handlers) => { const result = await window.nodus.dbChatStream({ conversationId: request.conversationId, question: request.messages.at(-1)!.content, databaseIds: selected, history: request.messages.slice(0, -1), model: request.model, thinkingEffort: request.thinkingEffort, systemPromptId: request.systemPromptId }, handlers); return { answer: result.text, aborted: result.aborted }; },
    cancelResearchChat: () => window.nodus.cancelDbChat(),
    renderMessage: (message, streaming) => <AssistantMessage text={message.content} streaming={streaming} />,
  }), [databases, selected]);
  return <ResearchAssistantModal settings={settings} embedded adapter={adapter} />;
}
