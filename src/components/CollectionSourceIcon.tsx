import nodusMark from '../assets/nodus-logo-violet.svg';
import zoteroMark from '../assets/nodus-logo-zotero.svg';
import { Icon } from './ui';
import { t } from '../i18n';
import './collectionSourceIcon.css';

/** A collection's folder, carrying the mark of where it lives: Nodus's N, or Zotero's red Z. */
export function CollectionSourceIcon({ origin, size = 18, color }: { origin: 'nodus' | 'zotero'; size?: number; color?: string | null }) {
  return <span className={`collection-source-icon is-${origin}`} role="img" data-origin={origin}
    aria-label={t(origin === 'nodus' ? 'Colección de Nodus' : 'Colección de Zotero')} title={t(origin === 'nodus' ? 'Colección de Nodus' : 'Colección de Zotero')}
    style={{ width: size, height: size, color: color ?? undefined }}>
    <Icon name="folder" size={size} />
    <img src={origin === 'nodus' ? nodusMark : zoteroMark} alt="" className="collection-source-icon-mark" />
  </span>;
}
