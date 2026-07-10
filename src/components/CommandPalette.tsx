import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Icon } from './ui';
import { t } from '../i18n';

export interface Command {
  id: string;
  /** Already-translated label shown in the list. */
  label: string;
  /** Already-translated section heading used to group commands. */
  section: string;
  icon: string;
  /** Extra already-translated search terms (synonyms) that never render. */
  keywords?: string;
  run: () => void;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Global command palette (⌘K / Ctrl+K). Fuzzy-free substring search over every
 * navigation destination and a few global actions, so the whole app is reachable
 * from the keyboard without hunting through the 3-group sidebar. Arrow keys move
 * the selection, Enter runs it, Escape (or a backdrop click) closes.
 */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return commands;
    const terms = q.split(/\s+/);
    return commands.filter((c) => {
      const hay = normalize(`${c.label} ${c.section} ${c.keywords ?? ''}`);
      return terms.every((term) => hay.includes(term));
    });
  }, [commands, query]);

  // Keep the active index in range as the filtered list shrinks/grows.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll the active row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const runAt = (index: number) => {
    const cmd = filtered[index];
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Render with a running index so keyboard selection maps across section headers.
  let flatIndex = -1;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.14 }}
        className="card w-full max-w-lg overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('Paleta de comandos')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2.5">
          <Icon name="search" className="shrink-0 text-neutral-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('Ir a una sección o ejecutar una acción…')}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-500"
          />
          <kbd className="composer-kbd shrink-0">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">{t('Sin resultados.')}</div>
          )}
          {filtered.map((cmd, i) => {
            flatIndex += 1;
            const index = flatIndex;
            const showHeading = i === 0 || filtered[i - 1].section !== cmd.section;
            const isActive = index === active;
            return (
              <div key={cmd.id}>
                {showHeading && (
                  <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
                    {cmd.section}
                  </div>
                )}
                <button
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => runAt(index)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                    isActive ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-neutral-900'
                  }`}
                >
                  <Icon name={cmd.icon} size={15} className={isActive ? '' : 'text-neutral-500'} />
                  <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
