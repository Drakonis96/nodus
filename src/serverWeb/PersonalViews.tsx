import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../components/ui';
import { api, ApiError } from './api';
import { MarkdownReader } from './readers';
import type { AIConversation, AIJob, AIMessage, AIPreferences, JsonRecord, PageResponse, UserArtifact, UserArtifactKind } from './types';

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-5-mini', anthropic: 'claude-sonnet-4-5', gemini: 'gemini-2.5-flash',
  openrouter: 'openai/gpt-5-mini', mistral: 'mistral-large-latest', cohere: 'command-a-03-2025',
};

function valueText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
}

export function extractAIText(result: unknown): string {
  const root = result as Record<string, unknown> | null;
  if (!root) return '';
  if (typeof root.text === 'string') return root.text;
  if (typeof root.answer === 'string') return root.answer;
  const output = Array.isArray(root.output) ? root.output as Array<Record<string, unknown>> : [];
  const openAI = output.flatMap((entry) => Array.isArray(entry.content) ? entry.content as Array<Record<string, unknown>> : [])
    .map((entry) => valueText(entry.text)).filter(Boolean).join('\n');
  if (openAI) return openAI;
  const anthropic = (Array.isArray(root.content) ? root.content as Array<Record<string, unknown>> : [])
    .map((entry) => valueText(entry.text)).filter(Boolean).join('\n');
  if (anthropic) return anthropic;
  const choices = Array.isArray(root.choices) ? root.choices as Array<Record<string, unknown>> : [];
  const choice = choices.map((entry) => valueText((entry.message as Record<string, unknown> | undefined)?.content)).filter(Boolean).join('\n');
  if (choice) return choice;
  const candidates = Array.isArray(root.candidates) ? root.candidates as Array<Record<string, unknown>> : [];
  const gemini = candidates.flatMap((entry) => {
    const content = entry.content as Record<string, unknown> | undefined;
    return Array.isArray(content?.parts) ? content.parts as Array<Record<string, unknown>> : [];
  }).map((entry) => valueText(entry.text)).filter(Boolean).join('\n');
  if (gemini) return gemini;
  const cohere = root.message as Record<string, unknown> | undefined;
  const cohereText = (Array.isArray(cohere?.content) ? cohere.content as Array<Record<string, unknown>> : []).map((entry) => valueText(entry.text)).filter(Boolean).join('\n');
  return cohereText || 'El proveedor completó el trabajo, pero su respuesta no contiene texto compatible.';
}

async function awaitJob(id: string, signal: AbortSignal): Promise<AIJob> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const { job } = await api.aiJob(id);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('El trabajo sigue activo; puedes consultarlo desde el historial de jobs.');
}

function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const credential = error instanceof ApiError && error.code === 'credential_required';
  return <div className="rounded-lg border border-red-800/70 bg-red-950/30 p-3 text-xs text-red-300" role="alert">{credential ? 'Configura en tu perfil la API key de este proveedor.' : error instanceof Error ? error.message : String(error)}</div>;
}

function ProviderControls({ preferences, provider, model, onProvider, onModel }: { preferences: AIPreferences; provider: string; model: string; onProvider: (value: string) => void; onModel: (value: string) => void }) {
  const providers = ['openai', 'openrouter', 'anthropic', 'gemini', 'mistral', 'cohere'];
  return <div className="server-ai-controls"><label>Proveedor<select className="input text-xs" value={provider} onChange={(event) => { const next = event.target.value; onProvider(next); onModel(preferences.chatModels?.[next] || DEFAULT_MODELS[next] || ''); }}>{providers.map((entry) => <option key={entry}>{entry}</option>)}</select></label><label>Modelo<input className="input text-xs" value={model} onChange={(event) => onModel(event.target.value)} maxLength={200} /></label></div>;
}

function useAIProfile() {
  const [preferences, setPreferences] = useState<AIPreferences>({});
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState(DEFAULT_MODELS.openai);
  useEffect(() => { api.aiPreferences().then(({ preferences: next }) => { setPreferences(next); const chosen = next.defaultProvider || 'openai'; setProvider(chosen); setModel(next.chatModels?.[chosen] || DEFAULT_MODELS[chosen] || ''); }).catch(() => undefined); }, []);
  return { preferences, provider, setProvider, model, setModel };
}

