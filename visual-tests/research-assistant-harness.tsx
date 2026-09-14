import { vaultTypeColor } from '../shared/vaultTypes';
import { DatabasesChatView } from '../src/views/DatabasesChatView';
import { StudyChatView } from '../src/views/StudyChatView';
import { WorldChatView } from '../src/views/WorldChatView';
import ReactDOM from 'react-dom/client';
import { ResearchAssistantModal } from '../src/views/ResearchAssistantModal';
import { setActiveLang } from '../src/i18n';
import type { AppSettings } from '../shared/types';
import '../src/index.css';
const params = new URLSearchParams(location.search);
const view = params.get('view');
const vaultType = params.get('vault') ?? ({ database: 'databases', study: 'estudio', teaching: 'docencia', world: 'worldbuilding' }[view ?? ''] ?? 'academic');
const settings = { synthesisModel: { provider: 'openai', model: 'gpt-5.4' }, uiLanguage: 'es', chatModel: { provider: 'openai', model: 'gpt-5.4' }, favorites: [
  { provider: 'gemini', model: 'gemini-3-pro-preview' }, { provider: 'xiaomi', model: 'mimo-v2.5' },
  { provider: 'openai', model: 'gpt-4.1' }, { provider: 'codex', model: 'gpt-6-astra' },
], sttProvider: 'transformers', sttTransformersModel: 'whisper-tiny' } as AppSettings;
const win = window as any;
win.requests = []; win.updates = []; win.saved = [];
const conversations = new Map<string, any>();
const systemPrompts = new Map<string, any>();
const promptSelections = new Map<string, string>();
const nativeConversations = new Map<string, any>();
const nativeCreate = async (input: any) => { const chat = { id: `native-${nativeConversations.size + 1}`, ...input, messages: [], focus: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 0 }; nativeConversations.set(chat.id, chat); return chat; };
const nativeSave = async (id: string, patch: any) => { win.saved.push({ id, ...patch }); return Object.assign(nativeConversations.get(id), patch, { messageCount: patch.messages?.length ?? 0 }); };
const nativeStream = async (request: any, handlers: any) => { win.requests.push(request); handlers.onDelta('Respuesta con evidencia.'); return { text: 'Respuesta con evidencia.', answer: 'Respuesta con evidencia [S1](nodus://study/evidence/S1).', citations: [{ id: 'S1', kind: 'material', title: 'Fuente original', location: { materialId: 'material-1' } }], focus: [{ kind: 'character', id: 'character-1', title: 'Personaje' }], noMaterial: false }; };

