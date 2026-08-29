import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { LibraryTutorialModal, type LibraryTutorialTab } from '../src/components/LibraryTutorialModal';
// Not src/index.css: that one needs Tailwind, so the shot script compiles it and
// injects it. Everything imported from a component (nodi.css, nodiOrb.css…) is
// plain CSS and rides along in the bundle's own stylesheet — leaving it out is
// what once made the orb render as a black disc in these captures.

// Nodi reads the appearance settings over IPC; outside Electron there is no bridge,
// so the harness answers with the defaults it needs and subscribes to nothing.
window.nodus = {
  ...(window.nodus ?? {}),
  // 'classic' is the shipped default (electron/db/settingsRepo.ts), so it is what most
  // people see beside the guide; ?nodi=orb captures the other choice, whose colour
  // follows the active vault.
  getSettings: async () => ({
    mascotStyle: new URLSearchParams(location.search).get('nodi') === 'orb' ? 'orb' : 'classic',
    mascotOrbColorMode: 'auto',
    reduceMotion: false,
  }),
  onSettingsChanged: () => () => undefined,
  getActiveVault: async () => ({ type: 'academic' }),
  onVaultChanged: () => () => undefined,
} as unknown as typeof window.nodus;

/**
 * The Library guide, rendered on its own so both tabs can be looked at (and
 * screenshotted) without booting Electron or seeding a vault.
 * Read the tab from the query string: ?tab=manager.
 */
function Harness() {
  const requested = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState<LibraryTutorialTab>(requested === 'manager' ? 'manager' : 'analysis');
  return (
    <div className="h-screen w-screen bg-neutral-950">
      <LibraryTutorialModal open tab={tab} onTabChange={setTab} onClose={() => undefined} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
