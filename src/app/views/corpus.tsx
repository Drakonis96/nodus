// The academic corpus: the library, the graph and everything derived from it,
// plus the two sections whose engine changes with the vault (search, notes).
import { lazy } from 'react';
import type { ViewRenderer } from '../ViewContext';

const Library = lazy(() => import('../../views/Library').then((module) => ({ default: module.Library })));
const GraphView = lazy(() => import('../../views/GraphView').then((module) => ({ default: module.GraphView })));
const ArgumentMapView = lazy(() => import('../../views/ArgumentMapView').then((module) => ({ default: module.ArgumentMapView })));
const IdeasView = lazy(() => import('../../views/IdeasView').then((module) => ({ default: module.IdeasView })));
const AuthorsView = lazy(() => import('../../views/AuthorsView').then((module) => ({ default: module.AuthorsView })));
const GapsView = lazy(() => import('../../views/GapsView').then((module) => ({ default: module.GapsView })));
const DebateView = lazy(() => import('../../views/DebateView').then((module) => ({ default: module.DebateView })));
const ResearchMapView = lazy(() => import('../../views/ResearchMapView').then((module) => ({ default: module.ResearchMapView })));
const HypothesisLabView = lazy(() => import('../../views/HypothesisLabView').then((module) => ({ default: module.HypothesisLabView })));
const ReadingPathView = lazy(() => import('../../views/ReadingPathView').then((module) => ({ default: module.ReadingPathView })));
const WritingWorkshopView = lazy(() => import('../../views/WritingWorkshopView').then((module) => ({ default: module.WritingWorkshopView })));
const DeepResearchView = lazy(() => import('../../views/DeepResearchView').then((module) => ({ default: module.DeepResearchView })));
const ProjectsView = lazy(() => import('../../views/ProjectsView').then((module) => ({ default: module.ProjectsView })));
const ImmersionView = lazy(() => import('../../views/ImmersionView').then((module) => ({ default: module.ImmersionView })));
const NotesView = lazy(() => import('../../views/NotesView').then((module) => ({ default: module.NotesView })));
const SearchView = lazy(() => import('../../views/SearchView').then((module) => ({ default: module.SearchView })));
const PrimarySourcesSearchView = lazy(() => import('../../views/PrimarySourcesSearchView').then((module) => ({ default: module.PrimarySourcesSearchView })));
const PrimarySourcesNotesView = lazy(() => import('../../views/PrimarySourcesNotesView').then((module) => ({ default: module.PrimarySourcesNotesView })));
const TestimonySearchView = lazy(() => import('../../views/TestimonySearchView').then((module) => ({ default: module.TestimonySearchView })));

export const corpusViews = {
  library: ({ activeVault, libraryTarget, navigate, openAssistant, setCollectionsOpen, setView }) => (
    <Library
      vaultId={activeVault?.id ?? null}
      target={libraryTarget}
      vaultType={activeVault?.type}
      onOpenCollections={() => setCollectionsOpen(true)}
      onOpenGraph={(target) => navigate('graph', target)}
      onOpenAssistant={openAssistant}
      onOpenArchive={() => setView('archive')}
    />
  ),
  graph: ({ graphTarget, reloadSettings, settings }) => <GraphView settings={settings} onSettingsChange={reloadSettings} target={graphTarget} />,
  argument: ({ settings }) => <ArgumentMapView settings={settings} />,
  ideas: ({ activeVault, ideaTarget, navigate, openAssistant }) => (
    <IdeasView
      vaultId={activeVault?.id ?? null}
      target={ideaTarget}
      onOpenGraph={(target) => navigate('graph', target)}
      onOpenAssistant={openAssistant}
    />
  ),
  authors: ({ activeVault, navigate, settings }) => (
    <AuthorsView
      vaultId={activeVault?.id ?? null}
      settings={settings}
      onOpenGraph={(target) => navigate('graph', target)}
    />
  ),
  immersion: ({ navigate, settings }) => <ImmersionView settings={settings} onOpenGraph={(target) => navigate('graph', target)} />,
  gaps: ({ activeVault, navigate, openAssistant, setView }) => (
    <GapsView
      vaultId={activeVault?.id ?? null}
      onOpenGraph={(target) => navigate('graph', target)}
      onOpenAssistant={openAssistant}
      onOpenDebates={() => setView('debate')}
    />
  ),
  debate: ({ navigate, openAssistant }) => (
    <DebateView onOpenGraph={(target) => navigate('graph', target)} onOpenAssistant={openAssistant} />
  ),
  research: ({ navigate, openAssistant, setView }) => (
    <ResearchMapView
      onOpenGraph={(target) => navigate('graph', target)}
      onOpenAssistant={openAssistant}
      onOpenDebates={() => setView('debate')}
    />
  ),
  hypothesis: ({ navigate, openAssistant, settings }) => (
    <HypothesisLabView
      settings={settings}
      onOpenGraph={(target) => navigate('graph', target)}
      onOpenAssistant={openAssistant}
    />
  ),
  reading: ({ navigate, openAssistant }) => (
    <ReadingPathView onOpenGraph={(target) => navigate('graph', target)} onOpenAssistant={openAssistant} />
  ),
  writing: ({ navigate, settings }) => <WritingWorkshopView settings={settings} onOpenGraph={(target) => navigate('graph', target)} />,
  deepResearch: ({ isGenealogy, navigate, settings }) => (
    <DeepResearchView settings={settings} isGenealogy={isGenealogy} onOpenGraph={(target) => navigate('graph', target)} />
  ),
  projects: ({ settings }) => <ProjectsView settings={settings} />,

  // Searching a testimonies vault is NOT searching a Zotero corpus: what has to be
  // found are passages with their speaker, their minute and their access condition.
  // Same sidebar section, different engine behind it.
  search: ({ activeVault, isPrimarySources, isTestimonios, navigate, openNoteFromSearch, openPrimarySourceTarget, openTestimonyInterview, setNoteTarget, setPersonsTarget, setView }) => {
    if (isTestimonios) {
      return (
        <TestimonySearchView
          onOpenInterview={openTestimonyInterview}
          onNavigate={(target) => setView(target)}
        />
      );
    }
    if (isPrimarySources) {
      return (
        <PrimarySourcesSearchView
          onOpenSource={openPrimarySourceTarget}
          onOpenNote={(id) => {
            setNoteTarget({ id, nonce: Date.now() });
            setView('notes');
          }}
          onNavigate={setView}
        />
      );
    }
    return (
      <SearchView
        vaultType={activeVault?.type}
        onOpenGraph={(target) => navigate('graph', target)}
        onOpenNote={openNoteFromSearch}
        onOpenGaps={() => setView('gaps')}
        onOpenPerson={(id) => {
          setPersonsTarget({ id, nonce: Date.now() });
          setView('persons');
        }}
        onOpenTimeline={() => setView('timeline')}
        onOpenArchive={() => setView('archive')}
      />
    );
  },

  notes: ({ isPrimarySources, isTestimonios, navigate, noteTarget, openPrimarySourceTarget, openTestimonyLink }) => (isPrimarySources
    ? <PrimarySourcesNotesView focusNote={noteTarget} onOpenSource={openPrimarySourceTarget} />
    : (
      <NotesView
        onOpenGraph={(target) => navigate('graph', target)}
        focusNote={noteTarget}
        onTestimonyLink={isTestimonios ? openTestimonyLink : undefined}
      />
    )),
} satisfies Record<string, ViewRenderer>;
