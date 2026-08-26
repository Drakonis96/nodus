import { lazy, Suspense, type FormEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeVaultType, VAULT_TYPE_COLORS, VAULT_TYPES, type VaultType } from '@shared/vaultTypes';
import { dedicatedVaultNavIds, groupedNav, NAV_ITEMS, type NavItem, type View } from '../navigation';
import { Icon } from '../components/ui';
import { vaultTypeIcon, vaultTypeLabel } from '../components/vaultTypeUi';
import { WorldbuildingSidebar } from '../components/WorldbuildingSidebar';
import { ProsopographySidebar } from '../components/ProsopographySidebar';
import { TestimonySidebar } from '../components/TestimonySidebar';
import { PrimarySourcesSidebar } from '../components/PrimarySourcesSidebar';
import { StudySidebar } from '../components/StudySidebar';
import { TeachingSidebar } from '../components/TeachingSidebar';
import nodusLogo from '../assets/nodus-logo.svg';
import nodusLogoGold from '../assets/nodus-logo-gold.svg';
import nodusLogoCrimson from '../assets/nodus-logo-crimson.svg';
import nodusLogoTeal from '../assets/nodus-logo-teal.svg';
import nodusLogoOrange from '../assets/nodus-logo-orange.svg';
import nodusLogoViolet from '../assets/nodus-logo-violet.svg';
import nodusLogoCyan from '../assets/nodus-logo-cyan.svg';
import { api, ApiError } from './api';
import { MarkdownReader, SafeDocumentReader } from './readers';
import { AuthorSynthesisPanel, ConversationServerView, DeepResearchServerView, DictionaryServerView, PrivateNotesServerView } from './PersonalViews';
import type { AIPreferences, AIProviderStatus, Annotation, JsonRecord, LibraryDocument, MeResponse, PageResponse, ServerUserProfile, Space, SpaceSummary } from './types';

type ServerView = View | 'assistant' | 'nodi';
type Route =
  | { kind: 'view'; view: ServerView }
  | { kind: 'detail'; view: View; collection: string; id: string }
  | { kind: 'library-detail'; view: 'library'; id: string };

type CollectionMeta = { collection: string; label: string; icon: string };

const IdeasServerView = lazy(() => import('./advanced').then((module) => ({ default: module.IdeasServerView })));
const AuthorsServerView = lazy(() => import('./advanced').then((module) => ({ default: module.AuthorsServerView })));
const GraphServerView = lazy(() => import('./advanced').then((module) => ({ default: module.GraphServerView })));

const VIEW_COLLECTIONS: Partial<Record<View, CollectionMeta>> = {
  ideas: { collection: 'ideas', label: 'Ideas', icon: 'bulb' },
  argument: { collection: 'ideas', label: 'Mapa de argumentos', icon: 'layers' },
  authors: { collection: 'authors', label: 'Autores', icon: 'graduation' },
  research: { collection: 'themes', label: 'Estado de la cuestión', icon: 'strata' },
  hypothesis: { collection: 'gaps', label: 'Hipótesis', icon: 'flask' },
  persons: { collection: 'persons', label: 'Personas', icon: 'users' },
  characters: { collection: 'persons', label: 'Personajes', icon: 'users' },
  prosopPersons: { collection: 'persons', label: 'Personas', icon: 'user' },
  testimonyParticipants: { collection: 'persons', label: 'Participantes', icon: 'users' },
  places: { collection: 'places', label: 'Lugares', icon: 'map' },
  map: { collection: 'places', label: 'Mapa', icon: 'map' },
  timeline: { collection: 'events', label: 'Línea temporal', icon: 'clock' },
  relations: { collection: 'relationships', label: 'Relaciones sociales', icon: 'link' },
  tree: { collection: 'relationships', label: 'Árbol genealógico', icon: 'tree' },
  factions: { collection: 'world-groups', label: 'Facciones', icon: 'network' },
  cultures: { collection: 'world-groups', label: 'Culturas', icon: 'languages' },
  dynasties: { collection: 'world-groups', label: 'Dinastías', icon: 'shield' },
  scenes: { collection: 'world-scenes', label: 'Escenas', icon: 'image' },
  manuscript: { collection: 'world-scenes', label: 'Manuscrito', icon: 'edit' },
  encyclopedia: { collection: 'world-articles', label: 'Enciclopedia', icon: 'book' },
  arcs: { collection: 'world-threads', label: 'Arcos narrativos', icon: 'route' },
  continuity: { collection: 'world-threads', label: 'Continuidad', icon: 'check' },
  conflicts: { collection: 'world-threads', label: 'Conflictos', icon: 'scale' },
  rules: { collection: 'world-rules', label: 'Reglas del mundo', icon: 'lock' },
  questions: { collection: 'world-questions', label: 'Preguntas abiertas', icon: 'help' },
  studyCourses: { collection: 'study-courses', label: 'Cursos y asignaturas', icon: 'graduation' },
  studyLibrary: { collection: 'study-materials', label: 'Materiales de estudio', icon: 'book' },
  studyRecordings: { collection: 'study-materials', label: 'Grabaciones', icon: 'microphone' },
  studySchedule: { collection: 'study-plans', label: 'Horarios', icon: 'clock' },
  studyCalendar: { collection: 'study-plans', label: 'Calendario', icon: 'calendar' },
  studyReview: { collection: 'study-plans', label: 'Revisión', icon: 'flashcards' },
  studyQuestions: { collection: 'study-questions', label: 'Banco de preguntas', icon: 'help' },
  studyIdeas: { collection: 'study-questions', label: 'Ideas de estudio', icon: 'bulb' },
  studyGraph: { collection: 'study-questions', label: 'Grafo de estudio', icon: 'network' },
  teachingGroups: { collection: 'study-courses', label: 'Grupos', icon: 'users' },
  teachingExams: { collection: 'teaching-exams', label: 'Exámenes', icon: 'notebook' },
  teachingRubrics: { collection: 'teaching-rubrics', label: 'Rúbricas', icon: 'table' },
  teachingGrades: { collection: 'teaching-rubrics', label: 'Calificaciones', icon: 'chartBar' },
  teachingUnits: { collection: 'teaching-exams', label: 'Diseño de unidades', icon: 'compass' },
  archive: { collection: 'archive-items', label: 'Archivo', icon: 'archive' },
  prosopSources: { collection: 'archive-items', label: 'Fuentes', icon: 'archive' },
  testimonyInterviews: { collection: 'testimony-interviews', label: 'Entrevistas', icon: 'microphone' },
  testimonyContrasts: { collection: 'testimony-contrasts', label: 'Contrastes', icon: 'scale' },
  pages: { collection: 'database-pages', label: 'Páginas', icon: 'notebook' },
  databases: { collection: 'databases', label: 'Bases de datos', icon: 'table' },
  dbAnalysis: { collection: 'databases', label: 'Análisis', icon: 'chartBar' },
};

