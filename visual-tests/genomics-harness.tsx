// Renderer-only QA: production components, fake bridge, no real credentials or API.
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { NodusApi } from '../shared/types';
import { DEFAULT_CHAT_SKILLS, serializeChatVisualPart } from '../shared/chatSkills';
import * as genomics from '../shared/genomics';
import { ChatSkillsControl } from '../src/components/ChatSkillsControl';
import { ChatMarkdown } from '../src/components/ChatMarkdown';
import { LegalDocModal } from '../src/components/LegalDocModal';
import { LEGAL_DOCS } from '../src/legalDocs';
import { setActiveLang } from '../src/i18n';
import '../src/index.css';

setActiveLang('es');
let skills = structuredClone(DEFAULT_CHAT_SKILLS);
let status = { hasKey: false, termsAccepted: false, runtimeReady: false, installing: false };
const listeners = new Set<() => void>();
const notify = () => { listeners.forEach(f => f()); return structuredClone(skills); };
const plan: genomics.GenomicsPlan = { version: 1, assembly: 'GRCh38', variant: 'chr22:36201698:A:C', tissue: 'UBERON:0001157', output: 'RNA_SEQ' };
const fixture: genomics.GenomicsResult = { version: 1, provider: 'Google DeepMind AlphaGenome', plan, createdAt: '2026-09-09T10:00:00Z', sdkRevision: genomics.ALPHAGENOME_REVISION, model: 'ALL_FOLDS', interval: { chromosome: 'chr22', start: 36193505, end: 36209889 }, totalTracks: 1,
  tracks: [{ name: 'DATOS SINTÉTICOS DE QA — no es una predicción real', strand: '+', resolution: 1, reference: Array.from({ length: 256 }, (_, i) => 1 + Math.sin(i / 10)), alternate: Array.from({ length: 256 }, (_, i) => 1 + Math.sin(i / 10) + (i > 110 && i < 140 ? .8 : 0)) }], notice: genomics.ALPHAGENOME_NOTICE, citation: genomics.ALPHAGENOME_CITATION, modifications: 'Synthetic QA fixture, not an AlphaGenome output.' };
window.nodus = {
  listChatSkills: async () => structuredClone(skills),
  onChatSkillsChanged: cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
  saveChatSkill: async s => { skills = skills.map(x => x.id === s.id ? s : x); return notify(); },
  deleteChatSkill: async id => { skills = skills.filter(x => x.id !== id); return notify(); },
  restoreChatSkills: async () => { skills = structuredClone(DEFAULT_CHAT_SKILLS); return notify(); },
  getSettings: async () => ({ uiLanguage: 'es' }),
  getGenomicsStatus: async () => ({ ...status }),
  configureGenomics: async input => { if (!input.acceptTerms) throw Error('Test terms required'); status = { ...status, hasKey: true, termsAccepted: true }; return { ...status }; },
  clearGenomicsConfiguration: async () => { status = { ...status, hasKey: false, termsAccepted: false }; return { ...status }; },
  installGenomicsRuntime: async () => { status.runtimeReady = true; return { ...status }; },
  getGenomicsResult: async () => structuredClone(fixture),
  openExternal: async () => {},
} as NodusApi;
function Harness() {
  const [legal, setLegal] = useState(false);
  return <main style={{ maxWidth: 1060, margin: '30px auto', padding: 20 }}>
    <h1>AlphaGenome — prueba local con datos sintéticos</h1><p>Sin conexión a AlphaGenome. No introduzcas una clave real.</p>
    <div style={{ display: 'flex', gap: 20, margin: '24px 0' }}><ChatSkillsControl surface="assistant"/><ChatSkillsControl surface="nodi"/><button type="button" onClick={() => setLegal(true)}>Licencias</button></div>
    <ChatMarkdown content={serializeChatVisualPart({ kind: 'genomics-result', complete: true, content: 'nodus-genomics://chat/' + 'a'.repeat(64) + '/00000000-0000-4000-8000-000000000000' })}/>
    {legal && <LegalDocModal doc={LEGAL_DOCS.licenses} language="es" onClose={() => setLegal(false)}/>}
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness/>);
