import { createRoot } from 'react-dom/client';
import { NotebookDialog } from '../../../src/components/ResearchNotebookControl';
import { setActiveLang } from '../../../src/i18n';

const fixture = window as any;
fixture.saved = [];
const nodus = (id: string) => ({ kind: 'library-collection', id });
const zotero = (id: string) => ({ kind: 'zotero-collection', id, libraryType: 'user', libraryId: '7' });
const collections = [
  { reference: nodus('thesis'), name: 'Tesis', parentId: null, documentIds: ['d1'], origin: 'nodus' },
  { reference: nodus('ch2'), name: 'Capítulo 2', parentId: 'thesis', documentIds: ['d2', 'd3'], origin: 'nodus' },
  { reference: nodus('ch1'), name: 'Capítulo 1', parentId: 'thesis', documentIds: ['d1'], origin: 'nodus' },
  { reference: nodus('archive'), name: 'Archivo', parentId: null, documentIds: [], origin: 'nodus' },
  { reference: zotero('RIEGO111'), name: 'Riegos', parentId: null, documentIds: ['d4'], origin: 'zotero' },
  { reference: zotero('NORIA222'), name: 'Norias', parentId: 'RIEGO111', documentIds: ['d5'], origin: 'zotero' },
];
const preparation = (id: string, status: string) => ({ id, title: id, preparation: { documentId: id, revision: 'r', text: 'available', lexical: 'ready', embeddings: 'ready', status, reason: null, error: null, passages: 1, embedded: 1 } });
fixture.nodus = {
  getResearchCorpusSources: async () => ({ documents: [], collections }),
  getResearchPreparationInventory: async () => ({ enabled: true, documents: [preparation('d1', 'ready'), preparation('d2', 'ready'), preparation('d3', 'catalogued')] }),
  saveResearchNotebook: async (input: any) => { fixture.saved.push(input); return { ...input, id: input.id ?? 'new-notebook' }; },
};
window.nodus = fixture.nodus;
setActiveLang('es');
const existing = fixture.initial?.existing ? { id: 'nb', name: 'Viejo', mode: 'fixed', sources: [nodus('ch2'), { kind: 'library-item', id: 'x' }], exclusions: [], revision: 3, resolvedDocumentIds: [], createdAt: '', updatedAt: '', icon: 'flask', color: '#ef4444' } : null;
function App() {
  return <div className="research-chat-surface" style={{ '--vault-accent': '#6366f1' } as any}>
    <NotebookDialog notebook={existing as any} onClose={() => { fixture.closed = true; }} onSaved={async id => { fixture.savedId = id; }} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