const STANDARD_VIEW_IDS: View[] = [
  'search', 'library', 'graph', 'argument', 'ideas', 'authors', 'dictionary', 'immersion',
  'research', 'hypothesis', 'reading', 'deepResearch', 'workspace', 'writing', 'projects',
  'browser', 'radar', 'compass', 'toolkit',
];

const GENEALOGY_VIEW_IDS: View[] = [
  'search', 'library', 'persons', 'timeline', 'tree', 'relations', 'map', 'archive',
  'deepResearch', 'notes', 'browser', 'radar', 'compass', 'toolkit',
];

/** Deliberately visible for 1:1 navigation, but outside Server's functional surface. */
const DISABLED_TOOL_VIEWS = new Set<View>(['browser', 'radar', 'compass', 'toolkit']);
const ACTIVE_VAULT_STORAGE_KEY = 'nodus-server-active-vault';

function routeFromLocation(): Route {
  const parts = window.location.pathname.replace(/^\/app\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'detail' && parts[1] && parts[2] && parts[3]) {
    return { kind: 'detail', view: parts[1] as View, collection: decodeURIComponent(parts[2]), id: decodeURIComponent(parts[3]) };
  }
  if (parts[0] === 'library' && parts[1]) return { kind: 'library-detail', view: 'library', id: decodeURIComponent(parts[1]) };
  if (parts[0] === 'view' && parts[1]) return { kind: 'view', view: parts[1] as ServerView };
  if (parts[0] === 'search') return { kind: 'view', view: 'search' };
  if (parts[0] === 'library') return { kind: 'view', view: 'library' };
  return { kind: 'view', view: 'home' };
}

