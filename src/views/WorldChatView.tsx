import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, WorldChatSelection, WorldChatResult, WorldEntry, WorldArticleCategory } from '@shared/types';
import type { View } from '../navigation';
import { ARTICLE_CATEGORY_LABEL } from '@shared/worldEncyclopedia';
import { ChatMarkdown } from '../components/ChatMarkdown';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import { ResearchAssistantModal } from './ResearchAssistantModal';
import { nativeSummary, type ResearchChatAdapter } from './researchChatAdapter';

const SECTION_OF_KIND: Record<string, View> = {
  character: 'characters',
  place: 'places',
  group: 'factions',
  scene: 'scenes',
  article: 'encyclopedia',
  map: 'map',
  rule: 'rules',
  conflict: 'conflicts',
};

const KIND_LABEL: Record<string, string> = {
  character: 'Personaje',
  place: 'Lugar',
  group: 'Facción',
  scene: 'Escena',
  article: 'Artículo',
  map: 'Mapa',
  rule: 'Regla',
  conflict: 'Conflicto',
};

const STARTERS = [
  '¿Qué tiene que moverse en la próxima escena?',
  '¿Esto contradice algo de lo que ya he escrito?',
  '¿Qué leyes alcanzan a mi protagonista?',
  '¿Quién sabía el secreto en ese momento?',
];

const BLANK_SELECTION: WorldChatSelection = { scope: 'auto', entryKeys: [], keepFocus: false };

