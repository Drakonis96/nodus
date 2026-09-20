import { useEffect, useState } from 'react';
import nodusLogo from '../assets/nodus-logo.svg';
import zoteroLogo from '../assets/nodus-logo-zotero.svg';

/** Logos describe recorded provenance, not whether a work has been analysed. */
export function WorkSourceBadge({ workId, zoteroKey, source, itemId }: { workId?: string; zoteroKey?: string; source?: string; itemId?: string }) {
  const [origins, setOrigins] = useState<string[]>(source ? [source === 'zotero' ? 'zotero' : 'nodus'] : zoteroKey ? [zoteroKey.startsWith('nodus-library:') ? 'nodus' : 'zotero'] : []);
  useEffect(() => {
    if (!workId && !itemId) return;
    let live = true;
    void (async () => {
      const linkedItemId = itemId ?? (await window.nodus.listGlobalLibraryVaultLinks()).find(entry => entry.workId === workId)?.itemId;
      if (linkedItemId) {
        const item = await window.nodus.getGlobalLibraryItem(linkedItemId);
        if (live && item) setOrigins([...new Set([item.source === 'zotero' ? 'zotero' : 'nodus', ...item.sourceIdentities.filter(identity => identity.source === 'zotero').map(() => 'zotero')])]);
      } else if (!source && !zoteroKey) {
        const work = (await window.nodus.listWorks()).find(entry => entry.nodus_id === workId);
        if (live && work) setOrigins([work.zotero_key.startsWith('nodus-library:') ? 'nodus' : 'zotero']);
      }
    })().catch(() => undefined);
    return () => { live = false; };
  }, [workId, itemId, source, zoteroKey]);
  return <span className="inline-flex shrink-0 items-center gap-1 align-middle" data-testid="work-source-badge">{origins.map(origin => <img key={origin} src={origin === 'zotero' ? zoteroLogo : nodusLogo} alt={origin === 'zotero' ? 'Zotero' : 'Nodus'} title={origin === 'zotero' ? 'Zotero' : 'Nodus'} className="h-3.5 w-3.5" />)}</span>;
}