export function ConversationServerView({ spaceId, csrfToken, mode }: { spaceId: string; csrfToken?: string; mode: 'assistant' | 'nodi' }) {
  const profile = useAIProfile();
  const prefix = mode === 'nodi' ? '[Nodi]' : '[Assistant]';
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [active, setActive] = useState<AIConversation | null>(null);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<unknown>();
  const [job, setJob] = useState<AIJob | null>(null);
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(() => api.conversations().then(({ conversations: items }) => {
    const own = items.filter((entry) => entry.vaultId === spaceId && entry.title.startsWith(prefix));
    setConversations(own); setActive((current) => own.find((entry) => entry.id === current?.id) || own[0] || null);
  }), [prefix, spaceId]);
  useEffect(() => { void load(); return () => abort.current?.abort(); }, [load]);
  const create = async (title = 'Nueva conversación') => { const response = await api.createConversation(spaceId, `${prefix} ${title}`, csrfToken); setConversations((items) => [response.conversation, ...items]); setActive(response.conversation); return response.conversation; };
  const send = async (event: FormEvent) => {
    event.preventDefault(); const content = prompt.trim(); if (!content || job && ['queued', 'running'].includes(job.status)) return;
    setPrompt(''); setError(undefined); const controller = new AbortController(); abort.current = controller;
    try {
      let conversation = active || await create(content.slice(0, 60));
      conversation = (await api.appendConversationMessage(conversation.id, { role: 'user', content }, csrfToken)).conversation;
      setActive(conversation); setConversations((items) => items.map((entry) => entry.id === conversation.id ? conversation : entry));
      const context = await api.contextPackage(spaceId, content, csrfToken).catch(() => ({ sections: [] }));
      const system = mode === 'nodi'
        ? 'Eres Nodi, compañero de investigación de Nodus. Responde con claridad, reconoce incertidumbres y cita únicamente referencias nodus:// presentes en el contexto.'
        : 'Eres el asistente de investigación de Nodus. Razona sobre el corpus compartido y cita únicamente referencias nodus:// presentes en el contexto.';
      const messages: AIMessage[] = [{ role: 'system', content: `${system}\n\nCONTEXTO PUBLICADO:\n${JSON.stringify(context.sections || []).slice(0, 32_000)}` }, ...conversation.messages.map(({ role, content: message }) => ({ role, content: message }))];
      const created = await api.runAI(spaceId, mode, { provider: profile.provider, model: profile.model, messages }, csrfToken);
      setJob(created.job); const completed = await awaitJob(created.job.id, controller.signal); setJob(completed);
      if (completed.status !== 'completed') throw new Error(completed.error?.message || `Trabajo ${completed.status}.`);
      conversation = (await api.appendConversationMessage(conversation.id, { role: 'assistant', content: extractAIText(completed.result) }, csrfToken)).conversation;
      setActive(conversation); setConversations((items) => items.map((entry) => entry.id === conversation.id ? conversation : entry));
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause); }
  };
  const cancel = async () => { abort.current?.abort(); if (job && ['queued', 'running'].includes(job.status)) await api.cancelAIJob(job.id, csrfToken).catch(() => undefined); setJob(null); };
  return <div className="server-personal-layout" data-testid={`${mode}-view`}><aside className="server-personal-list"><div className="flex items-center justify-between gap-2 p-3"><div><h1 className="text-sm font-semibold">{mode === 'nodi' ? 'Nodi' : 'Assistant'}</h1><p className="text-[10px] text-teal-400">Conversaciones privadas</p></div><button className="btn text-xs" onClick={() => void create()}>Nueva</button></div><div className="space-y-1 p-2">{conversations.map((entry) => <button key={entry.id} className={`w-full rounded-lg p-2 text-left text-xs ${active?.id === entry.id ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`} onClick={() => setActive(entry)}>{entry.title.replace(prefix, '').trim() || 'Conversación'}<span className="mt-1 block text-[10px] opacity-60">{entry.messages.length} mensajes</span></button>)}</div></aside><section className="server-personal-main"><header className="border-b border-neutral-800 p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm">{mode === 'nodi' ? 'Hablar con Nodi' : 'Asistente de investigación'}</strong><p className="text-[11px] text-neutral-500">Tu historial y tus credenciales no se comparten con otros miembros.</p></div><ProviderControls {...profile} onProvider={profile.setProvider} onModel={profile.setModel} /></div></header><div className="server-chat-scroll">{active?.messages.length ? active.messages.map((message) => <article key={message.id || `${message.role}-${message.createdAt}`} className={`server-chat-message ${message.role}`}><span>{message.role === 'assistant' ? mode === 'nodi' ? 'Nodi' : 'Assistant' : 'Tú'}</span><MarkdownReader value={message.content} /></article>) : <div className="server-chat-empty"><Icon name={mode === 'nodi' ? 'sparkles' : 'chat'} size={34} /><h2>{mode === 'nodi' ? 'Piensa con Nodi' : 'Pregunta sobre el vault'}</h2><p>El contexto se recupera del corpus publicado; la conversación permanece privada.</p></div>}{job && ['queued', 'running'].includes(job.status) && <div className="p-3 text-xs text-indigo-300" role="status">Procesando · intento {job.attempt}…</div>}<ErrorNotice error={error} /></div><form className="server-chat-composer" onSubmit={send}><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Escribe tu pregunta…" rows={3} /><div className="flex justify-between gap-2"><span className="text-[10px] text-neutral-600">Las citas deben resolver a nodus://</span>{job && ['queued', 'running'].includes(job.status) ? <button type="button" className="btn btn-ghost text-xs" onClick={() => void cancel()}>Cancelar</button> : <button className="btn text-xs" disabled={!prompt.trim()}>Enviar</button>}</div></form></section></div>;
}

