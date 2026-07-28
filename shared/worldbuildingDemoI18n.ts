import type { AppLanguage } from './types';
import { normalizeUiLanguage } from './uiLanguage';
import { WORLD_DEMO_TRANSLATIONS } from './worldbuildingDemoTranslations.generated';

export type WorldbuildingDemoLocalized = Record<AppLanguage, string>;

export function worldbuildingDemoLocale(language: unknown): AppLanguage {
  return normalizeUiLanguage(language);
}

export function worldbuildingDemoText(
  language: unknown,
  es: string,
  en?: string
): string {
  const locale = worldbuildingDemoLocale(language);
  if (locale === 'es') return es;
  if (locale === 'en' && en) return en;
  return WORLD_DEMO_TRANSLATIONS[es]?.[locale] ?? en ?? es;
}

export function worldbuildingDemoLocalized(
  es: string,
  en: string
): WorldbuildingDemoLocalized {
  return {
    es,
    en,
    fr: worldbuildingDemoText('fr', es, en),
    de: worldbuildingDemoText('de', es, en),
    pt: worldbuildingDemoText('pt', es, en),
    'pt-BR': worldbuildingDemoText('pt-BR', es, en),
    it: worldbuildingDemoText('it', es, en),
    tr: worldbuildingDemoText('tr', es, en),
  };
}

export function worldbuildingDemoVariants(es: string, en?: string): string[] {
  const translated = WORLD_DEMO_TRANSLATIONS[es];
  return [...new Set([
    es,
    ...(en ? [en] : []),
    ...(translated ? Object.values(translated) : []),
  ])];
}

let reverseDemoTranslations: Map<string, string> | null = null;

function demoSourceKey(value: string): string | null {
  if (!reverseDemoTranslations) {
    reverseDemoTranslations = new Map();
    for (const [source, variants] of Object.entries(WORLD_DEMO_TRANSLATIONS)) {
      for (const translated of Object.values(variants)) {
        if (!reverseDemoTranslations.has(translated)) reverseDemoTranslations.set(translated, source);
      }
    }
  }
  return reverseDemoTranslations.get(value) ?? null;
}

/**
 * Change untouched, demo-owned prose from one supported language to another.
 *
 * User edits are deliberately preserved: only an exact shipped translation is replaced.
 * Internal world links are temporarily restored to their `[[label]]` source form so a
 * translated article remains recognisable after the renderer has expanded those links to
 * `nodus://` Markdown.
 */
export function relocalizeWorldbuildingDemoText(value: string, language: unknown): string {
  const locale = worldbuildingDemoLocale(language);
  const direct = demoSourceKey(value);
  if (direct) return worldbuildingDemoText(locale, direct);

  // A few visual seeds deliberately combine independently editable stock fragments:
  // the entity name, the kind of illustration and a colour token. Translate the known
  // pieces without claiming ownership of the unknown ones.
  const segments = value.split(', ');
  if (segments.length > 1) {
    let changed = false;
    const translatedSegments = segments.map((segment) => {
      const source = demoSourceKey(segment);
      if (!source) return segment;
      const translated = worldbuildingDemoText(locale, source);
      changed ||= translated !== segment;
      return translated;
    });
    if (changed) return translatedSegments.join(', ');
  }

  const links: string[] = [];
  const wiki = value.replace(
    /\[([^\]\n]+)\]\((nodus:\/\/world\/[^)\s]+)\)/g,
    (_whole, label: string, url: string) => {
      links.push(url);
      return `[[${label}]]`;
    }
  );
  if (!links.length) return value;
  const source = demoSourceKey(wiki);
  if (!source) return value;
  let translated = worldbuildingDemoText(locale, source);
  let index = 0;
  translated = translated.replace(/\[\[([^\]\n]+)\]\]/g, (_whole, label: string) => {
    const url = links[index++];
    return url ? `[${label}](${url})` : label;
  });
  return translated;
}
