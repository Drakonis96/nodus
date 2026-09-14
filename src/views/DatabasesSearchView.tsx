import { VaultContentSearchView } from './VaultContentSearchView';
const OPTIONS = [
  { kind: 'database', label: 'Bases de datos', icon: 'table' },
  { kind: 'row', label: 'Filas', icon: 'notebook' },
];
export function DatabasesSearchView({ onOpenDatabase }: { onOpenDatabase: (databaseId: string, rowId?: string) => void }) {
  return <VaultContentSearchView options={OPTIONS} testId="databases-search-view" onOpen={(hit) => {
    if (hit.databaseId) onOpenDatabase(hit.databaseId, hit.kind === 'row' ? hit.id : undefined);
  }} />;
}
