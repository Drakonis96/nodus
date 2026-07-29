import { useEffect, useMemo, useRef, useState } from 'react';
import type { TestimonyCode } from '@shared/types';
import { cleanCodeLabel, isValidCodeLabel, rankCodeSuggestions, sameCode } from '@shared/testimonies';
import { CODE_KIND_LABEL } from '@shared/testimonyLabels';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';

/**
 * Elegir códigos y crearlos sobre la marcha.
 *
 * EL AUTOCOMPLETADO ES LA DEFENSA CONTRA EL GEMELO. Un código se escribe a las 23:40
 * mientras se lee una transcripción, y sin sugerencias «Posguerra», «posguerra» y
 * «post-guerra» acaban siendo tres códigos distintos en tres entrevistas. El resultado no
 * es un catálogo sucio: es un Contraste que devuelve menos de lo que hay y no avisa.
 *
 * Por eso las sugerencias se ordenan por USO y no por alfabeto: el objetivo no es listar
 * el catálogo, es que el investigador reutilice el código que ya existe.
 *
 * Y si el nombre escrito coincide con uno existente, crear DEVUELVE el existente en vez
 * de fallar: quien codifica quiere etiquetar ese fragmento, no gestionar un catálogo.
 */
export function CodePicker({
  codes,
  selected,
  onChange,
  onCatalogChanged,
  autoFocus = false,
  testid = 'testimony-code-picker',
}: {
  codes: TestimonyCode[];
  selected: string[];
  onChange: (codeIds: string[]) => void;
  onCatalogChanged: () => Promise<void> | void;
  autoFocus?: boolean;
  testid?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const byId = useMemo(() => new Map(codes.map((code) => [code.id, code])), [codes]);
  const suggestions = useMemo(
    () => rankCodeSuggestions(codes.filter((code) => !selected.includes(code.id)), query).slice(0, 8),
    [codes, query, selected],
  );
  const exact = useMemo(
    () => codes.find((code) => sameCode(code.label, query)) ?? null,
    [codes, query],
  );

  const commit = async (): Promise<void> => {
    const label = cleanCodeLabel(query);
    if (!isValidCodeLabel(label) || creating) return;
    if (exact) {
      if (!selected.includes(exact.id)) onChange([...selected, exact.id]);
      setQuery('');
      return;
    }
    setCreating(true);
    try {
      const created = await window.nodus.createTestimonyCode({ label });
      onChange([...selected, created.id]);
      setQuery('');
      setOpen(false);
      await onCatalogChanged();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5" ref={boxRef} data-testid={testid}>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((codeId) => {
            const code = byId.get(codeId);
            return (
              <span
                key={codeId}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                style={code?.color ? { borderColor: code.color, color: code.color } : undefined}
              >
                {code?.label ?? codeId}
                <button
                  type="button"
                  aria-label={tx('Quitar el código {name}', { name: code?.label ?? '' })}
                  className="opacity-70 hover:opacity-100"
                  onClick={() => onChange(selected.filter((id) => id !== codeId))}
                >
                  <Icon name="x" size={10} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative">
        <input
          className="input w-full text-xs"
          autoFocus={autoFocus}
          data-testid={`${testid}-input`}
          value={query}
          placeholder={t('Código o tema…')}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (suggestions.length > 0 && !exact) {
              onChange([...selected, suggestions[0].id]);
              setQuery('');
            } else {
              void commit();
            }
          }}
        />
        {open && (query.trim() !== '' || suggestions.length > 0) && (
          <div className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
            {suggestions.map((code) => (
              <button
                key={code.id}
                type="button"
                data-testid={`${testid}-suggestion`}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900"
                onClick={() => { onChange([...selected, code.id]); setQuery(''); setOpen(false); }}
              >
                {code.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: code.color }} />}
                <span className="min-w-0 flex-1 truncate">{code.label}</span>
                <span className="shrink-0 text-[10px] text-neutral-500">
                  {code.kind === 'theme' ? t(CODE_KIND_LABEL.theme) : ''}
                  {code.interviewCount > 0 && ` ${tx('{n} entrevistas', { n: code.interviewCount })}`}
                </span>
              </button>
            ))}
            {query.trim() !== '' && !exact && (
              <button
                type="button"
                data-testid={`${testid}-create`}
                className="flex w-full items-center gap-2 border-t border-neutral-200 px-3 py-1.5 text-left text-xs text-indigo-500 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
                disabled={creating}
                onClick={() => void commit()}
              >
                <Icon name={creating ? 'sync' : 'plus'} size={12} className={creating ? 'animate-spin' : ''} />
                {tx('Crear el código «{name}»', { name: cleanCodeLabel(query) })}
              </button>
            )}
            {exact && !selected.includes(exact.id) && (
              <p className="border-t border-neutral-200 px-3 py-1.5 text-[10px] text-neutral-500 dark:border-neutral-800">
                {tx('Ya existe «{name}»: se reutilizará en vez de crear un duplicado.', { name: exact.label })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
