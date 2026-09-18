import type { PromptLanguage } from '../types';

/** One verified fact sheet Nodi can answer from.
 *
 *  The corpus is deliberately topic-shaped rather than one long guide: a question
 *  selects the few sheets that answer it, so the assistant can stay exhaustive
 *  without shipping every product fact into every reply. `keywords` is the recall
 *  surface — the words a user actually types — while `body` is what the model
 *  reads, so a keyword never has to appear in the prose. */
export interface NodusDocTopic {
  /** Stable id, quoted by the model as its base and asserted by the retrieval test. */
  id: string;
  area: NodusDocArea;
  title: NodusDocText;
  /** Accent-folded at build time; Spanish and English spellings both belong here. */
  keywords: readonly string[];
  body: NodusDocText;
  /** Sheets worth reading next; also the seam the retrieval follows one hop. */
  related?: readonly string[];
}

export interface NodusDocText {
  es: string;
  en: string;
}

export type NodusDocArea =
  | 'protocol'
  | 'general'
  | 'vaults'
  | 'sections'
  | 'settings'
  | 'models'
  | 'tools'
  | 'nodi'
  | 'server'
  | 'troubleshooting'
  | 'privacy';

export const NODUS_DOC_AREA_LABEL: Record<NodusDocArea, NodusDocText> = {
  protocol: { es: 'Cómo responder', en: 'How to answer' },
  general: { es: 'Mapa general', en: 'Overall map' },
  vaults: { es: 'Bóvedas', en: 'Vaults' },
  sections: { es: 'Secciones y procedimientos', en: 'Sections and procedures' },
  settings: { es: 'Ajustes', en: 'Settings' },
  models: { es: 'Modelos e IA', en: 'Models and AI' },
  tools: { es: 'Herramientas', en: 'Tools' },
  nodi: { es: 'Nodi', en: 'Nodi' },
  server: { es: 'Servidor, MCP e integraciones', en: 'Server, MCP and integrations' },
  troubleshooting: { es: 'Problemas y cómo resolverlos', en: 'Problems and how to solve them' },
  privacy: { es: 'Privacidad y datos', en: 'Privacy and data' },
};

/** Which language a sheet is served in. Spanish and English are authored; every
 *  other interface language reads the English sheets while the localized compact
 *  guide keeps the app's own vocabulary in that language. */
export function docLanguage(language: PromptLanguage): 'es' | 'en' {
  return language === 'es' ? 'es' : 'en';
}
