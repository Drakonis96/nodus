import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  daysPerYear,
  validateCalendar,
  type WorldCalendar,
  type WorldEra,
  type WorldMonth,
} from '@shared/worldCalendar';
import { Icon } from './ui';
import { t, tx } from '../i18n';

/** A starting point, so nobody faces twelve empty rows. Twelve 30-day months. */
const SUGGESTED_MONTHS = ['Deshielo', 'Siembra', 'Lluvia', 'Flor', 'Sol Alto', 'Siega', 'Polvo', 'Vendimia', 'Hoja', 'Bruma', 'Escarcha', 'Larga Noche'];

/**
 * Define the world's calendar: its eras and its months.
 *
 * Optional on purpose. Without it the integer year still orders everything; with it the
 * author gets exact ordering within a year and a real date picker. Nobody should have to
 * invent twelve month names before writing their first character, so this is a dialog the
 * writer opens when they are ready, not a wizard that blocks them.
 */
export function WorldCalendarModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (calendar: WorldCalendar) => void;
}) {
  const [name, setName] = useState('');
  const [eras, setEras] = useState<WorldEra[]>([]);
  const [months, setMonths] = useState<WorldMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.nodus.getWorldCalendar().then((calendar) => {
      if (!active) return;
      setName(calendar.name ?? '');
      setEras(calendar.eras);
      setMonths(calendar.months);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const draft: WorldCalendar = { name: name || null, notes: null, eras, months };
  const problems = validateCalendar(draft);
  const perYear = daysPerYear(draft);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await window.nodus.saveWorldCalendar({
        name: name.trim() || null,
        eras: eras.map((era) => ({
          eraId: era.eraId || undefined,
          name: era.name,
          abbreviation: era.abbreviation,
          startYear: era.startYear,
          countsBackwards: era.countsBackwards,
        })),
        months: months.map((month) => ({ monthId: month.monthId || undefined, name: month.name, days: month.days })),
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="card-modal flex max-h-[90vh] w-full max-w-2xl flex-col p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="world-calendar-title"
        data-testid="world-calendar-modal"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="world-calendar-title" className="text-base font-semibold text-neutral-100">
              {t('Calendario del mundo')}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              {t('Opcional. Sin calendario, el año ordena la cronología igual que hasta ahora; con él, además ordena dentro de cada año y puedes elegir la fecha en vez de escribirla.')}
            </p>
          </div>
          <button
            className="btn btn-ghost h-8 w-8 shrink-0 p-0 text-neutral-400"
            aria-label={t('Cerrar')}
            disabled={saving}
            onClick={onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-neutral-500">{t('Cargando…')}</p>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <input
              className="input h-9 w-full text-sm"
              value={name}
              placeholder={t('Nombre del calendario (opcional)')}
              aria-label={t('Nombre del calendario (opcional)')}
              onChange={(event) => setName(event.target.value)}
            />

            <section>
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Eras')}</h4>
                <button
                  className="btn btn-ghost ml-auto h-7 gap-1 border border-neutral-700 text-xs"
                  onClick={() =>
                    setEras((current) => [
                      ...current,
                      { eraId: '', name: '', abbreviation: null, startYear: 0, countsBackwards: false, sortOrder: current.length },
                    ])
                  }
                >
                  <Icon name="plus" size={12} /> {t('Añadir era')}
                </button>
              </div>
              <p className="mb-2 text-[10px] leading-4 text-neutral-600">
                {t('El «año inicial» es el año absoluto en el que cae el año 1 de esa era: es lo que permite comparar fechas de eras distintas.')}
              </p>
              {eras.length === 0 ? (
                <p className="text-xs text-neutral-500">{t('Sin eras. Puedes usar solo años sueltos.')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {eras.map((era, index) => (
                    <li key={index} className="flex flex-wrap items-center gap-1.5">
                      <input
                        className="input h-8 min-w-32 flex-1 text-xs"
                        value={era.name}
                        placeholder={t('Nombre de la era')}
                        aria-label={t('Nombre de la era')}
                        onChange={(event) =>
                          setEras((current) => current.map((e, i) => (i === index ? { ...e, name: event.target.value } : e)))
                        }
                      />
                      <input
                        className="input h-8 w-20 text-xs"
                        value={era.abbreviation ?? ''}
                        placeholder={t('Abrev.')}
                        aria-label={t('Abreviatura de la era')}
                        onChange={(event) =>
                          setEras((current) =>
                            current.map((e, i) => (i === index ? { ...e, abbreviation: event.target.value || null } : e))
                          )
                        }
                      />
                      <input
                        className="input h-8 w-24 text-xs"
                        type="number"
                        value={era.startYear}
                        aria-label={t('Año inicial')}
                        onChange={(event) =>
                          setEras((current) =>
                            current.map((e, i) => (i === index ? { ...e, startYear: Number(event.target.value) || 0 } : e))
                          )
                        }
                      />
                      <label className="flex items-center gap-1 text-[10px] text-neutral-400" title={t('Cuenta hacia atrás, como «a.C.»')}>
                        <input
                          type="checkbox"
                          checked={era.countsBackwards}
                          onChange={(event) =>
                            setEras((current) =>
                              current.map((e, i) => (i === index ? { ...e, countsBackwards: event.target.checked } : e))
                            )
                          }
                        />
                        {t('Cuenta atrás')}
                      </label>
                      <button
                        className="btn btn-ghost h-7 w-7 p-0 text-red-300"
                        title={t('Quitar')}
                        aria-label={t('Quitar era')}
                        onClick={() => setEras((current) => current.filter((_, i) => i !== index))}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {t('Meses')}
                  {months.length > 0 && (
                    <span className="ml-1 text-neutral-600">{tx('({n} días al año)', { n: String(perYear) })}</span>
                  )}
                </h4>
                {months.length === 0 && (
                  <button
                    className="btn btn-ghost ml-auto h-7 gap-1 border border-neutral-700 text-xs"
                    onClick={() =>
                      setMonths(
                        SUGGESTED_MONTHS.map((monthName, index) => ({
                          monthId: '',
                          name: t(monthName),
                          days: 30,
                          sortOrder: index,
                        }))
                      )
                    }
                  >
                    <Icon name="sparkles" size={12} /> {t('Empezar con 12 meses')}
                  </button>
                )}
                <button
                  className={`btn btn-ghost h-7 gap-1 border border-neutral-700 text-xs ${months.length === 0 ? '' : 'ml-auto'}`}
                  onClick={() =>
                    setMonths((current) => [...current, { monthId: '', name: '', days: 30, sortOrder: current.length }])
                  }
                >
                  <Icon name="plus" size={12} /> {t('Añadir mes')}
                </button>
              </div>
              {months.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  {t('Sin meses no hay calendario: la cronología seguirá ordenándose solo por año.')}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {months.map((month, index) => (
                    <li key={index} className="flex items-center gap-1.5">
                      <span className="w-6 shrink-0 text-right text-[10px] text-neutral-600">{index + 1}</span>
                      <input
                        className="input h-8 flex-1 text-xs"
                        value={month.name}
                        placeholder={t('Nombre del mes')}
                        aria-label={t('Nombre del mes')}
                        onChange={(event) =>
                          setMonths((current) =>
                            current.map((m, i) => (i === index ? { ...m, name: event.target.value } : m))
                          )
                        }
                      />
                      <input
                        className="input h-8 w-20 text-xs"
                        type="number"
                        min={1}
                        value={month.days}
                        aria-label={t('Días del mes')}
                        onChange={(event) =>
                          setMonths((current) =>
                            current.map((m, i) => (i === index ? { ...m, days: Number(event.target.value) || 1 } : m))
                          )
                        }
                      />
                      <button
                        className="btn btn-ghost h-7 w-7 p-0 text-red-300"
                        title={t('Quitar')}
                        aria-label={t('Quitar mes')}
                        onClick={() => setMonths((current) => current.filter((_, i) => i !== index))}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {problems.length > 0 && (
              <ul className="space-y-1 rounded-md border border-amber-900/60 bg-amber-950/15 p-2">
                {problems.map((problem) => (
                  <li key={problem} className="text-[11px] text-amber-300">
                    {t(problem)}
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="text-xs text-red-300">{error}</p>}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2 border-t border-neutral-800 pt-3">
          <p className="flex-1 text-[10px] leading-4 text-neutral-600">
            {t('Al guardar se recalculan las fechas de todos los hechos ya registrados.')}
          </p>
          <button className="btn btn-ghost border border-neutral-700 px-3 text-xs" onClick={onClose} disabled={saving}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary min-w-32" disabled={saving || loading} onClick={() => void save()}>
            {saving ? t('Guardando…') : t('Guardar calendario')}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