window.nodus = new Proxy({
  getSettings: async () => settings,
  getResearchSystemPrompts: async (key: string) => ({ prompts: [...systemPrompts.values()].sort((a, b) => a.name.localeCompare(b.name)), selectedId: promptSelections.get(key) ?? null }),
  saveResearchSystemPrompt: async (input: any) => { const prompt = { ...input, id: input.id ?? crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; systemPrompts.set(prompt.id, prompt); return prompt; },
  selectResearchSystemPrompt: async (key: string, id: string | null) => { if (id) promptSelections.set(key, id); else promptSelections.delete(key); },
  deleteResearchSystemPrompt: async (id: string) => { systemPrompts.delete(id); for (const [key, value] of promptSelections) if (value === id) promptSelections.delete(key); },
  listDatabases: async () => [{ id: 'database-1', name: 'Base seleccionada' }, { id: 'database-2', name: 'Otra base' }],
  listStudyAssistantSources: async () => [{ sourceKey: 'material:material-1', title: 'Fuente original', subtitle: 'Material' }],
  listWorldEntries: async () => [{ key: 'character:character-1', id: 'character-1', kind: 'character', title: 'Personaje' }],
  listDatabaseChatConversations: async () => [...nativeConversations.values()],
  listStudyAssistantConversations: async () => [...nativeConversations.values()],
  listWorldChatConversations: async () => [...nativeConversations.values()],
  getDatabaseChatConversation: async (id: string) => nativeConversations.get(id),
  getStudyAssistantConversation: async (id: string) => nativeConversations.get(id),
  getWorldChatConversation: async (id: string) => nativeConversations.get(id),
  createDatabaseChatConversation: nativeCreate,
  createStudyAssistantConversation: nativeCreate,
  createWorldChatConversation: nativeCreate,
  saveDatabaseChatConversation: (id: string, messages: any[], databaseIds: string[]) => nativeSave(id, { messages, databaseIds }),
  updateStudyAssistantConversation: nativeSave,
  saveWorldChatConversation: (id: string, messages: any[], selection: any, focus: any, model: any) => nativeSave(id, { messages, selection, focus, model }),
  deleteDatabaseChatConversation: async (id: string) => nativeConversations.delete(id),
  deleteStudyAssistantConversation: async (id: string) => nativeConversations.delete(id),
  deleteWorldChatConversation: async (id: string) => nativeConversations.delete(id),
  dbChatStream: nativeStream,
  streamStudyAssistant: nativeStream,
  worldChatStream: nativeStream,
  getActiveVault: async () => ({ id: 'test', type: vaultType }),
  listModels: async () => [{ id: 'gpt-6-astra', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(reasoningEffort => ({ reasoningEffort, description: '' })) }],
  listResearchContextSources: async () => ({ authors: [
    { id: 'arendt', name: 'Hannah Arendt', workIds: ['human', 'origins'] },
    { id: 'foucault', name: 'Michel Foucault', workIds: ['discipline'] },
  ], works: [
    { id: 'human', title: 'La condición humana', authors: ['Hannah Arendt'], year: 1958 },
    { id: 'origins', title: 'Los orígenes del totalitarismo', authors: ['Hannah Arendt'], year: 1951 },
    { id: 'discipline', title: 'Vigilar y castigar', authors: ['Michel Foucault'], year: 1975 },
  ] }),
  createConversation: async (input: any) => {
    const id = `conversation-${conversations.size + 1}`;
    const conversation = { id, ...input, title: `Conversación de prueba ${conversations.size + 1}`, messages: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), archived: false };
    conversations.set(id, conversation); return conversation;
  },
  listConversations: async () => [...conversations.values()],
  getConversation: async (id: string) => conversations.get(id),
  saveConversationMessages: async (id: string, messages: any[], meta: any) => {
    win.saved.push({ id, messages, meta }); Object.assign(conversations.get(id), meta, { messages });
  },
  updateSettings: async (patch: any) => { win.updates.push(patch); return Object.assign(settings, patch); },
  researchChatStream: async (request: any, handlers: any) => {
    win.requests.push(request); handlers.onDelta('Respuesta de prueba.');
    return { answer: 'Respuesta de prueba.', stats: { sections: [], works: 0, documents: 0, passages: 0, contextChars: 0, truncated: false } };
  },
}, { get(target: any, key: string) { return target[key] ?? (key.startsWith('on') ? () => () => {} : async () => []); } });
setActiveLang('es');
document.documentElement.className = `${params.get('theme') === 'dark' ? 'dark' : 'light'} ${vaultType}`;
if (params.get('fallback') === 'chat') delete (settings as any).synthesisModel;
const onEvidence = (id: string) => { win.openedEvidence = id; };
ReactDOM.createRoot(document.getElementById('root')!).render(<div style={{ height: '100vh', '--vault-accent': params.get('accent') || vaultTypeColor(vaultType) } as React.CSSProperties}>{view === 'database' ? <DatabasesChatView settings={settings} initialDatabaseId="database-1" /> : view === 'study' || view === 'teaching' ? <StudyChatView settings={settings} variant={view === 'teaching' ? 'teaching' : 'study'} onOpenDocument={onEvidence} onOpenMaterial={onEvidence} onOpenRecording={onEvidence} /> : view === 'world' ? <WorldChatView settings={settings} onNavigate={onEvidence} /> : <ResearchAssistantModal settings={settings} embedded={view === 'embedded'} isGenealogy={params.get('genealogy') === '1'} onClose={() => {}} />}</div>);
