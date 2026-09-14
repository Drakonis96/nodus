// Server-render entry for the "Extensión orientativa de cada sección" control, so
// scripts/test-deep-research-section-length-field.mjs can assert on the markup the
// composers really produce. A regular expression over the source cannot tell a
// working control from JSX that throws on its first prop; rendering it can.
import { renderToStaticMarkup } from 'react-dom/server';
import { DeepResearchSectionLengthField } from '../src/components/DeepResearchSectionLengthField';
import { setActiveLang } from '../src/i18n';
import type { AppLanguage } from '../shared/types';
import type { DeepResearchSectionLength } from '../shared/deepResearchSectionLength';

export function renderSectionLengthField(
  value: DeepResearchSectionLength = 'auto',
  language: AppLanguage = 'es',
): string {
  setActiveLang(language);
  return renderToStaticMarkup(
    <DeepResearchSectionLengthField value={value} onChange={() => undefined} />,
  );
}
