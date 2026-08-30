import ReactDOM from 'react-dom/client';
import type { AppSettings } from '@shared/types';
import { GlobalLibraryView } from '../src/views/GlobalLibraryView';
import '../src/index.css';

/**
 * The Library shell (scope switcher, header actions, the guide's «?») rendered with a
 * stubbed bridge, so the header can be looked at without booting Electron or a vault.
 * `?vault=<type>` picks the vault type, which is what colours the «?» button.
 * `?guide=0` suppresses the first-run guide so the header itself is visible.
 */
const params = new URLSearchParams(location.search);
const vaultType = (params.get('vault') ?? 'academic') as AppSettings extends never ? never : never;
if (params.get('guide') === '0') localStorage.setItem('nodus.libraryTutorialSeen.v1', '1');
else localStorage.removeItem('nodus.libraryTutorialSeen.v1');

const noop = () => () => undefined;
window.nodus = {
  ...(window.nodus ?? {}),
  getSettings: async () => ({ mascotStyle: 'classic', mascotOrbColorMode: 'auto', reduceMotion: false }),
  onSettingsChanged: noop,
  getActiveVault: async () => ({ type: vaultType }),
  onVaultChanged: noop,
  listWorksPage: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
  listZoteroTags: async () => [],
  listCollectionFacets: async () => [],
  getQueue: async () => ({ paused: false, pausedReason: null, total: 0, done: 0, failed: 0, current: null, items: [] }),
  getWorkEmbeddingStatuses: async () => [],
  getWorkPassageStatuses: async () => [],
  getDocumentProfileStatuses: async () => [],
  onQueueProgress: noop,
  onPassageProgress: noop,
  onDocumentIndexProgress: noop,
} as unknown as typeof window.nodus;

const settings = { libraryGlobalEnabled: false, libraryScope: 'vault', libraryScopeOnboardingVersion: 0, autoBackupFolder: '' } as unknown as AppSettings;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <div className="h-screen w-screen overflow-hidden bg-neutral-950">
    <GlobalLibraryView
      settings={settings}
      vaultId="vault-1"
      vaultType={vaultType}
      onSettingsChange={async () => settings}
      onOpenSettings={() => undefined}
      onOpenCollections={() => undefined}
      onOpenGraph={() => undefined}
      onOpenAssistant={() => undefined}
    />
  </div>
);
