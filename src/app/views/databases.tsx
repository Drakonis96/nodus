// The databases vault: the grid itself, cross-database search, statistics and chat.
import { lazy } from 'react';
import type { ViewRenderer } from '../ViewContext';

const DatabasesView = lazy(() => import('../../views/DatabasesView').then((module) => ({ default: module.DatabasesView })));
const DatabasesSearchView = lazy(() => import('../../views/DatabasesSearchView').then((module) => ({ default: module.DatabasesSearchView })));
const DatabasesAnalysisView = lazy(() => import('../../views/DatabasesAnalysisView').then((module) => ({ default: module.DatabasesAnalysisView })));
const DatabasesChatView = lazy(() => import('../../views/DatabasesChatView').then((module) => ({ default: module.DatabasesChatView })));
const PageWikiView = lazy(() => import('../../views/PageWikiView').then((module) => ({ default: module.PageWikiView })));

export const databasesViews = {
  pages: () => <PageWikiView />,
  databases: ({ activeDatabaseId, createDatabase, pendingRecordId, reloadDatabases, setPendingRecordId }) => (
    <DatabasesView
      databaseId={activeDatabaseId}
      onDatabasesChanged={reloadDatabases}
      onCreateDatabase={() => void createDatabase()}
      initialRowId={pendingRecordId}
      onConsumeInitialRow={() => setPendingRecordId(null)}
    />
  ),
  dbSearch: ({ setActiveDatabaseId, setPendingRecordId, setView }) => (
    <DatabasesSearchView
      onOpenDatabase={(id, rowId) => {
        setActiveDatabaseId(id);
        setPendingRecordId(rowId ?? null);
        setView('databases');
      }}
    />
  ),
  dbAnalysis: ({ activeDatabaseId }) => <DatabasesAnalysisView initialDatabaseId={activeDatabaseId} />,
  dbChat: ({ activeDatabaseId }) => <DatabasesChatView initialDatabaseId={activeDatabaseId} />,
} satisfies Record<string, ViewRenderer>;
