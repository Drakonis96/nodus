import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { NodusApi } from '../../../shared/types';
import type { ChatSkill } from '../../../shared/chatSkills';
import { SkillMarketplaceModal } from '../../../src/components/SkillMarketplaceModal';
import { ChatMarkdown } from '../../../src/components/ChatMarkdown';
import { setActiveLang } from '../../../src/i18n';

setActiveLang('en');

const enabled = { assistant: true, nodi: false };
const skills: ChatSkill[] = [
  { id: 'alpha-installed', name: 'Alpha Method', description: 'Start a research question with explicit assumptions and falsifiable criteria.', instructions: 'Use the method.', enabled, author: 'Ada', category: 'Research', version: '1.0.0', license: 'MIT', origin: { sourceId: 'nodusresearch/nodus-research-skill-marketplace', path: 'alpha-method', commit: 'a'.repeat(40), packageId: 'alpha-method', version: '1.0.0', digest: '1'.repeat(64) } },
  { id: 'evidence-grid', name: 'Evidence Grid', description: 'Compare claims, sources and confidence in a compact evidence matrix.', instructions: 'Build the grid.', enabled, author: 'NodusResearch', category: 'Analysis', version: '1.0.0', license: 'AGPL-3.0-only' },
  { id: 'source-critic', name: 'Source Critic', description: 'Evaluate provenance, incentives and limitations before using a source.', instructions: 'Critique the source.', enabled, author: 'NodusResearch', category: 'Research', version: '1.0.0', license: 'AGPL-3.0-only' },
  { id: 'zeta-installed', name: 'Zeta Review', description: 'Close a project with a concise audit of remaining uncertainty.', instructions: 'Review the project.', enabled, author: 'Zoe', category: 'Writing', version: '1.0.0', license: 'MIT', origin: { sourceId: 'nodusresearch/nodus-research-skill-marketplace', path: 'zeta-review', commit: 'a'.repeat(40), packageId: 'zeta-review', version: '1.0.0', digest: '2'.repeat(64) } },
];

const skillPackage = (id: string, name: string, description: string, category: string) => ({
  manifest: { schemaVersion: 1 as const, id, name, version: '1.0.0', author: 'community', description, category, license: 'MIT', instructions: 'SKILL.md' as const, capabilities: [], tools: [] },
  files: { 'SKILL.md': `Use ${name}.` },
});

const anatomyPlugin = {
  path: 'anatomy-atlas',
  package: {
    manifest: { schemaVersion: 1 as const, id: 'anatomy-atlas', name: 'Anatomy Atlas', version: '1.2.0', author: 'medlab', description: 'Explore labelled anatomy with a focused visual workflow.', license: 'MIT', compatibility: { capabilityApi: 1 as const, minNodusVersion: '5.4.0' }, skills: ['skills/anatomy/skill.json'], capabilities: ['capabilities/anatomy/capability.json'] },
    files: {
      'plugin.json': '{}',
      'skills/anatomy/skill.json': '{}',
      'skills/anatomy/SKILL.md': 'Use anatomy.',
      'capabilities/anatomy/capability.json': JSON.stringify({ permissions: { network: [{ id: 'atlas', origin: 'https://anatomy.example.org', paths: ['/v1/*'], methods: ['GET'] }], storage: { maxBytes: 4096 } } }),
      'capabilities/anatomy/index.js': '() => ({ kind: "text", text: "ok" })',
    },
  },
};

const capabilityCatalog = {
  sourceId: 'nodusresearch/nodus-research-skill-marketplace',
  url: 'https://github.com/NodusResearch/nodus-research-skill-marketplace',
  commit: 'a'.repeat(40),
  fetchedAt: '2026-09-13T10:00:00.000Z',
  catalog: {
    schemaVersion: 2 as const,
    updatedAt: '2026-09-13T10:00:00.000Z',
    plugins: [{ id: 'chemistry-studio', name: 'Chemistry Studio', description: { en: 'Draw, inspect and verify chemical structures.' }, version: '2.1.0', path: 'plugins/chemistry-studio', replaces: [], targets: ['any'], release: { tag: 'chemistry-studio-v2.1.0', manifest: 'release.json', signature: 'release.sig', assets: [{ target: 'any', asset: 'chemistry-studio.nodus-plugin', bytes: 2_400_000 }] } }],
  },
};

