// Renderer-only QA: production components, fake bridge, no real credentials or API.
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { NodusApi } from '../shared/types';
import { DEFAULT_CHAT_SKILLS, serializeChatVisualPart } from '../shared/chatSkills';
import { LEGALIZE_COUNTRIES, legalAttribution, type LegalResult } from '../shared/legalize';
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
const country = LEGALIZE_COUNTRIES.find(c => c.code === 'es')!;
const fixture: LegalResult = { version: 1, country: 'es', query: 'Ley sintética', revision: country.revision, fetchedAt: '2026-09-09T16:00:00Z', totalMatches: 1, attribution: '', matches: [{ id: 'QA-1', title: 'Ley sintética — solo prueba visual', path: 'es/QA-1.md' }], document: { id: 'QA-1', title: 'Ley sintética — solo prueba visual', path: 'es/QA-1.md', source: 'https://www.boe.es', metadata: 'title: "Ley sintética"\nlast_updated: "2026-09-09"', text: '##### Artículo 1. Prueba visual\n\nEste texto sintético solo comprueba la interfaz. No es una ley ni asesoramiento jurídico.\n\nTexto y metadatos se presentan con sus atribuciones y enlaces.', lastUpdated: '2026-09-09', status: 'synthetic_fixture', article: '1' } };
fixture.attribution = legalAttribution(fixture);
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
    <h1>Legalize — prueba local con datos sintéticos</h1><p>Componentes reales, puente simulado. Este texto no es una ley.</p>
    <div style={{ display: 'flex', gap: 20, margin: '24px 0' }}><ChatSkillsControl surface="assistant"/><ChatSkillsControl surface="nodi"/><button type="button" onClick={() => setLegal(true)}>Licencias</button></div>
    <ChatMarkdown content={serializeChatVisualPart({ kind: 'legal-result', complete: true, content: JSON.stringify(fixture) })}/>
    {legal && <LegalDocModal doc={LEGAL_DOCS.licenses} language="es" onClose={() => setLegal(false)}/>}
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness/>);
