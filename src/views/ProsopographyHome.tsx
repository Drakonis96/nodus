import { useState } from 'react';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import type { View } from '../navigation';

const steps: Array<{ label: string; icon: string; view: View }> = [
  { label: 'Definir población', icon: 'users', view: 'prosopPopulation' },
  { label: 'Diseñar cuestionario', icon: 'table', view: 'prosopPopulation' },
  { label: 'Registrar fuentes', icon: 'archive', view: 'prosopSources' },
  { label: 'Resolver identidades', icon: 'user', view: 'prosopPersons' },
  { label: 'Analizar cohortes', icon: 'chartBar', view: 'prosopAnalysis' },
];

export function ProsopographyHome({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [demoMessage,setDemoMessage]=useState('');
  return (
    <div className="h-full overflow-auto bg-neutral-50 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-100" data-testid="prosopography-home">
      <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
        <header className="overflow-hidden rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-6 dark:border-blue-900/60 dark:from-blue-950/35 dark:via-neutral-950 dark:to-indigo-950/20 sm:p-8">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
            <Icon name="users" size={12} /> {t('Prosopografía')}
          </span>
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight">{t('Configura el estudio')}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-400">
            {t('Prosopografía estudia una población histórica sin separar los datos de la evidencia que los sostiene.')}
          </p>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-400">
            {t('Comienza por la pregunta de investigación, la población objetivo y el cuestionario común.')}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button className="btn bg-blue-600 text-white hover:bg-blue-700" onClick={() => onNavigate('prosopPopulation')}>
              <Icon name="users" size={14} /> {t('Abrir Población')}
            </button>
            <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => onNavigate('prosopSearch')}>
              <Icon name="search" size={14} /> {t('Buscar en prosopografía')}
            </button>
            <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => void window.nodus.seedProsopDemo().then((result)=>setDemoMessage(result.message)).catch((error)=>setDemoMessage(String(error?.message??error)))}>
              <Icon name="sparkles" size={14} /> {t('Crear demo metodológica')}
            </button>
          </div>
          {demoMessage&&<p role="status" className="mt-3 text-xs text-blue-700 dark:text-blue-300">{demoMessage}</p>}
        </header>

        <section className="grid gap-4 md:grid-cols-3" aria-label={t('Estado metodológico')}>
          {[
            ['Estado metodológico', 'Estudio sin definir', 'Define la pregunta, el universo y los límites del estudio.', 'compass'],
            ['Cuestionario', 'Sin versión publicada', 'Publica un cuestionario común antes de codificar observaciones.', 'table'],
            ['Corpus documental', 'Sin fuentes', 'Registra las fuentes previstas y su cobertura.', 'archive'],
          ].map(([title, value, description, icon]) => (
            <article key={title} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"><Icon name={icon} size={16} /></span>
              <h2 className="mt-4 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t(title)}</h2>
              <p className="mt-1 text-base font-semibold">{t(value)}</p>
              <p className="mt-2 text-xs leading-5 text-neutral-500">{t(description)}</p>
            </article>
          ))}
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">{t('Flujo de trabajo')}</h2>
              <p className="mt-1 text-xs text-neutral-500">{t('Diseña la población antes de convertir observaciones documentales en datos comparables.')}</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{t('No hay tareas pendientes.')}</span>
          </div>
          <ol className="mt-5 grid gap-3 sm:grid-cols-5">
            {steps.map((step, index) => (
              <li key={step.label}>
                <button className="group w-full rounded-xl border border-neutral-200 p-3 text-left transition hover:border-blue-400 hover:bg-blue-50 dark:border-neutral-800 dark:hover:border-blue-700 dark:hover:bg-blue-950/20" onClick={() => onNavigate(step.view)}>
                  <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400"><span>{index + 1}</span><Icon name={step.icon} size={13} /></span>
                  <span className="mt-3 block text-xs font-medium group-hover:text-blue-700 dark:group-hover:text-blue-300">{t(step.label)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <aside className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
          <Icon name="info" className="mt-0.5 shrink-0" />
          <div><h2 className="text-sm font-semibold">{t('Una observación no es un hecho')}</h2><p className="mt-1 text-xs leading-5 opacity-80">{t('Toda afirmación vuelve a su fuente y conserva incertidumbre, contradicción y literal.')}</p></div>
        </aside>
        <details className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900/60" data-testid="prosopography-tour">
          <summary className="cursor-pointer text-sm font-semibold">{t('Tour del método prosopográfico')}</summary>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">{[
            ['1','Población antes que fichas'],['2','Mención antes que identidad'],['3','Evidencia antes que resumen'],
            ['4','Ausencia con razón'],['5','Análisis con denominador'],['6','Redes por origen'],
          ].map(([number,label])=><li key={number} className="rounded-xl bg-neutral-50 p-3 text-xs dark:bg-neutral-950"><span className="font-semibold text-blue-600">{number}</span><span className="ml-2">{t(label)}</span></li>)}</ol>
        </details>
      </div>
    </div>
  );
}
