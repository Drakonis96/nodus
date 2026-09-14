import { useState } from 'react';
import type { WorldEntry, WorldEntryKind } from '@shared/types';
import { parseEntryKey, WORLD_ENTRY_KINDS, WORLD_ENTRY_KIND_LABEL } from '@shared/worldEncyclopedia';
import { WorldEntryReader } from '../components/world/WorldEntryReader';
import { WORLD_ENTRY_KIND_ICON } from './EncyclopediaView';
import { VaultContentSearchView } from './VaultContentSearchView';
import type { View } from '../navigation';
const OPTIONS = WORLD_ENTRY_KINDS.map((kind) => ({ kind, label: WORLD_ENTRY_KIND_LABEL[kind], icon: WORLD_ENTRY_KIND_ICON[kind] }));
export function WorldSearchView({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [entry, setEntry] = useState<WorldEntry | null>(null);
  const open = async (kind: WorldEntryKind, id: string) => {
    const entries = await window.nodus.listWorldEntries();
    setEntry(entries.find((item) => item.kind === kind && item.id === id) ?? null);
  };
  return <>
    <div className={entry ? 'hidden' : 'h-full'}><VaultContentSearchView options={OPTIONS} testId="world-search-view" onOpen={(hit) => void open(hit.kind as WorldEntryKind, hit.id)} /></div>
    {entry && <WorldEntryReader entry={entry} onBack={() => setEntry(null)} onChanged={() => open(entry.kind, entry.id)} onSelect={(key) => { const ref = parseEntryKey(key); if (ref) void open(ref.kind, ref.id); }} onNavigate={onNavigate} />}
  </>;
}
