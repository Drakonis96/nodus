import { useState } from 'react';
import type { VaultContentHit } from '@shared/hybridSearch';
import { t } from '../i18n';
import { ProsopPersonsView } from './ProsopPersonsView';
import { ProsopSourcesView } from './ProsopSourcesView';
import { VaultContentSearchView } from './VaultContentSearchView';
const OPTIONS = [
  { kind: 'person', label: 'Personas', icon: 'users' },
  { kind: 'mention', label: 'Menciones', icon: 'quote' },
  { kind: 'source', label: 'Fuentes', icon: 'archive' },
  { kind: 'statement', label: 'Observaciones', icon: 'notebook' },
];
export function ProsopSearchView() {
  const [target, setTarget] = useState<VaultContentHit | null>(null);
  return <><div className={target ? 'hidden' : 'h-full'}><VaultContentSearchView options={OPTIONS} testId="prosop-search-view" onOpen={setTarget} /></div>{target && <div className="flex h-full min-h-0 flex-col">
    <button className="btn btn-ghost shrink-0 self-start" onClick={() => setTarget(null)}>← {t('Buscar')}</button>
    <div className="min-h-0 flex-1">{target.kind === 'person' || (target.kind === 'mention' && target.personId)
      ? <ProsopPersonsView initialPersonId={target.personId ?? target.id} />
      : <ProsopSourcesView initialSourceId={target.sourceId ?? target.id} initialTab={target.kind === 'statement' ? 'observations' : 'catalogue'} />}</div>
  </div>}</>;
}
