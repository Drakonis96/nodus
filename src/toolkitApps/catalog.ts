import { isToolkitAppManifest, type StoredToolkitApp, type ToolkitAppManifest } from '@shared/toolkitApps';
import { BRAINSTORM_COPY, INCLUDED_BRAINSTORM_MANIFEST } from './includedBrainstorm';
import { INCLUDED_ROULETTE_MANIFEST, ROULETTE_COPY } from './includedRoulette';
import { INCLUDED_TOPIC_DISTRIBUTOR_MANIFEST, TOPIC_DISTRIBUTOR_COPY } from './includedTopicDistributor';
import { INCLUDED_APP_LANGUAGES } from './includedAppI18n';

export { BRAINSTORM_COPY, INCLUDED_APP_LANGUAGES, ROULETTE_COPY, TOPIC_DISTRIBUTOR_COPY };

const STORAGE_KEY = 'nodus.toolkit.generated-miniapps.v2';
const now = '2026-07-22T00:00:00.000Z';

for (const manifest of [INCLUDED_ROULETTE_MANIFEST, INCLUDED_TOPIC_DISTRIBUTOR_MANIFEST, INCLUDED_BRAINSTORM_MANIFEST]) {
  if (!isToolkitAppManifest(manifest)) throw new Error('Invalid included Nodus App.');
}

export const INCLUDED_TOOLKIT_APPS: StoredToolkitApp[] = [
  {
    id: 'included-miniapp-wheel',
    status: 'ready',
    source: 'included',
    manifest: INCLUDED_ROULETTE_MANIFEST,
    sourceInstruction: '',
    promptHistory: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'included-miniapp-topic-distributor',
    status: 'ready',
    source: 'included',
    manifest: INCLUDED_TOPIC_DISTRIBUTOR_MANIFEST,
    sourceInstruction: '',
    promptHistory: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'included-miniapp-brainstorm',
    status: 'ready',
    source: 'included',
    manifest: INCLUDED_BRAINSTORM_MANIFEST,
    sourceInstruction: '',
    promptHistory: [],
    createdAt: now,
    updatedAt: now,
  },
];

function isStoredApp(value: unknown): value is StoredToolkitApp {
  if (!value || typeof value !== 'object') return false;
  const app = value as StoredToolkitApp;
  return typeof app.id === 'string'
    && (app.status === 'ready' || app.status === 'draft' || app.status === 'archived')
    && app.source === 'generated'
    && isToolkitAppManifest(app.manifest);
}

export function readGeneratedToolkitApps(): StoredToolkitApp[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(isStoredApp) : [];
  } catch { return []; }
}

export function writeGeneratedToolkitApps(apps: StoredToolkitApp[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
}

export function createStoredToolkitApp(
  manifest: ToolkitAppManifest,
  instruction: string,
  options: { promptHistory?: string[]; originAppId?: string } = {},
): StoredToolkitApp {
  const timestamp = new Date().toISOString();
  return {
    id: `miniapp-${crypto.randomUUID()}`,
    status: 'ready',
    source: 'generated',
    manifest,
    sourceInstruction: instruction.slice(0, 8_000),
    promptHistory: options.promptHistory?.map((item) => item.slice(0, 8_000)).slice(-30) ?? (instruction ? [instruction.slice(0, 8_000)] : []),
    originAppId: options.originAppId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
