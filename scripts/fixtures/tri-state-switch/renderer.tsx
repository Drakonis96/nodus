import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TriStateSwitch, type TriState } from '../../../src/components/TriStateSwitch';
import { setActiveLang } from '../../../src/i18n';
const fixture = window as any;
fixture.changes = [];
function App() {
  const [value, setValue] = useState<TriState>('off');
  return <div style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
    <span style={{ fontSize: 14 }}>Ideas</span>
    <TriStateSwitch value={value} label="Ideas" posLabel="Ideas extraídas" negLabel="Sin ideas extraídas" testId="switch"
      onChange={(next) => { fixture.changes.push(next); setValue(next); }} />
  </div>;
}
setActiveLang('es');
createRoot(document.getElementById('root')!).render(<App />);
