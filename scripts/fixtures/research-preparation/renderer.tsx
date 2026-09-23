import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ResearchPreparationWelcome, openResearchPreparation } from '../../../src/components/ResearchPreparationWelcome';
import { setActiveLang } from '../../../src/i18n';
const fixture = window as any;
fixture.actions = [];
let policy = { vaultId: 'academic', welcomeVersion: 0, decision: 'pending', futureAdditions: true, ...fixture.initial?.policy };
const documents = [
  { id: 'one', workId: 'w1', title: 'First source', preparation: { text: 'available', lexical: 'ready', embeddings: 'missing' } },
  { id: 'two', workId: 'w2', title: 'Second source', preparation: { text: 'abstract', lexical: 'missing', embeddings: 'missing' } },
];
fixture.nodus = {
  getResearchPreparationPolicy: async () => ({ ...policy }),
  setResearchPreparationPolicy: async (patch: object) => { fixture.actions.push(['policy', patch]); policy = { ...policy, ...patch }; return policy; },
  getResearchCorpusSources: async () => ({ documents, collections: [] }),
  previewResearchPreparation: async (input: any) => {
    fixture.actions.push(['preview', input]);
    return { id: 'frozen-preview', vaultId: 'academic', documents: input.scope === 'selection' ? documents.filter(doc => input.documentIds.includes(doc.id)) : documents,
      embedding: { provider: 'openrouter', model: 'baai/bge-m3', external: true }, embeddingAvailable: fixture.initial?.available !== false };
  },
  startResearchPreparationCampaign: async (input: any) => { fixture.actions.push(['start', input]); return 'campaign'; },
};
function App() {
  const [idle, setIdle] = useState(fixture.initial?.idle !== false);
  fixture.setIdle = setIdle;
  return <><button onClick={() => openResearchPreparation()} data-testid="open-preparation">Prepare</button>
    <button onClick={() => openResearchPreparation(undefined, true)} data-testid="manage-preparation">Manage</button>
    <button onClick={() => openResearchPreparation(['w2'])} data-testid="open-one">Prepare one</button>
    <button data-queue-trigger onClick={() => fixture.actions.push(['queue'])}>Queue</button>
    <ResearchPreparationWelcome vaultId="academic" allowAutomatic={idle} onConfigure={() => fixture.actions.push(['configure'])} />
  </>;
}
setActiveLang('es');
createRoot(document.getElementById('root')!).render(<App />);