export function WorldChatView({ settings, onNavigate }: { settings: AppSettings; onNavigate?: (view: View) => void }) {
  const [selection, setSelection] = useState<WorldChatSelection>(() => ({ ...BLANK_SELECTION, entryKeys: [] }));
  const [focus, setFocus] = useState<WorldChatResult['focus']>([]);
  const focusByConversation = useRef(new Map<string, WorldChatResult['focus']>());
  const [entries, setEntries] = useState<WorldEntry[]>([]);
  const [entrySearch, setEntrySearch] = useState('');
  useEffect(() => { void window.nodus.listWorldEntries().then(setEntries); }, []);
  const filteredEntries = useMemo(() => entries.filter(entry => `${entry.title} ${entry.summary ?? ''} ${entry.category ?? ''}`.toLocaleLowerCase().includes(entrySearch.trim().toLocaleLowerCase())).slice(0, 150), [entries, entrySearch]);
  const openWorldEntry = (kind: string) => { const view = SECTION_OF_KIND[kind]; if (view) onNavigate?.(view); };
  const adapter: ResearchChatAdapter = {
    id: 'world', contextKey: JSON.stringify(selection), subtitle: 'Las respuestas se fundamentan en las fichas del vault. Las referencias abren su sección original y el chat nunca modifica el canon.', suggestions: STARTERS,
    canSend: selection.scope !== 'manual' || selection.entryKeys.length > 0,
    reset: () => setFocus([]),
    contextPanel: <>          <label className="mt-3 block text-[10px] text-neutral-500">
            {t('Ámbito')}
            <select data-testid="world-chat-scope" className="input mt-1 w-full" value={selection.scope} onChange={(event) => setSelection((current) => ({ ...current, scope: event.target.value as WorldChatSelection['scope'] }))}>
              <option value="auto">{t('Detección automática')}</option>
              <option value="manual">{t('Selección manual')}</option>
            </select>
          </label>
          {selection.scope === 'auto' ? (
            <>
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-200 p-2 text-xs dark:border-neutral-800">
                <input type="checkbox" checked={selection.keepFocus} onChange={(event) => setSelection((current) => ({ ...current, keepFocus: event.target.checked }))} />
                <span><span className="block font-medium">{t('Seguir con el foco anterior')}</span><span className="mt-0.5 block text-[9px] leading-4 text-neutral-500">{t('Útil para preguntas de seguimiento que no vuelven a nombrar una ficha.')}</span></span>
              </label>
              {focus.length > 0 && <div className="mt-3"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">{t('Ha mirado')}</p><div className="mt-1.5 flex flex-wrap gap-1.5">{focus.map((ref) => <button key={`${ref.kind}:${ref.id}`} className="rounded-full border research-accent-soft research-source-option px-2 py-1 text-[10px]" onClick={() => openWorldEntry(ref.kind)}>{ref.title}</button>)}</div></div>}
            </>
          ) : (
            <>
              <div className="relative mt-3">
                <Icon name="search" size={12} className="pointer-events-none absolute left-2.5 top-2.5 text-neutral-400" />
                <input className="input input-with-leading-icon w-full text-xs" value={entrySearch} placeholder={t('Buscar fichas…')} onChange={(event) => setEntrySearch(event.target.value)} />
              </div>
              <p className="mt-2 text-[10px] text-neutral-500">{selection.entryKeys.length} {t('fichas elegidas')}</p>
              <div className="mt-2 max-h-[calc(100vh-270px)] space-y-1 overflow-y-auto">
                {filteredEntries.map((entry) => (
                  <label key={entry.key} className="flex cursor-pointer gap-2 rounded-lg border border-neutral-200 p-2 text-xs research-source-option dark:border-neutral-800">
                    <input type="checkbox" checked={selection.entryKeys.includes(entry.key)} onChange={(event) => setSelection((current) => ({ ...current, entryKeys: event.target.checked ? [...current.entryKeys, entry.key] : current.entryKeys.filter((key) => key !== entry.key) }))} />
                    <span className="min-w-0"><span className="block truncate font-medium">{entry.title}</span><span className="block truncate text-[9px] text-neutral-500">{t(KIND_LABEL[entry.kind] ?? entry.kind)}{entry.category ? ` · ${t(ARTICLE_CATEGORY_LABEL[entry.category as WorldArticleCategory] ?? entry.category)}` : ''}</span></span>
                  </label>
                ))}
              </div>
            </>
          )}
          <p className="mt-4 rounded-lg bg-neutral-100 p-3 text-[10px] leading-5 text-neutral-500 dark:bg-neutral-900/60">{t('Las respuestas se fundamentan en las fichas del vault. Las referencias abren su sección original y el chat nunca modifica el canon.')}</p></>,
    listConversations: async () => (await window.nodus.listWorldChatConversations()).map(nativeSummary),
    getConversation: async id => { const chat = await window.nodus.getWorldChatConversation(id); if (!chat) return null; setSelection(chat.selection); setFocus(chat.focus); focusByConversation.current.set(id, chat.focus); return { ...nativeSummary(chat), selection: null, messages: chat.messages.map((message, index) => ({ ...message, id: `${id}:${index}`, selectionKey: message.selectionKey ?? JSON.stringify(chat.selection) })) }; },
    createConversation: input => window.nodus.createWorldChatConversation({ title: input.title ?? 'Research chat', model: input.model ?? null, selection }),
    saveConversationMessages: (id, messages, options) => window.nodus.saveWorldChatConversation(id, messages, selection, focusByConversation.current.get(id) ?? [], options.model ?? null),
    deleteConversation: id => window.nodus.deleteWorldChatConversation(id),
    researchChatStream: async (request, handlers) => { const result = await window.nodus.worldChatStream({ conversationId: request.conversationId, question: request.messages.at(-1)!.content, history: request.messages.slice(0, -1), focusKeys: selection.scope === 'manual' ? selection.entryKeys : selection.keepFocus ? focus.map(item => `${item.kind}:${item.id}`) : [], model: request.model, thinkingEffort: request.thinkingEffort, systemPromptId: request.systemPromptId }, handlers); if (request.conversationId) focusByConversation.current.set(request.conversationId, result.focus); setFocus(result.focus); return { answer: result.noMaterial ? t('No he encontrado nada de tu mundo en esa pregunta. Nombra un personaje, un lugar, una escena o una ley y vuelvo a mirar.') : result.text, aborted: result.aborted }; },
    cancelResearchChat: () => window.nodus.cancelWorldChat(),
    renderMessage: (message, streaming) => <ChatMarkdown content={message.content} streaming={streaming} verify={false} onWorldEntry={kind => openWorldEntry(kind)} />,
  };
  return <ResearchAssistantModal settings={settings} embedded adapter={adapter} />;
}
