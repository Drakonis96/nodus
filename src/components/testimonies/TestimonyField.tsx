import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui';
import { t } from '../../i18n';

/**
 * Un campo que se guarda solo, con el estado del guardado a la vista.
 *
 * Guardado automático porque una sesión de historia oral son horas de trabajo continuo y
 * un botón «Guardar» que alguien olvida pulsa una vez cuesta una tarde de notas. Y CON
 * ESTADO VISIBLE porque un guardado automático silencioso es indistinguible de uno que ha
 * dejado de funcionar: el usuario tiene que poder ver que su trabajo está a salvo antes
 * de cerrar la ventana (17 del plan).
 *
 * El retardo se cuenta desde la última tecla, no desde la primera: escribir un párrafo
 * seguido produce UNA escritura, no una por palabra.
 */
export function TestimonyField({
  label,
  hint,
  value,
  placeholder,
  rows = 3,
  multiline = true,
  readOnly = false,
  testid,
  onSave,
}: {
  label: string;
  hint?: string;
  value: string | null;
  placeholder?: string;
  rows?: number;
  multiline?: boolean;
  readOnly?: boolean;
  testid?: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  // Al desmontar se guarda lo pendiente. Cerrar el dossier no puede tirar el párrafo que
  // el usuario acaba de escribir (17: recuperación ante cierre durante edición).
  const pending = useRef<string | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current !== null) void saveRef.current(pending.current);
  }, []);

  const schedule = (next: string): void => {
    setDraft(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setState('saving');
      void saveRef.current(next)
        .then(() => {
          pending.current = null;
          setState('saved');
          setTimeout(() => setState('idle'), 1600);
        })
        .catch(() => setState('idle'));
    }, 600);
  };

  const shared = {
    className: 'input w-full',
    value: draft,
    placeholder: placeholder ? t(placeholder) : undefined,
    readOnly,
    'data-testid': testid,
    onChange: (event: { target: { value: string } }) => schedule(event.target.value),
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-xs font-medium text-neutral-600 dark:text-neutral-400">
        {t(label)}
        {state === 'saving' && <span className="flex items-center gap-1 text-[10px] text-neutral-500"><Icon name="sync" size={10} className="animate-spin" />{t('Guardando…')}</span>}
        {state === 'saved' && <span className="flex items-center gap-1 text-[10px] text-emerald-500"><Icon name="check" size={10} />{t('Guardado')}</span>}
      </span>
      {hint && <p className="text-[11px] leading-4 text-neutral-500">{t(hint)}</p>}
      {multiline
        ? <textarea rows={rows} {...shared} />
        : <input {...shared} />}
    </div>
  );
}