function artifactLabel(kind: UserArtifactKind): string { return kind === 'workspace-note' ? 'Workspace' : kind === 'nodi-note' ? 'Nodi' : kind === 'deep-research' ? 'Deep Research' : kind === 'dictionary-entry' ? 'Dictionary' : 'Síntesis'; }

export function PrivateNotesServerView({ spaceId, csrfToken, kind = 'workspace-note' }: { spaceId: string; csrfToken?: string; kind?: 'workspace-note' | 'nodi-note' }) {
  const [items, setItems] = useState<UserArtifact[]>([]); const [active, setActive] = useState<UserArtifact | null>(null); const [title, setTitle] = useState(''); const [content, setContent] = useState(''); const [error, setError] = useState<unknown>();
  const load = useCallback(() => api.artifacts(spaceId, kind).then(({ artifacts }) => { setItems(artifacts); setActive((current) => artifacts.find((entry) => entry.id === current?.id) || artifacts[0] || null); }), [kind, spaceId]);
  useEffect(() => { void load(); }, [load]); useEffect(() => { setTitle(active?.title || ''); setContent(active?.content || ''); }, [active]);
  const create = async () => { try { const { artifact } = await api.createArtifact({ vaultId: spaceId, kind, title: 'Sin título', content: '' }, csrfToken); setItems((current) => [artifact, ...current]); setActive(artifact); } catch (cause) { setError(cause); } };
  const save = async () => { if (!active) return; try { const { artifact } = await api.updateArtifact(active.id, { title, content }, csrfToken); setActive(artifact); setItems((current) => current.map((entry) => entry.id === artifact.id ? artifact : entry)); } catch (cause) { setError(cause); } };
  const remove = async () => { if (!active) return; try { await api.deleteArtifact(active.id, csrfToken); setItems((current) => current.filter((entry) => entry.id !== active.id)); setActive(null); } catch (cause) { setError(cause); } };
  return <div className="server-personal-layout" data-testid="private-notes-view"><aside className="server-personal-list"><div className="flex items-center justify-between p-3"><div><h1 className="text-sm font-semibold">{artifactLabel(kind)}</h1><p className="text-[10px] text-teal-400">Privado para ti</p></div><button className="btn text-xs" onClick={() => void create()}>Nueva nota</button></div><div className="space-y-1 p-2">{items.map((entry) => <button key={entry.id} onClick={() => setActive(entry)} className={`w-full rounded-lg p-2 text-left ${active?.id === entry.id ? 'bg-indigo-600 text-white' : 'hover:bg-neutral-900'}`}><strong className="block truncate text-xs">{entry.title || 'Sin título'}</strong><small className="text-[10px] opacity-60">{new Date(entry.updatedAt).toLocaleDateString('es')}</small></button>)}</div></aside><section className="server-personal-main overflow-auto p-4">{active ? <div className="mx-auto flex min-h-full max-w-4xl flex-col"><input className="server-note-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título" /><textarea className="server-note-editor" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Escribe en Markdown…" /><div className="mt-3 flex flex-wrap justify-between gap-2"><span className="text-[10px] text-neutral-600">No se sincroniza con el vault compartido sin publicación explícita.</span><div className="flex gap-2"><button className="btn btn-ghost text-xs" onClick={() => void remove()}>Eliminar</button><button className="btn text-xs" onClick={() => void save()}>Guardar</button></div></div></div> : <div className="server-chat-empty"><Icon name="notebook" size={32} /><h2>Crea una nota privada</h2></div>}<ErrorNotice error={error} /></section></div>;
}

function pageItems(page: PageResponse | undefined, key: string): JsonRecord[] { const candidate = page?.[key]; return Array.isArray(candidate) ? candidate as JsonRecord[] : Array.isArray(page?.items) ? page.items : []; }

export function DictionaryServerView({ spaceId, csrfToken }: { spaceId: string; csrfToken?: string }) {
  const profile = useAIProfile(); const [published, setPublished] = useState<JsonRecord[]>([]); const [drafts, setDrafts] = useState<UserArtifact[]>([]); const [term, setTerm] = useState(''); const [focus, setFocus] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>();
  const load = useCallback(async () => { const [page, privateItems] = await Promise.all([api.collection(spaceId, 'dictionary', { limit: '200' }), api.artifacts(spaceId, 'dictionary-entry')]); setPublished(pageItems(page, 'entries')); setDrafts(privateItems.artifacts); }, [spaceId]); useEffect(() => { void load().catch(setError); }, [load]);
  const generate = async (event: FormEvent) => { event.preventDefault(); if (!term.trim()) return; setBusy(true); setError(undefined); try { const messages: AIMessage[] = [{ role: 'system', content: 'Redacta una entrada académica de diccionario en Markdown. Separa definición, contexto, debates y límites. No inventes fuentes.' }, { role: 'user', content: `Concepto: ${term}\nFoco: ${focus || 'general'}` }]; const created = await api.runAI(spaceId, 'dictionary', { provider: profile.provider, model: profile.model, messages, maxTokens: 3000 }, csrfToken); const completed = await awaitJob(created.job.id, new AbortController().signal); if (completed.status !== 'completed') throw new Error(completed.error?.message || 'No se pudo generar.'); await api.createArtifact({ vaultId: spaceId, kind: 'dictionary-entry', title: term.trim(), content: extractAIText(completed.result), metadata: { focus }, sourceJobId: completed.id }, csrfToken); setTerm(''); setFocus(''); await load(); } catch (cause) { setError(cause); } finally { setBusy(false); } };
  return <div className="server-view-scroll h-full p-4" data-testid="dictionary-view"><div className="mx-auto max-w-6xl space-y-4"><header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">Dictionary</h1><p className="text-xs text-neutral-500">{published.length} publicadas · {drafts.length} borradores privados</p></div><ProviderControls {...profile} onProvider={profile.setProvider} onModel={profile.setModel} /></header><form onSubmit={generate} className="rounded-xl border border-neutral-800 bg-neutral-950/45 p-4"><div className="grid gap-2 md:grid-cols-[minmax(180px,.4fr)_minmax(240px,1fr)_auto]"><input className="input text-xs" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Concepto" /><input className="input text-xs" value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="Foco opcional" /><button className="btn text-xs" disabled={busy || !term.trim()}>{busy ? 'Generando…' : 'Crear borrador con IA'}</button></div><p className="mt-2 text-[10px] text-teal-400">Reader puede generar con su propia key; el resultado permanece privado.</p></form><ErrorNotice error={error} /><section><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Borradores privados</h2><div className="server-record-grid">{drafts.map((entry) => <article key={entry.id} className="server-record-card"><span className="text-[10px] uppercase text-teal-400">Privado</span><h3 className="mt-1 text-sm font-semibold">{entry.title}</h3><div className="mt-2 line-clamp-4 text-xs text-neutral-500"><MarkdownReader value={entry.content} /></div></article>)}</div></section><section><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Entradas publicadas</h2><div className="server-record-grid">{published.map((entry, index) => <article key={String(entry.id || index)} className="server-record-card"><span className="text-[10px] uppercase text-indigo-300">Vault</span><h3 className="mt-1 text-sm font-semibold">{valueText(entry.name || entry.title)}</h3><div className="mt-2 line-clamp-5 text-xs text-neutral-500"><MarkdownReader value={valueText(entry.content_markdown || entry.short_description)} /></div></article>)}</div></section></div></div>;
}

export function DeepResearchServerView({ spaceId, csrfToken }: { spaceId: string; csrfToken?: string }) {
  const profile = useAIProfile(); const [published, setPublished] = useState<JsonRecord[]>([]); const [drafts, setDrafts] = useState<UserArtifact[]>([]); const [objective, setObjective] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(); const [open, setOpen] = useState<UserArtifact | null>(null);
  const load = useCallback(async () => { const [page, privateItems] = await Promise.all([api.collection(spaceId, 'deep-research', { limit: '200' }), api.artifacts(spaceId, 'deep-research')]); setPublished(pageItems(page, 'reports')); setDrafts(privateItems.artifacts); }, [spaceId]); useEffect(() => { void load().catch(setError); }, [load]);
  const generate = async (event: FormEvent) => { event.preventDefault(); const query = objective.trim(); if (!query) return; setBusy(true); setError(undefined); try { const context = await api.contextPackage(spaceId, query, csrfToken); const messages: AIMessage[] = [{ role: 'system', content: 'Produce un informe Deep Research estructurado en Markdown, con resumen, secciones, límites y citas nodus:// verificables. No inventes referencias.' }, { role: 'user', content: `${query}\n\nCONTEXTO:\n${JSON.stringify(context.sections || []).slice(0, 64_000)}` }]; const created = await api.runAI(spaceId, 'deep-research', { provider: profile.provider, model: profile.model, messages, maxTokens: 8000 }, csrfToken); const completed = await awaitJob(created.job.id, new AbortController().signal); if (completed.status !== 'completed') throw new Error(completed.error?.message || 'No se pudo generar.'); const saved = await api.createArtifact({ vaultId: spaceId, kind: 'deep-research', title: query.slice(0, 180), content: extractAIText(completed.result), metadata: { objective: query }, sourceJobId: completed.id }, csrfToken); setObjective(''); setOpen(saved.artifact); await load(); } catch (cause) { setError(cause); } finally { setBusy(false); } };
  if (open) return <div className="server-view-scroll h-full p-4"><button className="mb-3 text-xs text-neutral-500" onClick={() => setOpen(null)}>‹ Volver a Deep Research</button><article className="server-reader-paper"><MarkdownReader value={`# ${open.title}\n\n${open.content}`} /></article></div>;
  return <div className="server-view-scroll h-full p-4" data-testid="deep-research-view"><div className="mx-auto max-w-6xl space-y-4"><header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">Deep Research</h1><p className="text-xs text-neutral-500">Informes publicados y borradores privados generados en Server.</p></div><ProviderControls {...profile} onProvider={profile.setProvider} onModel={profile.setModel} /></header><form onSubmit={generate} className="rounded-xl border border-neutral-800 bg-neutral-950/45 p-4"><textarea className="input min-h-24 w-full text-xs" value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Objetivo de investigación…" /><div className="mt-2 flex justify-end"><button className="btn text-xs" disabled={busy || !objective.trim()}>{busy ? 'Investigando…' : 'Generar informe privado'}</button></div></form><ErrorNotice error={error} /><section><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-teal-400">Borradores privados</h2><div className="server-record-grid">{drafts.map((entry) => <button key={entry.id} className="server-record-card" onClick={() => setOpen(entry)}><h3 className="text-sm font-semibold">{entry.title}</h3><p className="mt-2 line-clamp-3 text-xs text-neutral-500">{entry.content}</p></button>)}</div></section><section><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-300">Publicados en el vault</h2><div className="server-record-grid">{published.map((entry, index) => <article key={String(entry.id || index)} className="server-record-card"><h3 className="text-sm font-semibold">{valueText(entry.title)}</h3><p className="mt-2 line-clamp-3 text-xs text-neutral-500">{valueText(entry.abstract_snippet || entry.objective)}</p></article>)}</div></section></div></div>;
}

export function AuthorSynthesisDraft({ spaceId, csrfToken, authorId, authorName }: { spaceId: string; csrfToken?: string; authorId: string; authorName: string }) {
  const profile = useAIProfile(); const [draft, setDraft] = useState<UserArtifact | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>();
  useEffect(() => { api.artifacts(spaceId, 'author-synthesis').then(({ artifacts }) => setDraft(artifacts.find((entry) => entry.metadata.authorId === authorId) || null)).catch(() => undefined); }, [authorId, spaceId]);
  const generate = async () => { setBusy(true); setError(undefined); try { const context = await api.contextPackage(spaceId, authorName, csrfToken); const created = await api.runAI(spaceId, 'author-tools', { provider: profile.provider, model: profile.model, maxTokens: 3000, messages: [{ role: 'system', content: 'Genera una ficha académica fiel de un autor: tesis central, ideas para recordar, posicionamiento y límites. Devuelve Markdown y cita solo referencias nodus:// del contexto.' }, { role: 'user', content: `AUTOR: ${authorName}\nID: ${authorId}\nCONTEXTO:\n${JSON.stringify(context.sections || []).slice(0, 48_000)}` }] }, csrfToken); const completed = await awaitJob(created.job.id, new AbortController().signal); if (completed.status !== 'completed') throw new Error(completed.error?.message || 'No se pudo generar.'); const saved = await api.createArtifact({ vaultId: spaceId, kind: 'author-synthesis', title: `Síntesis de ${authorName}`, content: extractAIText(completed.result), metadata: { authorId, authorName }, sourceJobId: completed.id }, csrfToken); setDraft(saved.artifact); } catch (cause) { setError(cause); } finally { setBusy(false); } };
  return <div className="space-y-3" data-testid="private-author-synthesis"><div className="flex flex-wrap items-center justify-between gap-3"><div><span className="text-[10px] font-semibold uppercase tracking-wide text-teal-400">Borrador privado</span><p className="mt-1 text-xs text-neutral-500">Se genera con tu propia credencial y no modifica la síntesis publicada.</p></div><div className="flex flex-wrap items-end gap-2"><ProviderControls {...profile} onProvider={profile.setProvider} onModel={profile.setModel} /><button className="btn text-xs" disabled={busy} onClick={() => void generate()}>{busy ? 'Generando…' : draft ? 'Regenerar' : 'Generar síntesis'}</button></div></div><ErrorNotice error={error} />{draft && <div className="rounded-lg border border-teal-900/60 bg-teal-950/15 p-3"><MarkdownReader value={draft.content} /></div>}</div>;
}

export function AuthorSynthesisPanel({ spaceId, csrfToken }: { spaceId: string; csrfToken?: string }) {
  const [authors, setAuthors] = useState<Array<{ id: string; name: string }>>([]); const [selected, setSelected] = useState(''); const [open, setOpen] = useState(false);
  useEffect(() => { api.collection(spaceId, 'authors', { surface: 'workspace', limit: '200', sort: 'surname' }).then((page) => { const source = pageItems(page, 'authors').map((entry) => ({ id: valueText(entry.author_id || entry.id), name: valueText(entry.fullName || entry.name) })).filter((entry) => entry.id); setAuthors(source); setSelected((current) => current || source[0]?.id || ''); }).catch(() => undefined); }, [spaceId]);
  const author = authors.find((entry) => entry.id === selected);
  return <aside className={`server-author-ai-panel ${open ? 'is-open' : ''}`} data-testid="author-synthesis-panel"><button className="server-author-ai-toggle" onClick={() => setOpen((value) => !value)}><Icon name="sparkles" size={14} /> Síntesis personal</button><div className="server-author-ai-content"><label className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Autor<select className="input mt-1 w-full text-xs" value={selected} onChange={(event) => setSelected(event.target.value)}>{authors.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>{author ? <AuthorSynthesisDraft spaceId={spaceId} csrfToken={csrfToken} authorId={author.id} authorName={author.name} /> : <p className="mt-3 text-xs text-neutral-600">No hay autores publicados.</p>}</div></aside>;
}
