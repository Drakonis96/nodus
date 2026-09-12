import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { setActiveLang } from '../src/i18n';
import '../src/index.css';
const args = new URLSearchParams(location.search);
const vault = args.get('vault') ?? 'academic';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const literal = [
  { kind: 'note', id: 'note', title: 'Memoria oral', snippet: 'Historias familiares y relatos de la comunidad.' },
  { kind: 'work', id: 'work', title: 'Archivo de memoria oral', snippet: 'Documentación y fuentes de la vida cotidiana.', zoteroKey: 'Z1' },
];
const semantic = [
  { kind: 'work', id: 'work', title: 'Archivo de memoria oral', similarity: .82 },
  { kind: 'idea', id: 'idea', title: 'Recuerdos compartidos', snippet: 'La transmisión del pasado entre generaciones.', similarity: .88 },
];
let lastOptions: unknown;
const api = {
  listSavedSearches: async () => [],
  globalSearch: async (query: string) => { await wait(query === 'antigua' ? 700 : 30); return query === 'antigua' ? [{ kind: 'note', id: 'old', title: 'RESPUESTA ANTIGUA' }] : literal; },
  semanticSearch: async (query: string, options: any) => { lastOptions = options; await wait(100); if (args.has('fail')) throw new Error('Proveedor no disponible'); return { available: true, results: semantic }; },
  searchVaultContent: async (_query: string, kinds: string[], semantics = true) => { lastOptions = kinds; await wait(semantics ? 100 : 20); return { semanticAvailable: true, results: [
    { kind: kinds[0], id: 'one', title: 'Memoria oral', snippet: 'Historias familiares y relatos de la comunidad.', databaseId: 'database' },
    ...(semantics && kinds[1] ? [{ kind: kinds[1], id: 'two', title: 'Recuerdos compartidos', snippet: 'La transmisión del pasado entre generaciones.', databaseId: 'database' }] : []),
  ].filter((hit) => kinds.includes(hit.kind)) }; },
  getStudyWorkspace: async () => ({ courses: [], subjects: [], topics: [] }),
  getStudySearchIndexStatus: async () => ({ state: 'ready', indexedEntries: 2, embeddedEntries: 2 }),
  listStudySavedSearches: async () => [], listStudySearchHistory: async () => [], onStudySearchProgress: () => () => {},
  searchStudyCorpus: async (_query: string, options: any) => { lastOptions = options; return { results: options.kinds.length ? [{ indexId: 'study', kind: options.kinds[0], title: 'Memoria oral', snippet: 'Recuerdos compartidos', location: {}, highlightedTerms: [], score: { fusion: .9 } }] : [], elapsedMs: 20 }; },
  testimonyIndexStatus: async () => ({ indexed: 2, indexable: 2, segments: 12, stale: 0 }),
  searchTestimonies: async (_query: string, kinds: string[]) => literal.map((hit) => ({ ...hit, kind: 'interview' })).filter((hit) => kinds.includes(hit.kind)),
  searchTestimoniesBySemantics: async () => [{ segmentId: 'segment', interviewId: 'interview', title: 'Testimonio', interviewTitle: 'Recuerdos compartidos', similarity: .88, text: 'La transmisión del pasado.', tStart: 85, speakerLabel: 'Ana' }],
  searchPrimarySourceCorpus: async (request: any) => { lastOptions = request; return { queryText: request.query, results: [], total: 0, elapsedMs: 20, facets: { layers: [], repositories: [], levels: [], formats: [], persons: [], places: [], reviewStatuses: [], accessStatuses: [] } }; },
};
(window as any).nodus = api;
(window as any).searchTestOptions = () => lastOptions;
setActiveLang('es');
document.documentElement.classList.toggle('dark', args.has('dark'));
document.documentElement.classList.toggle('light', !args.has('dark'));
document.documentElement.classList.add(vault);
const Search = lazy(() => import('../src/views/SearchView').then((m) => ({ default: m.SearchView })));
const Study = lazy(() => import('../src/views/StudySearchView').then((m) => ({ default: m.StudySearchView })));
const Primary = lazy(() => import('../src/views/PrimarySourcesSearchView').then((m) => ({ default: m.PrimarySourcesSearchView })));
const Testimony = lazy(() => import('../src/views/TestimonySearchView').then((m) => ({ default: m.TestimonySearchView })));
const Databases = lazy(() => import('../src/views/DatabasesSearchView').then((m) => ({ default: m.DatabasesSearchView })));
const Prosop = lazy(() => import('../src/views/ProsopSearchView').then((m) => ({ default: m.ProsopSearchView })));
const World = lazy(() => import('../src/views/WorldSearchView').then((m) => ({ default: m.WorldSearchView })));
const noop = () => {};
const view = vault === 'databases' ? <Databases onOpenDatabase={noop} /> : vault === 'prosopography' ? <Prosop /> : vault === 'worldbuilding' ? <World onNavigate={noop} /> : ['estudio', 'docencia'].includes(vault) ? <Study onOpenDocument={noop} onOpenMaterial={noop} onOpenRecording={noop} /> : vault === 'testimonios' ? <Testimony onOpenInterview={noop} onNavigate={noop} /> : vault === 'primary_sources' ? <Primary onOpenSource={noop} onOpenNote={noop} onNavigate={noop} /> : <Search vaultType={vault as any} onOpenGraph={noop} onOpenNote={noop} onOpenGaps={noop} onOpenPerson={noop} onOpenTimeline={noop} onOpenArchive={noop} />;
createRoot(document.getElementById('root')!).render(<div className="h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"><Suspense fallback="Cargando…">{view}</Suspense></div>);
