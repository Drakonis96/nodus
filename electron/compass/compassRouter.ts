import type { CompassProviderId, CompassQueryPlan } from '@shared/compass';
const GENERAL: CompassProviderId[] = ['crossref', 'openaire', 'openalex'];
export function routeCompassProviders(plan: CompassQueryPlan, configured: Partial<Record<CompassProviderId, boolean>> = {}): CompassProviderId[] {
  const explicitlyConfigured = Object.keys(configured).length > 0;
  const enabled = (provider: CompassProviderId) => explicitlyConfigured ? configured[provider] === true : configured[provider] !== false;
  if (plan.providers.length) return plan.providers.filter((p, i, all) => all.indexOf(p) === i && enabled(p));
  const text = `${plan.text} ${plan.disciplines.join(' ')}`.toLowerCase(); const out = [...GENERAL];
  const languages = new Set(plan.languages.map((language) => language.toLowerCase().split('-')[0]));
  if (plan.identifiers.some((identifier) => identifier.scheme.toLowerCase() === 'doi')) out.unshift('unpaywall', 'opencitations');
  if (plan.types.some((type) => type === 'book' || type === 'chapter') || /\b(?:book|books|libro|libros|livro|livros|monograph|monografía|chapter|cap[ií]tulo)\b/.test(text)) out.unshift('doab', 'oapen', 'openedition');
  if (/\b(?:computer science|informatics|artificial intelligence|machine learning|medicine|biomedical|physics|chemistry|neuroscience)\b/.test(text)) out.unshift('semanticscholar');
  if (languages.has('es') || languages.has('ca') || /\b(?:español|spanish|catal[aá]n|iberoam[eé]rica|hispan)\b/.test(text)) out.unshift('dialnet', 'scielo');
  if (languages.has('pt') || /\b(?:portugu[eê]s|brazil|brasil|latin america|am[eé]rica latina)\b/.test(text)) out.unshift('scielo');
  if (languages.has('fr') || /\b(?:fran[cç]ais|french|humanities|humanidades|sciences humaines)\b/.test(text)) out.unshift('hal', 'openedition');
  if (plan.types.some((x) => ['thesis', 'report', 'dataset', 'preprint'].includes(x)) || /\b(?:thesis|tesis|dissertation|dataset|report|repository|repositorio)\b/.test(text)) out.unshift('hal', 'openaire');
  return [...new Set(out)].filter(enabled);
}
