// «Inicio» is one section of the sidebar and nine different screens.
//
// It is the one view whose implementation is chosen by vault type rather than by
// id, so it gets its own file instead of being split across the domain ones: what
// a reader needs here is the whole dispatch in view, in order.
import { lazy } from 'react';
import { HomeView, GenealogyHome, DatabasesHome } from '../../views/HomeView';
import type { ViewRenderer } from '../ViewContext';

const StudyHome = lazy(() => import('../../views/StudyHome').then((module) => ({ default: module.StudyHome })));
const TeachingHome = lazy(() => import('../../views/TeachingHome').then((module) => ({ default: module.TeachingHome })));
const WorldbuildingHome = lazy(() => import('../../views/WorldbuildingHome').then((module) => ({ default: module.WorldbuildingHome })));
const ProsopographyHome = lazy(() => import('../../views/ProsopographyHome').then((module) => ({ default: module.ProsopographyHome })));
const PrimarySourcesHomeView = lazy(() => import('../../views/PrimarySourcesHomeView').then((module) => ({ default: module.PrimarySourcesHomeView })));
const TestimonyHome = lazy(() => import('../../views/TestimonyHome').then((module) => ({ default: module.TestimonyHome })));

export const renderHome: ViewRenderer = (ctx) => {
  const {
    settings, activeVault, hasData, demoBusy, lastSync, syncing,
    databases, setView, navigate, openAssistant, onSync, openLibraryBucket,
    openPrimarySourceTarget, openTestimonyInterview, setNoteTarget,
    setActiveDatabaseId, createDatabase, importCsv, importNotion,
  } = ctx;
  const showDemoOffer = hasData === false && !settings.demoMode;

  if (ctx.isGenealogy) {
    return (
      <GenealogyHome
        settings={settings}
        onNavigate={(target) => navigate(target)}
        onOpenAssistant={() => openAssistant()}
        showDemoOffer={showDemoOffer}
        demoBusy={demoBusy}
        onLoadDemo={ctx.loadDemo}
        onLoadGenealogyDemo={ctx.loadGenealogyDemo}
        onLoadDatabasesDemo={ctx.loadDatabasesDemo}
      />
    );
  }
  if (ctx.isPrimarySources) {
    return (
      <PrimarySourcesHomeView
        vault={activeVault}
        onNavigate={setView}
        onOpenSource={openPrimarySourceTarget}
        onOpenNote={(id) => {
          setNoteTarget({ id, nonce: Date.now() });
          setView('notes');
        }}
        showDemoOffer={showDemoOffer}
        demoBusy={demoBusy}
        onLoadDemo={() => void ctx.loadPrimarySourcesDemo()}
      />
    );
  }
  if (ctx.isDatabases) {
    return (
      <DatabasesHome
        databases={databases}
        onOpenDatabase={(id) => {
          setActiveDatabaseId(id);
          setView('databases');
        }}
        onNewDatabase={() => void createDatabase()}
        onImportCsv={() => void importCsv()}
        onImportNotion={() => void importNotion()}
        onOpenAnalysis={() => setView('dbAnalysis')}
        onOpenChat={() => setView('dbChat')}
        demoBusy={demoBusy}
        onLoadDatabasesDemo={ctx.loadDatabasesDemo}
      />
    );
  }
  if (ctx.isEstudio) {
    return (
      <StudyHome
        onNavigate={setView}
        onOpenDocument={(id) => { ctx.setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }}
        // The study demo is offered on the strength of the flag alone: an empty
        // study vault is the normal state of one that is being set up.
        showDemoOffer={!settings.demoMode}
        demoBusy={demoBusy}
        onLoadDemo={ctx.loadStudyDemo}
      />
    );
  }
  if (ctx.isDocencia) {
    return (
      <TeachingHome
        onNavigate={setView}
        onOpenDocument={(id) => { ctx.setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }}
        showDemoOffer={showDemoOffer}
        demoBusy={demoBusy}
        onLoadDemo={ctx.loadTeachingDemo}
      />
    );
  }
  if (ctx.isWorldbuilding) {
    return (
      <WorldbuildingHome
        onNavigate={setView}
        showDemoOffer={showDemoOffer}
        demoBusy={demoBusy}
        onLoadDemo={ctx.loadWorldbuildingDemo}
      />
    );
  }
  if (ctx.isTestimonios) {
    return (
      <TestimonyHome
        onNavigate={setView}
        onOpenInterview={openTestimonyInterview}
        showDemoOffer={showDemoOffer}
        demoBusy={demoBusy}
        onLoadDemo={ctx.loadTestimonyDemo}
      />
    );
  }
  if (ctx.isProsopography) return <ProsopographyHome onNavigate={setView} />;
  // A preview vault renders no home at all: it is someone else's corpus, opened
  // read-only, and the academic home offers actions that would write to it.
  if (ctx.isPreviewVault) return null;
  return (
    <HomeView
      vaultId={activeVault?.id ?? null}
      settings={settings}
      lastSync={lastSync}
      syncing={syncing}
      onSync={onSync}
      onNavigate={(target) => navigate(target)}
      onOpenLibraryBucket={openLibraryBucket}
      onOpenAssistant={() => openAssistant()}
      showDemoOffer={showDemoOffer}
      demoBusy={demoBusy}
      onLoadDemo={ctx.loadDemo}
      onLoadGenealogyDemo={ctx.loadGenealogyDemo}
      onLoadDatabasesDemo={ctx.loadDatabasesDemo}
    />
  );
};
