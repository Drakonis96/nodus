import type { StudyOutlineItem } from '@shared/studyEditor';
import { extractStudyOutline } from '@shared/studyEditor';
import { Icon } from '../ui';
import { t } from '../../i18n';

export function DocOutline({ markdown, onJump }: { markdown: string; onJump: (item: StudyOutlineItem, index: number) => void }) {
  const outline = extractStudyOutline(markdown);
  return (
    <aside className="w-52 shrink-0 overflow-y-auto border-r border-neutral-800 bg-neutral-950/35 p-3">
      <div className="mb-2 flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
        <Icon name="list" size={12} /> {t('Índice del documento')}
      </div>
      {outline.length === 0 ? (
        <p className="px-1 py-3 text-xs leading-5 text-neutral-600">{t('Añade títulos para crear un índice navegable.')}</p>
      ) : outline.map((item, index) => (
        <button key={`${item.id}-${item.line}`} onClick={() => onJump(item, index)}
          style={{ paddingLeft: `${6 + (item.level - 1) * 10}px` }}
          className="block w-full truncate rounded py-1.5 pr-1 text-left text-xs text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
          title={`${item.text} · ${t('línea')} ${item.line}`}>
          {item.text}
        </button>
      ))}
    </aside>
  );
}