function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function text(value: unknown, fallback = 'Sin título'): string {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function titleFor(row: JsonRecord): string {
  return text(row.title ?? row.label ?? row.name ?? row.full_name ?? row.display_name ?? row.subject ?? row.id);
}

function recordId(row: JsonRecord, fallback: string): string {
  const preferred = row.id ?? row.nodus_id ?? row.global_id ?? row.person_id ?? row.author_id
    ?? row.theme_id ?? row.event_id ?? row.place_id ?? row.group_id ?? row.article_id
    ?? row.scene_id ?? row.rule_id ?? row.question_id ?? row.interview_id ?? row.database_id;
  if (preferred !== null && preferred !== undefined && preferred !== '') return String(preferred);
  const discovered = Object.entries(row).find(([key, value]) => /(?:^id$|_id$)/.test(key) && (typeof value === 'string' || typeof value === 'number'))?.[1];
  return discovered === undefined ? fallback : String(discovered);
}

function pageItems(page: PageResponse | undefined): JsonRecord[] {
  if (!page) return [];
  if (Array.isArray(page.items)) return page.items;
  const firstArray = Object.values(page).find(Array.isArray);
  return Array.isArray(firstArray) ? firstArray as JsonRecord[] : [];
}

function formatDate(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(date);
}

function logoFor(type: VaultType): string {
  if (type === 'genealogy') return nodusLogoGold;
  if (type === 'databases') return nodusLogoCrimson;
  if (type === 'estudio') return nodusLogoTeal;
  if (type === 'docencia') return nodusLogoOrange;
  if (type === 'worldbuilding') return nodusLogoViolet;
  if (type === 'testimonios') return nodusLogoCyan;
  return nodusLogo;
}

function visibleNav(type: VaultType): NavItem[] {
  const dedicated = dedicatedVaultNavIds(type);
  const allowed = new Set<View>(dedicated ?? (type === 'genealogy' ? GENEALOGY_VIEW_IDS : STANDARD_VIEW_IDS));
  return NAV_ITEMS.filter((item) => item.id === 'home' || item.id === 'settings' || allowed.has(item.id));
}

function Loading() {
  return <div className="flex h-full items-center justify-center gap-2 text-sm text-neutral-500" role="status" data-testid="loading"><span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-700 border-t-indigo-400" />Cargando…</div>;
}

/** Exact Desktop Home intro markup, kept local so the Server bundle does not pull
 * the native-only Home data pipeline and its privileged bridge dependencies. */
function HomeIntroCard({ eyebrow, title, description, icon }: { eyebrow: string; title: string; description: string; icon: string }) {
  return <header className="rounded-2xl border border-indigo-800/60 bg-indigo-950/25 p-6"><div className="mb-2 flex items-center gap-2 text-indigo-300"><Icon name={icon} size={20} /><span className="text-xs font-semibold uppercase tracking-[0.2em]">{eyebrow}</span></div><h1 className="text-2xl font-semibold text-neutral-100">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">{description}</p></header>;
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return <div className="server-unavailable" data-testid="empty-state"><div><Icon name="inbox" size={32} className="mx-auto text-neutral-600" /><h2 className="mt-3 text-lg font-semibold text-neutral-200">{title}</h2>{detail && <p className="mt-2 text-sm leading-6 text-neutral-500">{detail}</p>}</div></div>;
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const expired = error instanceof ApiError && error.status === 401;
  return <div className="m-6 rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-300" role="alert" data-testid="error-state"><strong>{expired ? 'La sesión ha caducado.' : 'No se ha podido cargar esta vista.'}</strong><p className="mt-1 opacity-80">{error instanceof Error ? error.message : String(error)}</p>{expired ? <a href={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} className="btn mt-3">Iniciar sesión</a> : onRetry && <button className="btn btn-ghost mt-3" onClick={onRetry}>Reintentar</button>}</div>;
}

function ReadOnlyVaultSwitcher({ spaces, active, onSelect, onClose }: { spaces: Space[]; active: Space; onSelect: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const filtered = spaces.filter((space) => space.name.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [onClose]);
  return <div ref={panel} className="server-vault-popover" role="dialog" aria-label="Cambiar de bóveda" data-testid="vault-switcher">
    <div className="border-b border-neutral-800 p-3">
      <div className="mb-2 flex items-center justify-between"><div><div className="text-xs font-semibold text-neutral-200">Bóvedas publicadas</div><div className="text-[10px] text-neutral-600">Selección en modo solo lectura</div></div><button className="rounded p-1 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button></div>
      <label className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"><Icon name="search" size={14} className="text-neutral-600" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-neutral-200 outline-none" placeholder="Buscar una bóveda…" /></label>
    </div>
    <div className="max-h-[55vh] overflow-y-auto p-2">
      {filtered.map((space) => { const type = normalizeVaultType(space.vault?.type); const selected = space.id === active.id; return <button key={space.id} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${selected ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-900'}`} onClick={() => { onSelect(space.id); onClose(); }} data-testid={`vault-option-${space.id}`}>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${selected ? 'bg-white/15' : 'bg-neutral-800'}`}><Icon name={vaultTypeIcon(type)} size={16} /></span>
        <span className="min-w-0 flex-1"><strong className="block truncate text-xs">{space.name}</strong><small className={`block truncate text-[10px] ${selected ? 'text-indigo-100' : 'text-neutral-600'}`}>{vaultTypeLabel(type)} · {space.role || 'Lectura'}</small></span>
        {selected && <Icon name="check" size={14} />}
      </button>; })}
      {filtered.length === 0 && <p className="p-5 text-center text-xs text-neutral-600">No hay coincidencias.</p>}
    </div>
  </div>;
}

function Sidebar({ type, activeView, compact, collapsedGroups, onToggleGroup, onNavigate }: { type: VaultType; activeView: View; compact: boolean; collapsedGroups: Set<string>; onToggleGroup: (id: string) => void; onNavigate: (view: View) => void }) {
  const items = visibleNav(type);
  const home = items.find((item) => item.id === 'home')!;
  const settings = items.find((item) => item.id === 'settings')!;
  const allowed = new Set(items.map((item) => item.id));
  const groups = groupedNav([], NAV_ITEMS.filter((item) => !allowed.has(item.id)).map((item) => item.id));
  const button = (item: NavItem) => {
    const disabled = DISABLED_TOOL_VIEWS.has(item.id);
    return <button key={item.id} data-tour={`nav-${item.id}`} data-testid={`nav-${item.id}`} onClick={() => { if (!disabled) onNavigate(item.id); }} disabled={disabled} aria-disabled={disabled} aria-label={compact ? item.label : undefined} title={disabled ? `${item.label} · fuera de alcance en Server` : compact ? item.label : undefined} className={`flex items-center rounded-lg py-2 text-left text-sm transition-colors ${compact ? 'justify-center px-2' : 'gap-2 px-3'} ${disabled ? 'cursor-not-allowed text-neutral-700' : activeView === item.id ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900'}`}><Icon name={item.icon} className="shrink-0 opacity-70" /><span className={compact ? 'sr-only' : undefined}>{item.label}</span></button>;
  };
  const canonicalHome = NAV_ITEMS.find((item) => item.id === 'home')!;
  const canonicalLibrary = NAV_ITEMS.find((item) => item.id === 'library')!;
  const canonicalSettings = NAV_ITEMS.find((item) => item.id === 'settings')!;
  const renderGroups = (selected: typeof groups) => selected.map((group) => { const collapsed = !compact && collapsedGroups.has(group.id); const active = group.items.some((item) => item.id === activeView); return <div key={group.id} className={`${compact ? 'mt-1 border-t border-neutral-800/70 pt-1' : 'mt-2'} flex flex-col gap-1`}>
    {!compact && <button className={`flex items-center gap-1 px-3 pt-1 pb-0.5 text-left text-[10px] font-semibold uppercase tracking-wider ${active && collapsed ? 'text-indigo-400' : 'text-neutral-600 hover:text-neutral-400'}`} aria-expanded={!collapsed} onClick={() => onToggleGroup(group.id)}><Icon name="chevronRight" size={11} className={`transition-transform ${collapsed ? '' : 'rotate-90'}`} />{group.label}</button>}
    {!collapsed && group.items.map(button)}
  </div>; });
  const tools = groups.filter((group) => group.id === 'tools');
  const specialized = type === 'worldbuilding'
    ? <WorldbuildingSidebar compact={compact} activeView={activeView} onNavigate={(view) => onNavigate(view)} />
    : type === 'prosopography'
      ? <ProsopographySidebar compact={compact} activeView={activeView} onNavigate={(view) => onNavigate(view)} />
      : type === 'testimonios'
        ? <TestimonySidebar compact={compact} activeView={activeView} onNavigate={(view) => onNavigate(view)} />
        : type === 'primary_sources'
          ? <PrimarySourcesSidebar compact={compact} activeView={activeView} onNavigate={(view) => onNavigate(view)} />
          : type === 'estudio'
            ? <StudySidebar compact={compact} activeView={activeView} onNavigate={(view) => onNavigate(view)} />
            : type === 'docencia'
              ? <TeachingSidebar compact={compact} activeView={activeView} onNavigate={(view) => onNavigate(view)} onOpenRoadmap={() => onNavigate('settings')} />
              : null;
  if (specialized) {
    const remaining = type === 'estudio' ? groups.filter((group) => group.id !== 'explore') : tools;
    return <div className="vault-sidebar-scroll mr-[6px] flex h-full min-h-0 flex-col gap-1 overflow-y-auto p-2">{button(canonicalHome)}{button(canonicalLibrary)}{specialized}{renderGroups(remaining)}<div className="mt-auto border-t border-neutral-800/70 pt-2">{button(canonicalSettings)}</div></div>;
  }
  return <div className="vault-sidebar-scroll mr-[6px] flex h-full min-h-0 flex-col gap-1 overflow-y-auto p-2">
    {button(home)}
    {renderGroups(groups)}
    <div className="mt-auto border-t border-neutral-800/70 pt-2">{button(settings)}</div>
  </div>;
}

function AnnotationPanel({ notes, selectedQuote, onAdd }: { notes: Annotation[]; selectedQuote?: string; onAdd: (title: string, content: string, quote?: string) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [title, setTitle] = useState(''); const [content, setContent] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!content.trim()) return; setSaving(true); try { await onAdd(title.trim() || 'Anotación personal', content.trim(), selectedQuote); setTitle(''); setContent(''); setOpen(false); } finally { setSaving(false); } };
  return <aside className="server-annotation-card rounded-xl border border-neutral-800 bg-neutral-950/45 p-4" data-testid="personal-annotations">
    <div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-semibold uppercase tracking-[.16em] text-teal-400">Privado para ti</span><h2 className="mt-1 text-sm font-semibold text-neutral-200">Anotaciones personales</h2></div><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setOpen((value) => !value)} data-testid="annotation-toggle">{open ? 'Cerrar' : 'Añadir'}</button></div>
    {open && <form className="mt-4 grid gap-3" onSubmit={submit}>{selectedQuote && <blockquote className="server-saved-highlight text-xs">{selectedQuote}</blockquote>}<input className="input text-xs" value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="Título" /><textarea className="input min-h-24 text-xs" value={content} maxLength={64000} required onChange={(event) => setContent(event.target.value)} placeholder="Comentario…" /><button className="btn justify-self-start" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar anotación'}</button></form>}
    <div className="mt-4 grid gap-3">{notes.length === 0 ? <p className="text-xs leading-5 text-neutral-600">Los subrayados y notas se guardan en tu cuenta y nunca modifican la publicación.</p> : notes.filter((note) => !note.deletedAt).map((note) => <article key={note.id} className="border-t border-neutral-800 pt-3"><div className="flex justify-between gap-2"><strong className="text-xs text-neutral-300">{note.kind === 'highlight' ? 'Subrayado' : note.title || 'Anotación'}</strong><time className="text-[10px] text-neutral-700">{formatDate(note.updatedAt)}</time></div>{note.quote && <blockquote className="server-saved-highlight mt-2 text-xs">{note.quote}</blockquote>}<MarkdownReader value={text(note.content, '')} className="mt-2 text-xs text-neutral-500" /></article>)}</div>
  </aside>;
}

function Home({ active, summary, notes, onOpen, onAddNote }: { active: Space; summary: SpaceSummary; notes: Annotation[]; onOpen: (view: View) => void; onAddNote: (title: string, content: string, quote?: string) => Promise<void> }) {
  const type = normalizeVaultType(active.vault?.type);
  const counts = summary.counts || active.counts || {};
  const cards = visibleNav(type).filter((item) => item.group === 'explore').slice(0, 6);
  const metricKeys = type === 'academic' ? ['works', 'authors', 'ideas', 'themes'] : type === 'worldbuilding' ? ['persons', 'places', 'events', 'world_groups'] : Object.keys(counts).filter((key) => !key.includes('_links') && !key.includes('authors')).slice(0, 4);
  const metrics = metricKeys.filter((key) => counts[key] !== undefined).map((key) => [key, counts[key]] as const);
  return <div className="h-full overflow-y-auto p-6 server-view-padding" data-testid="overview-view"><div className="mx-auto max-w-5xl">
    <HomeIntroCard eyebrow={`${vaultTypeLabel(type)} · Publicado`} title={active.name} description={active.description || 'Consulta el conocimiento publicado con el mismo espacio de trabajo de Nodus Desktop.'} icon={vaultTypeIcon(type)} />
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="overview-metrics">{metrics.map(([key, value]) => <div key={key} className="rounded-lg border border-neutral-800 px-3 py-2"><div className="truncate text-xs capitalize text-neutral-500">{key.replace(/_/g, ' ')}</div><div className="text-lg font-semibold tabular-nums">{Number(value).toLocaleString('es')}</div></div>)}{metrics.length === 0 && <div className="rounded-lg border border-neutral-800 px-3 py-2"><div className="text-xs text-neutral-500">Recursos</div><div className="text-lg font-semibold">{summary.assets || 0}</div></div>}</div>
    <section className="mt-6"><div className="mb-3 flex items-center justify-between"><div><div className="text-xs font-semibold text-neutral-300">Explorar la bóveda</div><p className="mt-1 text-xs text-neutral-600">Las mismas secciones y jerarquía que en Desktop.</p></div><span className="rounded-full border border-teal-800/60 bg-teal-950/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-teal-300">Solo lectura</span></div><div className="server-record-grid">{cards.map((item) => <button key={item.id} className="server-record-card flex items-center gap-3" onClick={() => onOpen(item.id)} data-testid={`overview-card-${item.id}`}><span className="server-record-icon"><Icon name={item.icon} /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-neutral-200">{item.label}</strong><small className="block truncate text-xs text-neutral-600">Abrir sección publicada</small></span><Icon name="chevronRight" size={14} className="text-neutral-700" /></button>)}</div></section>
    <div className="mt-6"><AnnotationPanel notes={notes} onAdd={onAddNote} /></div>
  </div></div>;
}

function SearchView({ spaceId, onOpen }: { spaceId: string; onOpen: (collection: string, id: string) => void }) {
  const [query, setQuery] = useState(new URLSearchParams(location.search).get('q') || ''); const [items, setItems] = useState<JsonRecord[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState<unknown>();
  const run = async (event?: FormEvent) => { event?.preventDefault(); if (!query.trim()) return; setLoading(true); setError(undefined); try { const response = await api.search(spaceId, query.trim()); setItems(response.results || []); history.replaceState({}, '', `/app/view/search?q=${encodeURIComponent(query.trim())}`); } catch (next) { setError(next); } finally { setLoading(false); } };
  return <ViewFrame eyebrow="Explorar" title="Buscar" description="Busca texto y metadatos dentro de la publicación seleccionada." icon="search"><form className="mb-5 flex gap-2" onSubmit={run}><label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3"><Icon name="search" className="text-neutral-600" /><input className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar obras, ideas, personas…" data-testid="search-input" /></label><button className="btn">Buscar</button></form>{error ? <ErrorState error={error} onRetry={() => void run()} /> : loading ? <Loading /> : items.length === 0 ? <EmptyState title={query ? 'No hay resultados' : 'Empieza con una búsqueda'} /> : <RecordGrid items={items} icon="search" onOpen={(item, index) => onOpen(text(item.collection || item.kind || item.type, 'works'), recordId(item, String(index)))} />}</ViewFrame>;
}

function ViewFrame({ eyebrow, title, description, icon, children }: { eyebrow: string; title: string; description: string; icon: string; children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto p-6 server-view-padding"><div className="mx-auto max-w-5xl"><HomeIntroCard eyebrow={eyebrow} title={title} description={description} icon={icon} /><div className="mt-5">{children}</div></div></div>;
}

function RecordGrid({ items, icon, onOpen }: { items: JsonRecord[]; icon: string; onOpen: (item: JsonRecord, index: number) => void }) {
  return <div className="server-record-grid" data-testid="record-list">{items.map((item, index) => <button key={recordId(item, String(index))} className="server-record-card flex items-start gap-3" onClick={() => onOpen(item, index)}><span className="server-record-icon"><Icon name={icon} /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-neutral-200">{titleFor(item)}</strong><small className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">{text(item.abstract || item.description || item.snippet || item.type, 'Registro publicado')}</small></span><Icon name="chevronRight" size={14} className="mt-2 text-neutral-700" /></button>)}</div>;
}

function CollectionView({ spaceId, view, onOpen }: { spaceId: string; view: View; onOpen: (collection: string, id: string) => void }) {
  const meta = VIEW_COLLECTIONS[view]!; const [page, setPage] = useState<PageResponse>(); const [loading, setLoading] = useState(true); const [error, setError] = useState<unknown>();
  const load = useCallback(async () => { setLoading(true); setError(undefined); try { setPage(await api.collection(spaceId, meta.collection, { limit: '100' })); } catch (next) { setError(next); } finally { setLoading(false); } }, [spaceId, meta.collection]);
  useEffect(() => { void load(); }, [load]); const items = pageItems(page);
  return <ViewFrame eyebrow="Bóveda publicada" title={meta.label} description={`${page?.total ?? items.length} registros disponibles en modo solo lectura.`} icon={meta.icon}>{error ? <ErrorState error={error} onRetry={() => void load()} /> : loading ? <Loading /> : items.length === 0 ? <EmptyState title={`No hay ${meta.label.toLowerCase()} publicados`} detail="El propietario no ha incluido elementos de esta sección en la publicación." /> : <RecordGrid items={items} icon={meta.icon} onOpen={(item, index) => onOpen(meta.collection, recordId(item, String(index)))} />}</ViewFrame>;
}

function DetailView({ spaceId, route, notes, onAddNote }: { spaceId: string; route: Extract<Route, { kind: 'detail' }>; notes: Annotation[]; onAddNote: (title: string, content: string, quote?: string) => Promise<void> }) {
  const [data, setData] = useState<JsonRecord>(); const [loading, setLoading] = useState(true); const [error, setError] = useState<unknown>();
  const load = useCallback(async () => { setLoading(true); setError(undefined); try { setData(await api.detail(spaceId, route.collection, route.id)); } catch (next) { setError(next); } finally { setLoading(false); } }, [spaceId, route.collection, route.id]);
  useEffect(() => { void load(); }, [load]); if (loading) return <Loading />; if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  const nested = Object.values(data || {}).find((value) => value && typeof value === 'object' && !Array.isArray(value)) as JsonRecord | undefined; const item = nested || data || {};
  return <div className="h-full overflow-y-auto p-6 server-view-padding"><div className="mx-auto max-w-5xl"><button className="mb-4 flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-200" onClick={() => history.back()}><Icon name="chevronLeft" size={13} />Volver</button><HomeIntroCard eyebrow="Registro publicado" title={titleFor(item)} description={text(item.abstract || item.description || item.summary, 'Consulta de metadatos en modo solo lectura.')} icon={VIEW_COLLECTIONS[route.view]?.icon || 'book'} /><div className="server-detail-grid mt-5"><article className="rounded-xl border border-neutral-800 bg-neutral-950/45 p-4"><h2 className="mb-3 text-sm font-semibold">Detalles</h2><dl className="server-detail-list">{Object.entries(item).filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object').slice(0, 20).map(([key, value]) => <div key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{text(value)}</dd></div>)}</dl></article><AnnotationPanel notes={notes} onAdd={onAddNote} /></div></div></div>;
}

function LibraryView({ spaceId, onOpen }: { spaceId: string; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<LibraryDocument[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<unknown>();
  const load = useCallback(async () => { setLoading(true); setError(undefined); try { setItems((await api.library(spaceId, { limit: '100' })).items || []); } catch (next) { setError(next); } finally { setLoading(false); } }, [spaceId]);
  useEffect(() => { void load(); }, [load]);
  return <ViewFrame eyebrow="Explorar" title="Biblioteca" description="Documentos publicados para lectura, subrayado y comentario privado." icon="book">{error ? <ErrorState error={error} onRetry={() => void load()} /> : loading ? <Loading /> : items.length === 0 ? <EmptyState title="La biblioteca está vacía" /> : <div className="server-record-grid" data-testid="library-list">{items.map((item) => <button key={item.id} className="server-record-card flex items-start gap-3" onClick={() => onOpen(item.id)}><span className="server-record-icon"><Icon name="book" /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.title || 'Documento sin título'}</strong><small className="mt-1 block truncate text-xs text-neutral-600">{item.creators?.join(', ') || item.originalFileName || 'Documento publicado'}</small></span><Icon name="chevronRight" size={14} className="mt-2 text-neutral-700" /></button>)}</div>}</ViewFrame>;
}

function LibraryDetail({ spaceId, id, notes, onAddNote }: { spaceId: string; id: string; notes: Annotation[]; onAddNote: (title: string, content: string, quote?: string) => Promise<void> }) {
  const [document, setDocument] = useState<LibraryDocument>(); const [readable, setReadable] = useState(''); const [quote, setQuote] = useState(''); const [error, setError] = useState<unknown>();
  const requestSequence = useRef(0);
  useEffect(() => {
    const sequence = ++requestSequence.current;
    setDocument(undefined); setReadable(''); setQuote(''); setError(undefined);
    api.libraryDocument(spaceId, id).then(async (response) => {
      if (sequence !== requestSequence.current) return;
      setDocument(response.document);
      if (response.document?.cleanAvailable) {
        const content = await api.libraryContent(spaceId, id);
        if (sequence === requestSequence.current) setReadable(content);
      }
    }).catch((next) => { if (sequence === requestSequence.current) setError(next); });
    return () => { requestSequence.current += 1; };
  }, [spaceId, id]);
  if (error) return <ErrorState error={error} />; if (!document) return <Loading />;
  const originalUrl = document.originalAvailable ? api.libraryOriginalUrl(spaceId, id) : undefined;
  return <div className="h-full overflow-y-auto p-6 server-view-padding"><div className="mx-auto max-w-6xl"><button className="mb-4 flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-200" onClick={() => history.back()}><Icon name="chevronLeft" size={13} />Biblioteca</button><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">{document.title || 'Documento sin título'}</h1><p className="mt-1 text-xs text-neutral-500">{document.creators?.join(', ') || 'Documento publicado'}</p></div><div className="flex gap-2">{originalUrl && <a className="btn btn-ghost" href={originalUrl} target="_blank" rel="noreferrer">Abrir original</a>}<a className="btn btn-ghost" href={api.libraryDownloadUrl(spaceId, id)} download>Descargar</a></div></div><div className="server-detail-grid"><article className="server-reader-paper"><SafeDocumentReader value={readable || document.abstract || ''} mime={document.cleanAvailable ? 'text/markdown' : document.originalMimeType} sourceUrl={originalUrl} assetBaseUrl={api.libraryAssetBaseUrl(spaceId, id)} onSelection={setQuote} /></article><AnnotationPanel notes={notes} selectedQuote={quote} onAdd={onAddNote} /></div></div></div>;
}

function UnavailableView({ view }: { view: View }) {
  const item = NAV_ITEMS.find((entry) => entry.id === view);
  return <ViewFrame eyebrow="Nodus Server" title={item?.label || 'Sección'} description="Esta superficie conserva su posición y apariencia de Desktop, pero sus acciones dependen de edición local o IA y están desactivadas en Server." icon={item?.icon || 'lock'}><div className="server-unavailable rounded-xl border border-neutral-800 bg-neutral-950/30"><div><Icon name="lock" size={30} className="mx-auto text-neutral-600" /><h2 className="mt-3 text-sm font-semibold text-neutral-300">Disponible solo para consulta cuando exista contenido publicado</h2><p className="mt-2 text-xs leading-5 text-neutral-600">Nodus Server nunca ejecuta escrituras del vault ni herramientas de IA desde esta vista.</p></div></div></ViewFrame>;
}

const PROVIDER_LABELS: Record<string, string> = { openai: 'OpenAI', openrouter: 'OpenRouter', anthropic: 'Anthropic', gemini: 'Google Gemini', mistral: 'Mistral', cohere: 'Cohere' };

function ServerSettings({ csrfToken }: { csrfToken?: string }) {
  const [tab, setTab] = useState<'ai' | 'profile'>('ai');
  const [providers, setProviders] = useState<AIProviderStatus[]>([]);
  const [available, setAvailable] = useState(true);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<unknown>();
  const [preferences, setPreferences] = useState<AIPreferences>({ defaultProvider: 'openai', chatModels: {} });
  const [profile, setProfile] = useState<ServerUserProfile>();
  const load = useCallback(() => Promise.all([api.aiProviders(), api.aiPreferences(), api.profilePreferences()]).then(([value, aiProfile, userProfile]) => { setProviders(value.providers); setAvailable(value.credentialsAvailable); setPreferences(aiProfile.preferences); setProfile(userProfile.profile); }).catch(setError), []);
  useEffect(() => { void load(); }, [load]);
  const save = async (provider: string) => {
    const value = keys[provider]?.trim(); if (!value) return;
    setBusy(provider); setError(undefined); setMessage('');
    try { await api.saveAICredential(provider, value, csrfToken); setKeys((current) => ({ ...current, [provider]: '' })); setMessage(`${PROVIDER_LABELS[provider] || provider}: credencial guardada.`); await load(); }
    catch (next) { setError(next); } finally { setBusy(''); }
  };
  const remove = async (provider: string) => {
    setBusy(provider); setError(undefined); setMessage('');
    try { await api.removeAICredential(provider, csrfToken); setMessage(`${PROVIDER_LABELS[provider] || provider}: credencial eliminada.`); await load(); }
    catch (next) { setError(next); } finally { setBusy(''); }
  };
  const savePreferences = async () => { setBusy('preferences'); setError(undefined); try { const result = await api.updateAIPreferences(preferences, csrfToken); setPreferences(result.preferences); setMessage('Preferencias de chat guardadas.'); } catch (next) { setError(next); } finally { setBusy(''); } };
  const settingsTab = (id: 'ai' | 'profile', icon: string, label: string) => <button
    className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${tab === id ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm shadow-indigo-950/20' : 'border-neutral-800 bg-neutral-900/40 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'}`}
    onClick={() => setTab(id)}
    onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setTab(id === 'ai' ? 'profile' : 'ai'); } }}
    aria-selected={tab === id}
    aria-controls={`settings-panel-${id}`}
    id={`settings-tab-${id}`}
    tabIndex={tab === id ? 0 : -1}
    role="tab"
    data-testid={`settings-tab-${id}`}
  ><Icon name={icon} size={14} />{label}</button>;
  return <div className="server-view-scroll h-full p-6 server-view-padding" data-testid="settings-view">
    <div className="mx-auto max-w-6xl">
      <header className="mb-4 flex flex-wrap items-start gap-4">
        <div><h1 className="text-xl font-semibold">Ajustes</h1><p className="mt-1 text-sm text-neutral-500">Configura tu cuenta de Nodus Server con la misma superficie de trabajo del resto de la aplicación.</p><p className="mt-1 text-xs text-neutral-600">Las credenciales y los datos privados pertenecen únicamente al usuario autenticado.</p></div>
      </header>
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Secciones de ajustes">
        {settingsTab('ai', 'sparkles', 'IA y modelos')}
        {settingsTab('profile', 'user', 'Perfil y privacidad')}
      </div>
      {error != null && <ErrorState error={error} />}
      {message && <p className="mb-3 rounded-lg border border-teal-900/70 bg-teal-950/20 px-3 py-2 text-xs text-teal-400" role="status">{message}</p>}
      {tab === 'ai' ? <section className="server-settings-grid" data-testid="user-ai-settings" role="tabpanel" id="settings-panel-ai" aria-labelledby="settings-tab-ai">
        <article className="rounded-xl border border-neutral-800 bg-neutral-950/45 p-5">
          <div className="mb-4"><h2 className="text-sm font-semibold text-neutral-100">Proveedores de IA</h2><p className="mt-1 text-xs leading-5 text-neutral-500">Cada petición se ejecuta únicamente con la credencial de esta cuenta. Una clave guardada nunca vuelve a mostrarse.</p></div>
          {!available && <p className="mb-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-300">El operador debe montar una keyring externa para habilitar IA en Server.</p>}
          <div className="grid gap-3">{providers.map((entry) => <form key={entry.provider} className="rounded-lg border border-neutral-800 p-3" onSubmit={(event) => { event.preventDefault(); void save(entry.provider); }}>
            <div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-sm text-neutral-200">{PROVIDER_LABELS[entry.provider] || entry.provider}</strong><div className={`mt-0.5 text-[11px] ${entry.configured ? 'text-teal-400' : 'text-neutral-600'}`}>{entry.configured ? 'Configurada' : 'Sin configurar'}{entry.supportsEmbeddings ? ' · compatible con el contrato del índice' : ''}</div></div>{entry.configured && <button type="button" className="btn btn-ghost text-xs" disabled={busy === entry.provider} onClick={() => void remove(entry.provider)}>Eliminar</button>}</div>
            <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row"><input className="input min-w-0 flex-1 text-xs" type="password" autoComplete="new-password" value={keys[entry.provider] || ''} onChange={(event) => setKeys((current) => ({ ...current, [entry.provider]: event.target.value }))} placeholder={entry.configured ? 'Introduce una nueva clave para sustituirla' : 'API key'} disabled={!available || busy === entry.provider} aria-label={`API key de ${PROVIDER_LABELS[entry.provider] || entry.provider}`} /><button className="btn text-xs" disabled={!available || busy === entry.provider || !keys[entry.provider]?.trim()}>{busy === entry.provider ? 'Guardando…' : entry.configured ? 'Sustituir' : 'Guardar'}</button></div>
          </form>)}</div>
        </article>
        <article className="rounded-xl border border-neutral-800 bg-neutral-950/45 p-5 text-xs leading-5 text-neutral-500">
          <h2 className="mb-3 text-sm font-semibold text-neutral-200">Modelo de conversación</h2>
          <label className="block">Proveedor predeterminado<select className="input mt-1 w-full text-xs" value={preferences.defaultProvider || 'openai'} onChange={(event) => setPreferences((current) => ({ ...current, defaultProvider: event.target.value }))}>{providers.map((entry) => <option key={entry.provider} value={entry.provider}>{PROVIDER_LABELS[entry.provider] || entry.provider}</option>)}</select></label>
          <label className="mt-3 block">Modelo<input className="input mt-1 w-full text-xs" value={preferences.chatModels?.[preferences.defaultProvider || 'openai'] || ''} onChange={(event) => { const provider = preferences.defaultProvider || 'openai'; setPreferences((current) => ({ ...current, chatModels: { ...(current.chatModels || {}), [provider]: event.target.value } })); }} placeholder="Nombre exacto del modelo" maxLength={200} /></label>
          <button className="btn mt-3 text-xs" disabled={busy === 'preferences'} onClick={() => void savePreferences()}>{busy === 'preferences' ? 'Guardando…' : 'Guardar modelo'}</button>
        </article>
      </section> : <section className="grid gap-4 md:grid-cols-2" data-testid="profile-privacy-settings" role="tabpanel" id="settings-panel-profile" aria-labelledby="settings-tab-profile">
        <article className="rounded-xl border border-neutral-800 bg-neutral-950/45 p-5 text-xs leading-5 text-neutral-500" data-testid="inherited-desktop-profile">
          <div className="mb-3 flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-950/50 text-indigo-300"><Icon name="refresh" size={16} /></span><div><h2 className="text-sm font-semibold text-neutral-200">Perfil heredado de Desktop</h2><p className={profile?.values ? 'text-teal-400' : 'text-neutral-600'}>{profile?.values ? 'Sincronizado' : 'Pendiente de sincronización'}</p></div></div>
          {profile?.values ? <><p>{profile.values.ai.favorites.length} modelos favoritos · modo {profile.values.ai.modelSettingsMode === 'advanced' ? 'avanzado' : 'básico'} · interfaz {profile.values.appearance.uiLanguage.toUpperCase()}.</p>{profile.updatedAt && <p className="mt-2 text-[11px] text-neutral-600">Última actualización: {new Date(profile.updatedAt).toLocaleString()}</p>}</> : <p>Conecta esta cuenta mediante Connected Vault para traer sus preferencias portables.</p>}
          <p className="mt-3 border-t border-neutral-800 pt-3 text-[11px] text-neutral-600">Las claves, tokens, rutas locales, copias de seguridad y embeddings nunca se importan.</p>
        </article>
        <article className="rounded-xl border border-neutral-800 bg-neutral-950/45 p-5 text-xs leading-5 text-neutral-500">
          <div className="mb-3 flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-950/40 text-teal-300"><Icon name="lock" size={16} /></span><h2 className="text-sm font-semibold text-neutral-200">Privacidad y compatibilidad</h2></div>
          <p>Las conversaciones, Nodi, notas, trabajos de IA y preferencias son privados para esta cuenta aunque el vault sea compartido.</p>
          <h3 className="mt-4 border-t border-neutral-800 pt-3 font-semibold text-neutral-300">Embeddings bloqueados por el vault</h3><p className="mt-1">El proveedor, modelo, dimensionalidad y preprocesado los determina el índice existente. Nodus Server no permite mezclarlos ni sustituirlos silenciosamente.</p>
        </article>
      </section>}
    </div>
  </div>;
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromLocation); const [me, setMe] = useState<MeResponse>(); const [activeId, setActiveId] = useState(''); const [summary, setSummary] = useState<SpaceSummary>(); const [error, setError] = useState<unknown>(); const [theme, setTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('nodus-web-theme') === 'light' ? 'light' : 'dark'); const [sidebarWidth, setSidebarWidth] = useState(() => Math.max(64, Math.min(360, Number(localStorage.getItem('nodus-server-sidebar-width')) || 176))); const [navCollapsed, setNavCollapsed] = useState(false); const [drawer, setDrawer] = useState(false); const [vaultsOpen, setVaultsOpen] = useState(false); const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set()); const [notes, setNotes] = useState<Annotation[]>([]); const [annotationVersion, setAnnotationVersion] = useState(0);
  useEffect(() => { const listener = () => setRoute(routeFromLocation()); addEventListener('popstate', listener); return () => removeEventListener('popstate', listener); }, []);
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); document.documentElement.classList.toggle('light', theme === 'light'); document.documentElement.dataset.theme = theme; localStorage.setItem('nodus-web-theme', theme); }, [theme]);
  const summarySequence = useRef(0); const annotationSequence = useRef(0);
  useEffect(() => { api.me().then((value) => { setMe(value); setActiveId((current) => {
    if (value.spaces?.some((space) => space.id === current)) return current;
    const remembered = localStorage.getItem(ACTIVE_VAULT_STORAGE_KEY) || '';
    return value.spaces?.some((space) => space.id === remembered) ? remembered : value.spaces?.[0]?.id || '';
  }); }).catch(setError); }, []);
  const spaces = me?.spaces || []; const active = useMemo(() => spaces.find((space) => space.id === activeId) || spaces[0], [spaces, activeId]); const type = normalizeVaultType(active?.vault?.type); const activeView = route.view;
  useEffect(() => {
    if (!active?.id) return;
    const sequence = ++summarySequence.current; localStorage.setItem(ACTIVE_VAULT_STORAGE_KEY, active.id);
    setSummary(undefined); setError(undefined);
    api.space(active.id).then((value) => { if (sequence === summarySequence.current) setSummary(value); }).catch((next) => { if (sequence === summarySequence.current) setError(next); });
    return () => { summarySequence.current += 1; };
  }, [active?.id]);
  const resource = route.kind === 'library-detail' ? 'library' : route.kind === 'detail' ? route.collection : route.view; const documentId = route.kind === 'library-detail' || route.kind === 'detail' ? route.id : route.view;
  useEffect(() => {
    if (!active?.id) return;
    const sequence = ++annotationSequence.current; setAnnotationVersion(0); setNotes([]);
    api.annotations(active.id, resource, documentId).then((response) => { if (sequence !== annotationSequence.current) return; setAnnotationVersion(response.version); setNotes(response.annotations.filter((note) => !note.deletedAt)); }).catch(() => { if (sequence !== annotationSequence.current) return; setAnnotationVersion(0); setNotes([]); });
    return () => { annotationSequence.current += 1; };
  }, [active?.id, resource, documentId]);
  const openView = (view: View) => { if (DISABLED_TOOL_VIEWS.has(view)) return; navigate(view === 'home' ? '/app' : `/app/view/${view}`); setDrawer(false); };
  const addNote = async (title: string, content: string, quote?: string) => { if (!active?.id) return; const target = { spaceId: active.id, resource, documentId, sequence: annotationSequence.current }; const now = new Date().toISOString(); const id = crypto.randomUUID?.() || `note-${Date.now()}`; const result = await api.addAnnotation(target.spaceId, { id, resource: target.resource, documentId: target.documentId, kind: quote ? 'highlight' : 'comment', title, content, quote: quote || '', baseVersion: annotationVersion, createdAt: now, updatedAt: now, deletedAt: null }, me?.csrfToken); if (target.sequence !== annotationSequence.current) return; setAnnotationVersion(result.version); setNotes(result.annotations.filter((note) => note.resource === target.resource && note.documentId === target.documentId && !note.deletedAt)); };
  const resize = (event: ReactPointerEvent) => { const start = event.clientX; const initial = sidebarWidth; const move = (next: PointerEvent) => setSidebarWidth(Math.max(64, Math.min(360, initial + next.clientX - start))); const up = () => { document.body.classList.remove('is-resizing-sidebar'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); }; document.body.classList.add('is-resizing-sidebar'); addEventListener('pointermove', move); addEventListener('pointerup', up); };
  useEffect(() => { localStorage.setItem('nodus-server-sidebar-width', String(sidebarWidth)); }, [sidebarWidth]);
  if (error && !me) return <div className="h-full"><ErrorState error={error} /></div>; if (!me) return <Loading />; if (spaces.length === 0) return <EmptyState title="No tienes bóvedas asignadas" detail="Solicita acceso a un administrador de Nodus Server." />; if (error && !summary) return <ErrorState error={error} />; if (!active || !summary) return <Loading />;
  const content = (() => {
    if (route.kind === 'library-detail') return <LibraryDetail spaceId={active.id} id={route.id} notes={notes} onAddNote={addNote} />;
    if (route.kind === 'detail') return <DetailView spaceId={active.id} route={route} notes={notes} onAddNote={addNote} />;
    if (route.view === 'home') return <Home active={active} summary={summary} notes={notes} onOpen={openView} onAddNote={addNote} />;
    if (route.view === 'search') return <SearchView spaceId={active.id} onOpen={(collection, id) => navigate(`/app/detail/search/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`)} />;
    if (route.view === 'library') return <LibraryView spaceId={active.id} onOpen={(id) => navigate(`/app/library/${encodeURIComponent(id)}`)} />;
    if (route.view === 'ideas') return <IdeasServerView key={active.id} spaceId={active.id} />;
    if (route.view === 'authors') return <div className="server-authors-composite"><AuthorsServerView key={active.id} spaceId={active.id} /><AuthorSynthesisPanel key={`ai-${active.id}`} spaceId={active.id} csrfToken={me.csrfToken} /></div>;
    if (route.view === 'graph') return <GraphServerView key={active.id} spaceId={active.id} onOpenIdea={(id) => navigate(`/app/detail/ideas/ideas/${encodeURIComponent(id)}`)} />;
    if (route.view === 'dictionary') return <DictionaryServerView key={active.id} spaceId={active.id} csrfToken={me.csrfToken} />;
    if (route.view === 'deepResearch') return <DeepResearchServerView key={active.id} spaceId={active.id} csrfToken={me.csrfToken} />;
    if (route.view === 'workspace' || route.view === 'notes') return <PrivateNotesServerView key={active.id} spaceId={active.id} csrfToken={me.csrfToken} />;
    if (route.view === 'assistant') return <ConversationServerView key={active.id} spaceId={active.id} csrfToken={me.csrfToken} mode="assistant" />;
    if (route.view === 'nodi') return <ConversationServerView key={active.id} spaceId={active.id} csrfToken={me.csrfToken} mode="nodi" />;
    if (route.view === 'settings') return <ServerSettings csrfToken={me.csrfToken} />;
    if (VIEW_COLLECTIONS[route.view as View]) return <CollectionView spaceId={active.id} view={route.view as View} onOpen={(collection, id) => navigate(`/app/detail/${route.view}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`)} />;
    return <UnavailableView view={route.view as View} />;
  })();
  return <div className={`server-desktop-surface h-full flex flex-col ${type}`} style={{ '--vault-accent': VAULT_TYPE_COLORS[type], '--server-sidebar-width': `${sidebarWidth}px` } as React.CSSProperties} data-testid="app-shell" data-surface="server">
    <header className="app-titlebar relative flex h-11 shrink-0 items-center border-b border-neutral-800" data-platform="web">
      <button data-testid="sidebar-header-toggle" className="server-header-logo relative flex h-full shrink-0 items-center justify-center px-2 font-semibold text-lg tracking-tight transition-colors hover:bg-neutral-900/70" style={{ width: navCollapsed ? 64 : sidebarWidth }} onClick={() => { if (matchMedia('(max-width: 760px)').matches) setDrawer((value) => !value); else setNavCollapsed((value) => !value); }} aria-label="Alternar navegación" aria-controls="server-sidebar-navigation" aria-expanded={matchMedia('(max-width: 760px)').matches ? drawer : !navCollapsed}><span className="flex items-center justify-center gap-2"><img src={logoFor(type)} alt="" className="h-7 w-7" data-testid="nodus-logo" data-vault-logo={type} /><span className={`server-header-brand-text ${sidebarWidth < 150 || navCollapsed ? 'sr-only' : ''}`}>Nodus</span></span>{!navCollapsed && sidebarWidth >= 150 && <Icon name="chevronLeft" size={14} className="server-header-chevron absolute right-2 text-neutral-600" />}</button>
      <button data-testid="header-vault-badge" aria-expanded={vaultsOpen} onClick={() => setVaultsOpen((value) => !value)} className="header-vault-badge absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-indigo-700/60 bg-indigo-950/30 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-200 transition-colors hover:border-indigo-500 hover:bg-indigo-900/40"><Icon name={vaultTypeIcon(type)} size={13} /><span className="hidden xl:inline">{vaultTypeLabel(type)}</span><Icon name="chevronDown" size={12} className={vaultsOpen ? 'rotate-180' : ''} /></button>
      <div className="flex-1" /><div className="header-action-rail flex items-center gap-0.5 pr-4" data-testid="header-actions"><button className="server-mobile-menu rounded-lg p-2 text-neutral-400 hover:bg-neutral-900" onClick={() => setDrawer(true)} aria-label="Abrir navegación"><Icon name="menu" /></button><button className="server-header-secondary rounded-lg p-2 text-neutral-400 hover:bg-neutral-900 hover:text-white" onClick={() => openView('search')} title="Comandos"><Icon name="search" /></button><button className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-900 hover:text-white" onClick={() => navigate('/app/view/nodi')} title="Nodi" data-testid="header-nodi"><Icon name="sparkles" /></button><button className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-900 hover:text-white" onClick={() => navigate('/app/view/assistant')} title="Asistente" data-testid="header-assistant"><Icon name="chat" /></button><button className={`rounded-lg p-2 transition-colors ${activeView === 'settings' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:bg-neutral-900 hover:text-white'}`} onClick={() => openView('settings')} title="Ajustes" aria-label="Ajustes" aria-current={activeView === 'settings' ? 'page' : undefined} data-testid="header-settings"><Icon name="settings" /></button><button className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-900 hover:text-white" onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'} data-testid="theme-toggle"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button><a className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-900 hover:text-white" href="/account" title="Cuenta"><Icon name="user" /></a></div>
      {vaultsOpen && <ReadOnlyVaultSwitcher spaces={spaces} active={active} onSelect={(id) => { localStorage.setItem(ACTIVE_VAULT_STORAGE_KEY, id); setActiveId(id); navigate('/app'); }} onClose={() => setVaultsOpen(false)} />}
    </header>
    <div className="server-readonly-banner"><span className="server-readonly-dot" /><strong>Vault conectado</strong><span>Lectura compartida; conversaciones, notas y borradores de IA permanecen privados hasta una publicación explícita.</span></div>
    <div className="flex min-h-0 flex-1"><nav id="server-sidebar-navigation" className={`server-desktop-nav relative shrink-0 overflow-hidden border-r border-neutral-800 ${navCollapsed ? 'hidden' : ''}`} data-testid="resizable-sidebar" data-sidebar-compact={sidebarWidth <= 88 ? 'true' : 'false'} data-drawer={drawer ? 'true' : 'false'}><Sidebar type={type} activeView={activeView as View} compact={sidebarWidth <= 88} collapsedGroups={collapsedGroups} onToggleGroup={(id) => setCollapsedGroups((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onNavigate={openView} /><div className="server-sidebar-resizer" onPointerDown={resize} /></nav><main className="server-main min-w-0 flex-1" id="main-content"><Suspense fallback={<Loading />}>{content}</Suspense></main></div>
    {drawer && <button className="server-drawer-scrim" aria-label="Cerrar navegación" onClick={() => setDrawer(false)} />}
  </div>;
}
