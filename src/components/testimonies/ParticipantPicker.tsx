import { useEffect, useMemo, useRef, useState } from 'react';
import type { TestimonyParticipantRow } from '@shared/types';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';

/**
 * Elegir participantes, y darlos de alta sin salir de aquí.
 *
 * EL ALTA EN LÍNEA NO ES UN ATAJO: es la diferencia entre que el investigador registre a
 * la persona con la que acaba de hablar o que escriba su nombre en el título y siga. Un
 * modal que obliga a irse a otra sección para crear a alguien produce entrevistas sin
 * narrador identificado, y una entrevista sin saber quién habla es material sin
 * procedencia.
 *
 * Lo que se pide al crear es lo mínimo del plan: nombre de trabajo, nombre público si
 * difiere y modo de identificación. Nada de contacto — este vault no es una agenda.
 */
export function ParticipantPicker({
  label,
  hint,
  selected,
  onChange,
  people,
  onCreated,
  testid,
}: {
  label: string;
  hint?: string;
  selected: string[];
  onChange: (personIds: string[]) => void;
  people: TestimonyParticipantRow[];
  onCreated: () => Promise<void> | void;
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

  const byId = useMemo(() => new Map(people.map((person) => [person.personId, person])), [people]);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return people
      .filter((person) => !selected.includes(person.personId))
      .filter((person) =>
        !needle
        || person.workingName.toLocaleLowerCase().includes(needle)
        || (person.publicName ?? '').toLocaleLowerCase().includes(needle))
      .slice(0, 8);
  }, [people, query, selected]);

  const create = async (): Promise<void> => {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const profile = await window.nodus.createTestimonyParticipant({ workingName: name });
      onChange([...selected, profile.personId]);
      setQuery('');
      setOpen(false);
      await onCreated();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-1" ref={boxRef} data-testid={testid}>
      <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t(label)}</label>
      {hint && <p className="text-[11px] leading-4 text-neutral-500">{t(hint)}</p>}
      <div className="flex flex-wrap gap-1">
        {selected.map((personId) => {
          const person = byId.get(personId);
          return (
            <span
              key={personId}
              className="inline-flex items-center gap-1 rounded-full border border-indigo-400 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800 dark:border-indigo-700/60 dark:bg-indigo-950/40 dark:text-indigo-300"
            >
              {person?.workingName ?? personId}
              <button
                type="button"
                aria-label={tx('Quitar a {name}', { name: person?.workingName ?? '' })}
                onClick={() => onChange(selected.filter((id) => id !== personId))}
                className="opacity-70 hover:opacity-100"
              >
                <Icon name="x" size={11} />
              </button>
            </span>
          );
        })}
      </div>
      <div className="relative">
        <input
          className="input w-full"
          value={query}
          placeholder={t('Escribe un nombre…')}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (matches.length > 0) {
                onChange([...selected, matches[0].personId]);
                setQuery('');
              } else {
                void create();
              }
            }
          }}
        />
        {open && (query.trim() !== '' || matches.length > 0) && (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
            {matches.map((person) => (
              <button
                key={person.personId}
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                onClick={() => { onChange([...selected, person.personId]); setQuery(''); setOpen(false); }}
              >
                <span className="truncate">{person.workingName}</span>
                {person.publicName && person.publicName !== person.workingName && (
                  <span className="shrink-0 text-[11px] text-neutral-500">{person.publicName}</span>
                )}
              </button>
            ))}
            {query.trim() !== '' && (
              <button
                type="button"
                data-testid="testimony-create-participant-inline"
                className="flex w-full items-center gap-2 border-t border-neutral-200 px-3 py-2 text-left text-sm text-indigo-500 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
                onClick={() => void create()}
                disabled={creating}
              >
                <Icon name={creating ? 'sync' : 'plus'} size={13} className={creating ? 'animate-spin' : ''} />
                {tx('Crear «{name}»', { name: query.trim() })}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
