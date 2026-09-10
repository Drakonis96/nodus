import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { DeepResearchSectionLengthField } from '../src/components/DeepResearchSectionLengthField';
import { setActiveLang, t } from '../src/i18n';
import { PROMPT_LANGUAGE_OPTIONS } from '../shared/promptLanguageOptions';
import type { AppLanguage, PromptLanguage } from '../shared/types';
import type { DeepResearchSectionLength } from '../shared/deepResearchSectionLength';
import '../src/index.css';

/**
 * The real Deep Research composer, reduced to the two controls this feature is
 * about, so a browser can actually operate them: pick "Custom", type an invalid
 * number, see the accessible error, type a valid one.
 *
 * Everything below the header is the production component and the production
 * markup from DeepResearchView's composer — a mock of the control would prove
 * nothing about the control. `?lang=` picks the interface language so the same
 * page also serves as the screenshot source for any locale.
 */
const SECTION_OPTIONS = [
  { value: 'auto', label: 'Secciones: Auto (IA decide)' },
  { value: 'single', label: 'Bloque único · sin secciones' },
  { value: '4', label: 'Máx. 4 secciones' },
  { value: '5', label: 'Máx. 5 secciones' },
  { value: '6', label: 'Máx. 6 secciones' },
  { value: '8', label: 'Máx. 8 secciones' },
  { value: '10', label: 'Máx. 10 secciones' },
];

function Harness() {
  const [reportLanguage, setReportLanguage] = useState<PromptLanguage>('es');
  const [sectionLimit, setSectionLimit] = useState('4');
  const [sectionLength, setSectionLength] = useState<DeepResearchSectionLength>('auto');
  const [valid, setValid] = useState(true);

  return (
    <div className="min-h-screen bg-neutral-100 p-6 dark:bg-neutral-900">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('Nuevo informe')}
        className="mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-700 bg-white shadow-2xl dark:bg-neutral-950"
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-indigo-500/15 text-indigo-500 dark:text-indigo-300">◎</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Nuevo informe')}</h2>
            <p className="text-xs text-neutral-500">
              {t('El informe desarrolla tu idea por completo, citando todo el corpus.')}
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <textarea
            className="input min-h-28 w-full resize-y"
            placeholder={t('Escribe la idea o pregunta de investigación. El informe la desarrollará por completo, citando todas las obras del corpus.')}
            aria-label={t('Nuevo informe')}
            defaultValue="El papel de la administración turística en la construcción de la imagen del país."
          />
          <div className="grid grid-cols-2 items-start gap-2 max-sm:grid-cols-1">
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                {t('Estructura del informe')}
              </span>
              <select
                data-testid="deep-research-section-limit"
                className="input w-full min-w-0 self-start text-sm"
                value={sectionLimit}
                onChange={(event) => setSectionLimit(event.target.value)}
              >
                {SECTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{t(option.label)}</option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] leading-4 text-neutral-500">
                {t('Un número es el máximo de secciones publicadas; la evidencia se reagrupa dentro de ellas, nunca se descarta.')}
              </span>
            </label>
            <DeepResearchSectionLengthField
              value={sectionLength}
              onChange={setSectionLength}
              onValidityChange={setValid}
            />
            <label className="block min-w-0">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                {t('Idioma')}
              </span>
              <select
                data-testid="deep-research-language"
                className="input w-full text-sm"
                value={reportLanguage}
                onChange={(event) => setReportLanguage(event.target.value as PromptLanguage)}
              >
                {/* Endonyms, so they are never translated: see PROMPT_LANGUAGE_OPTIONS. */}
                {PROMPT_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <span data-testid="harness-state" className="text-[11px] text-neutral-500">
            {`sectionLimit=${sectionLimit} · sectionLength=${String(sectionLength)} · language=${reportLanguage} · valid=${String(valid)}`}
          </span>
          <button className="btn btn-primary" data-testid="harness-submit" disabled={!valid}>
            {t('Generar informe')}
          </button>
        </footer>
      </section>
    </div>
  );
}

const language = (new URLSearchParams(location.search).get('lang') ?? 'es') as AppLanguage;
setActiveLang(language);
document.documentElement.lang = language;
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
