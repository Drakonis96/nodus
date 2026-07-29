import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, ICON_NAMES, ModalBackdrop } from './ui';
import { t } from '../i18n';

const normalize = (value: string) =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().trim();

export function DocumentIconPicker({
  value,
  suggested,
  onChange,
}: {
  value: string;
  suggested: string;
  onChange: (icon: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const normalized = normalize(query);
  const icons = useMemo(
    () => ICON_NAMES.filter((name) => !normalized || normalize(name).includes(normalized)),
    [normalized],
  );

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="input flex h-10 min-w-0 flex-1 items-center gap-3 text-left"
          data-testid="primary-source-document-icon-picker"
          aria-label={t('Seleccionar icono')}
          onClick={() => {
            setQuery('');
            setOpen(true);
          }}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
            <Icon name={value} size={16} />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs">{value}</span>
          <Icon name="chevronDown" size={13} className="shrink-0 text-neutral-400" />
        </button>
        {value !== suggested && (
          <button
            type="button"
            className="btn btn-ghost h-10 w-10 shrink-0 p-0"
            title={t('Usar icono sugerido')}
            aria-label={t('Usar icono sugerido')}
            onClick={() => onChange(suggested)}
          >
            <Icon name="wand" size={14} />
          </button>
        )}
      </div>

      {open && createPortal(
        <ModalBackdrop onClose={() => setOpen(false)} zIndex={190}>
          <section
            className="card-modal flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label={t('Seleccionar icono')}
          >
            <header className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
                <Icon name={value} size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{t('Seleccionar icono')}</h2>
                <p className="mt-0.5 text-xs text-neutral-500">{t('Elige cómo se representará el documento en el archivo.')}</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost h-9 w-9 p-0"
                aria-label={t('Cerrar')}
                onClick={() => setOpen(false)}
              >
                <Icon name="x" size={15} />
              </button>
            </header>
            <div className="p-4">
              <label className="relative block">
                <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  autoFocus
                  className="input input-with-leading-icon w-full"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('Buscar iconos…')}
                />
              </label>
              <div className="mt-4 grid max-h-[48vh] grid-cols-6 gap-2 overflow-y-auto pr-1 sm:grid-cols-8 md:grid-cols-10">
                {icons.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`grid aspect-square place-items-center rounded-lg border transition ${
                      value === name
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300'
                        : 'border-neutral-200 text-neutral-500 hover:border-indigo-300 hover:bg-indigo-50 dark:border-neutral-800 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/30'
                    }`}
                    title={name}
                    aria-label={name}
                    onClick={() => {
                      onChange(name);
                      setOpen(false);
                    }}
                  >
                    <Icon name={name} size={18} />
                  </button>
                ))}
              </div>
              {icons.length === 0 && <p className="py-8 text-center text-xs text-neutral-500">{t('No se encontraron iconos.')}</p>}
            </div>
          </section>
        </ModalBackdrop>,
        document.body,
      )}
    </>
  );
}
