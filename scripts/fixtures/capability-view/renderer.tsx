// Renderer-only QA for capability API v2: production components, fake bridge, synthetic
// data. Nothing here talks to a package, a signature or the network.
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { NodusApi } from '../../../shared/types';
import type { ViewDocumentV1 } from '../../../shared/capabilities';
import { serializeChatVisualPart } from '../../../shared/chatSkills';
import { ChatMarkdown } from '../../../src/components/ChatMarkdown';
import { CapabilityPackagesPanel } from '../../../src/components/CapabilityPackagesPanel';
import { setActiveLang } from '../../../src/i18n';

setActiveLang('es');

const view: ViewDocumentV1 = {
  schemaVersion: 1,
  title: 'Etanol',
  summary: 'Identidad y estructura del etanol.',
  nodes: [
    { kind: 'badges', items: [{ label: 'verificado', tone: 'success' }, { label: 'PubChem CID 702', tone: 'info' }] },
    { kind: 'paragraph', spans: [{ text: 'Resuelto desde ' }, { text: 'OPSIN', href: 'https://opsin.ch.cam.ac.uk/' }, { text: ' y confirmado contra PubChem.' }] },
    { kind: 'svg', title: 'Etanol', alt: 'Fórmula esquelética del etanol.', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 90"><g fill="none" stroke="#a5b4fc" stroke-width="2"><path d="M30 60 L75 35 L120 60 L165 35"/></g><g fill="#e4e4e7" font-family="serif" font-size="15"><text x="170" y="32">OH</text><text x="18" y="72">H₃C</text></g></svg>' },
    { kind: 'table', caption: 'Propiedades', columns: [{ label: 'Propiedad' }, { label: 'Valor', align: 'end' }], rows: [['Fórmula', 'C₂H₆O'], ['Masa molar', 46.07], ['InChIKey', 'LFQSCWFLJHTTHZ-UHFFFAOYSA-N']] },
    { kind: 'notice', tone: 'warning', title: 'Estereoquímica', spans: [{ text: 'La petición no fijaba configuración, así que no se ha dibujado ninguna.' }] },
    { kind: 'details', summary: 'Fuentes consultadas', children: [{ kind: 'links', items: [{ href: 'https://pubchem.ncbi.nlm.nih.gov/compound/702', label: 'PubChem 702', description: 'Registro canónico' }] }] },
    { kind: 'download', attachmentId: '3f8a1c0e-9b2d-4e77-8a10-5c6d7e8f9a0b', label: 'Descargar ChemFig', name: 'etanol.tex', mimeType: 'text/x-tex', bytes: 412 },
    { kind: 'status', state: 'ok', label: 'Identidad verificada', description: 'Dos fuentes independientes coinciden.' },
    { kind: 'code', language: 'latex', text: '\\chemfig{H_3C-CH_2-OH}' },
  ],
};

const catalog = {
  sourceId: 'nodusresearch/nodus-research-skill-marketplace',
  url: 'https://github.com/NodusResearch/nodus-research-skill-marketplace',
  commit: 'a'.repeat(40),
  fetchedAt: '2026-09-11T10:00:00.000Z',
  catalog: {
    schemaVersion: 2 as const,
    updatedAt: '2026-09-11T10:00:00.000Z',
    plugins: [
      { id: 'chemistry-studio', name: 'Chemistry Studio', description: { en: 'Draw and verify chemical structures.', es: 'Dibuja y verifica estructuras químicas.' }, version: '2.0.0', path: 'plugins/chemistry-studio', replaces: ['builtin-chemistry'], targets: ['darwin-arm64', 'win32-x64'], release: { tag: 'chemistry-studio-v2.0.0', manifest: 'release-manifest.json', signature: 'release-manifest.sig', assets: [{ target: 'darwin-arm64', asset: 'chemistry-studio-2.0.0-darwin-arm64.nodus-plugin', bytes: 48_234_112 }, { target: 'win32-x64', asset: 'chemistry-studio-2.0.0-win32-x64.nodus-plugin', bytes: 49_112_000 }] } },
      { id: 'alphagenome', name: 'Alpha Genome', description: { en: 'Genomic predictions with a pinned Python runtime.', es: 'Predicciones genómicas con un runtime de Python fijado.' }, version: '2.0.0', path: 'plugins/alphagenome', replaces: ['builtin-genomics'], targets: ['darwin-arm64'], release: { tag: 'alphagenome-v2.0.0', manifest: 'release-manifest.json', signature: 'release-manifest.sig', assets: [{ target: 'darwin-arm64', asset: 'alphagenome-2.0.0-darwin-arm64.nodus-plugin', bytes: 3_145_728 }] } },
    ],
  },
};

const providers = [
  { id: 'nodus:chemistry', version: '2.0.0', description: 'Identidad, dibujo y exportación química verificados.', source: 'plugin' as const, plugin: { id: 'chemistry-studio', version: '2.0.0', digest: 'a'.repeat(64) }, tools: [{ id: 'compile', description: 'Compila un plan.', metered: true }], artifacts: [], hasSettings: false },
  { id: 'nodus:genomics', version: '2.0.0', description: 'Predicción genómica.', source: 'plugin' as const, plugin: { id: 'alphagenome', version: '2.0.0', digest: 'b'.repeat(64) }, tools: [{ id: 'predict', description: 'Una predicción.', metered: true }], artifacts: [], hasSettings: true },
];

const settings = {
  manifest: {
    fields: [
      { kind: 'secret' as const, id: 'api-key', label: { en: 'API key', es: 'Clave de API' }, description: { en: 'Stored in the system credential store.', es: 'Se guarda en el almacén de credenciales del sistema.' }, required: true },
      { kind: 'consent' as const, id: 'terms', label: { en: 'I accept the AlphaGenome terms', es: 'Acepto los términos de AlphaGenome' }, version: 2, termsUrl: 'https://deepmind.google/' },
      { kind: 'toggle' as const, id: 'diagnostics', label: { en: 'Keep a local diagnostic log', es: 'Guardar un registro de diagnóstico local' } },
    ],
    actions: [{ id: 'install-runtime', label: { en: 'Install runtime', es: 'Instalar runtime' } }],
  },
  state: {
    fields: { 'api-key': { configured: true }, terms: { value: true }, diagnostics: { value: false } },
    status: { state: 'pending' as const, label: { en: 'Runtime not installed', es: 'Runtime sin instalar' } },
    disabledActions: {},
  },
};

window.nodus = {
  listCapabilities: async () => ({ revision: 3, providers, problems: [], plugins: [{ id: 'chemistry-studio', source: { id: catalog.sourceId, path: 'plugins/chemistry-studio', commit: catalog.commit }, trust: { publisher: 'NodusResearch', keyId: 'nr01', verified: true as const }, active: { version: '2.0.0', digest: 'a'.repeat(64), target: 'darwin-arm64', installedAt: '2026-09-11T10:00:00.000Z' }, status: 'ready' as const, autoUpdate: true, rollbackAvailable: false, dataVersion: 1 }], catalog }),
  onCapabilityRegistryChanged: () => () => {},
  getCapabilitySettings: async () => settings,
  applyCapabilitySettings: async () => settings.state,
  runCapabilityAction: async () => settings.state,
  refreshCapabilityCatalog: async () => catalog,
  installCapabilityPlugin: async () => ({ state: null as never, activated: true }),
  removeCapabilityPlugin: async () => [],
  rollbackCapabilityPlugin: async () => null as never,
  approveCapabilityPlugin: async () => null as never,
  renderCapabilityArtifact: async () => ({ available: true as const, sidecar: { source: 'nodus-artifact://chat/' + 'a'.repeat(64) + '/3f8a1c0e-9b2d-4e77-8a10-5c6d7e8f9a0b', capabilityId: 'nodus:chemistry', plugin: { id: 'chemistry-studio', version: '2.0.0', digest: 'a'.repeat(64) }, artifactType: 'chemistry-document', artifactVersion: 1, summary: 'Etanol, CID 702.', modelVisibility: 'projection' as const, sha256: 'c'.repeat(64), bytes: 1024, createdAt: '2026-09-11T10:00:00.000Z' }, view }),
  downloadCapabilityFile: async () => {},
  getChatImageMetadata: async () => null,
  copyChatImage: async () => {},
} as unknown as NodusApi;

const artifactReference = serializeChatVisualPart({
  kind: 'capability-artifact', complete: true,
  content: JSON.stringify({ source: 'nodus-artifact://chat/' + 'a'.repeat(64) + '/3f8a1c0e-9b2d-4e77-8a10-5c6d7e8f9a0b', capabilityId: 'nodus:chemistry', plugin: { id: 'chemistry-studio', version: '2.0.0' }, artifactType: 'chemistry-document', artifactVersion: 1, summary: 'Etanol, CID 702.', modelVisibility: 'projection' }),
});
const inlineView = serializeChatVisualPart({
  kind: 'capability-view', complete: true,
  content: JSON.stringify({ capabilityId: 'nodus:chemistry', plugin: { id: 'chemistry-studio', version: '2.0.0' }, owner: 'a'.repeat(64), view: { ...view, title: undefined, nodes: view.nodes.slice(4, 8) } }),
});

function Harness() {
  return <div style={{ padding: 24 }}>
    <div data-testid="artifact"><ChatMarkdown content={artifactReference} /></div>
    <div data-testid="inline"><ChatMarkdown content={inlineView} /></div>
    <div data-testid="panel"><CapabilityPackagesPanel /></div>
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
