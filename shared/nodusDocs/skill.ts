import type { ChatSkill } from '../chatSkills';
import type { PromptLanguage } from '../types';
import { nodusDocTopic, selectNodusDocs, type NodusDocsSelection } from './retrieval';
import { NODUS_DOC_AREA_LABEL, docLanguage } from './types';

/** The hidden documentation skill.
 *
 *  Nodi answers product questions from a guide the user cannot install, uninstall or
 *  deactivate, because it is not a capability of the application: it is the
 *  application's own documentation. It is therefore built per reply and never written
 *  to the skills library, which is why nothing in the Skills UI or the Marketplace can
 *  show it, and it exists exactly while the Nodus documentation context is on.
 *
 *  The instructions carry the answer protocol and the index of every documented sheet;
 *  the sheets themselves travel in the documentation context of the same reply. Splitting
 *  it this way keeps the system prompt short and testable while the retrieved bodies stay
 *  in the user message, where the rest of the retrieved material lives. */
export const NODUS_DOCS_SKILL_ID = 'builtin-nodus-docs';

export function buildNodusDocsSkill(selection: NodusDocsSelection, language: PromptLanguage = 'es'): ChatSkill {
  const code = docLanguage(language);
  const protocol = nodusDocTopic('protocol-answer-rules');
  const instructions = [
    protocol?.body[code] ?? '',
    `## ${code === 'es' ? 'Índice de temas documentados' : 'Index of documented sheets'}\n${selection.index}`,
    code === 'es'
      ? `## Temas servidos en este turno\n${selection.ids.join(', ')}`
      : `## Sheets served this turn\n${selection.ids.join(', ')}`,
    selection.alsoRelevant.length
      ? (code === 'es'
        ? `## Temas relevantes que no caben en este turno\n${selection.alsoRelevant.join(', ')}. Si la pregunta exige uno de ellos, dilo y pide que se reformule la pregunta o se desactive otro contexto para hacer sitio.`
        : `## Relevant sheets that did not fit this turn\n${selection.alsoRelevant.join(', ')}. If the question needs one of them, say so and ask for the question to be narrowed or another context to be turned off to make room.`)
      : '',
    ...(code === 'es'
      ? [`## Áreas del índice\n${Object.values(NODUS_DOC_AREA_LABEL).map((label) => label.es).join(' · ')}`]
      : [`## Index areas\n${Object.values(NODUS_DOC_AREA_LABEL).map((label) => label.en).join(' · ')}`]),
  ].filter(Boolean).join('\n\n');
  return {
    id: NODUS_DOCS_SKILL_ID,
    name: code === 'es' ? 'Documentación de Nodus' : 'Nodus Documentation',
    description: code === 'es'
      ? 'Úsala siempre que la pregunta trate sobre Nodus: qué hace una sección, dónde está una opción, cómo se hace un procedimiento, cómo resolver un error o un problema, qué necesita cada función, qué está planificado y qué no, o cómo funciona la privacidad y la publicación.'
      : 'Use it whenever the question is about Nodus: what a section does, where an option lives, how a procedure works, how to solve an error or a problem, what each feature needs, what is planned and what is not, or how privacy and publishing work.',
    instructions,
    enabled: { assistant: false, nodi: true },
    category: 'Nodus',
    version: '1.0.0',
    author: 'Nodus',
  };
}

/** The reply's documentation payload: the retrieved sheets plus the hidden skill. */
export function buildNodusDocsTurn(options: { question: string; language?: PromptLanguage; budget?: number }) {
  const language = options.language ?? 'es';
  const selection = selectNodusDocs({ question: options.question, language, budget: options.budget });
  return { selection, skill: buildNodusDocsSkill(selection, language) };
}