const qa = { marketplaceApprovals: 0, capabilityStages: 0, capabilityApprovals: 0 };
(window as typeof window & { __marketplaceQa?: typeof qa }).__marketplaceQa = qa;

window.nodus = {
  getSettings: async () => ({ imageProvider: 'openai', imageModel: 'gpt-image-1' }),
  getActiveVault: async () => ({ id: 'qa', name: 'QA', type: 'academic' }),
  onVaultChanged: () => () => {},
  listChatSkills: async () => skills,
  onChatSkillsChanged: () => () => {},
  saveChatSkill: async () => skills,
  deleteChatSkill: async () => skills,
  getSkillMarketplace: async () => ({ version: 1 as const, sources: [{ id: capabilityCatalog.sourceId, url: capabilityCatalog.url, commit: capabilityCatalog.commit, updatedAt: capabilityCatalog.fetchedAt, entries: [
    { path: 'alpha-method', package: skillPackage('alpha-method', 'Alpha Method', 'Start a research question with explicit assumptions and falsifiable criteria.', 'Research') },
    { path: 'zeta-review', package: skillPackage('zeta-review', 'Zeta Review', 'Close a project with a concise audit of remaining uncertainty.', 'Writing') },
  ], plugins: [anatomyPlugin], errors: [] }] }),
  listInstalledPlugins: async () => [],
  listInboxPlugins: async () => [{ directory: 'beta-toolkit', id: 'beta-toolkit', name: 'Beta Toolkit', description: 'Turn observations into a compact working dataset.', version: '1.0.0', author: 'labtools', skills: 1, capabilities: 1, installed: false, permissions: {} }],
  getAppInfo: async () => ({ version: '5.4.1' }),
  listCapabilities: async () => ({ revision: 1, providers: [], problems: [], plugins: [], catalog: capabilityCatalog }),
  onCapabilityRegistryChanged: () => () => {},
  capabilityMigrationStatus: async () => ({ running: false, settled: true, journal: null, entries: [], problems: [] }),
  onCapabilityMigrationChanged: () => () => {},
  installMarketplacePlugin: async (_source: string, _path: string, _commit: string, approved: boolean) => { if (approved) qa.marketplaceApprovals++; return []; },
  installCapabilityPlugin: async () => {
    qa.capabilityStages++;
    return { activated: false, pendingPermissions: { network: [{ id: 'pubchem', origin: 'https://pubchem.ncbi.nlm.nih.gov', paths: ['/rest/*'], methods: ['GET'] }], storage: { stateBytes: 4096, cacheBytes: 8192, tempBytes: 0 } }, state: { id: 'chemistry-studio', active: undefined, pending: { version: '2.1.0', digest: 'b'.repeat(64), target: 'any', installedAt: new Date().toISOString(), reason: 'permissions' }, status: 'pending-permissions', autoUpdate: true, rollbackAvailable: false, dataVersion: 1 } };
  },
  approveCapabilityPlugin: async () => { qa.capabilityApprovals++; return null; },
  discardPendingCapabilityPlugin: async () => null,
  openExternal: async () => {},
} as unknown as NodusApi;

const chemistry = '```nodus-capability\n{"skillId":"chemistry-workbench","capabilityId":"chemistry-studio:chemistry","toolId":"draw"';
const anatomy = '```nodus-capability\n{"skillId":"anatomy-atlas","capabilityId":"anatomy-atlas:anatomy","toolId":"inspect"';

function Harness() {
  const [open, setOpen] = useState(true);
  return <main style={{ minHeight: '100vh', padding: 32, background: '#0b0b0f' }}>
    {open && <SkillMarketplaceModal onClose={() => setOpen(false)} />}
    <section data-testid="capability-demo" style={{ width: 680, margin: '80px auto', display: 'grid', gap: 18 }}>
      <h2 style={{ fontSize: 20 }}>Named capability activity</h2>
      <ChatMarkdown content={chemistry} streaming />
      <ChatMarkdown content={anatomy} streaming />
    </section>
  </main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
