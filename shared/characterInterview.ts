/**
 * Interviewing a character: the author asks, the character answers in their own voice.
 *
 * This is the one place in the vault where the AI is asked to speak AS the character
 * rather than about them, and the rules are therefore inverted from every other prompt
 * here: it must stay in character, and it must refuse to know things the sheet does not
 * contain — a character who cheerfully invents their own mother's name is worse than
 * useless, because the author may believe it later.
 *
 * Pure so the prompt is unit-testable without a provider.
 */

import type { CharacterBiographySources } from './characterBiographyContext';
import { composeCharacterBiographyContext } from './characterBiographyContext';
import type { PromptLanguage } from './types';

export interface InterviewTurn {
  role: 'author' | 'character';
  content: string;
}

export interface CharacterInterviewSources extends CharacterBiographySources {
  voiceRegister: string | null;
  voiceTics: string | null;
  voiceSample: string | null;
  abilities: { name: string; cost: string | null; limits: string | null }[];
  arc: { want: string | null; need: string | null; flaw: string | null; lie: string | null; wound: string | null };
  scenes: { title: string; role: string | null; summary: string | null; notes: string | null }[];
  /** The UI has opted in and this exact turn explicitly requests an image. */
  canSendImages?: boolean;
}

export function characterInterviewSystem(sources: CharacterInterviewSources): string {
  const lines: string[] = [
    `Vas a INTERPRETAR a un personaje de ficción llamado ${sources.name} y responder como él, en primera persona, a las preguntas de su autor.`,
    '',
    'Reglas estrictas:',
    '- Habla SIEMPRE en primera persona, como el personaje. Nunca te refieras a él en tercera persona ni expliques lo que estás haciendo.',
    '- No sabes nada que no esté en tu ficha. Si te preguntan algo que no consta, respóndelo EN PERSONAJE de forma que se note que no lo sabes o que no quieres decirlo («No lo recuerdo», «Eso no te lo voy a contar»). NO te lo inventes: el autor podría dárselo por cierto más tarde.',
    '- No contradigas nada de tu ficha.',
    '- Respuestas breves: de una a cinco frases, salvo que te pidan explayarte.',
    '- Nunca rompas el personaje, ni siquiera para avisar de que eres una IA.',
  ];

  if (sources.pronouns) lines.push(`- Tus pronombres son ${sources.pronouns}. Úsalos.`);
  if (sources.canSendImages) {
    lines.push(
      '- El autor te ha pedido explícitamente una imagen y el chat puede adjuntarla. Responde como si fueras a enviársela ahora: describe solo lo necesario desde tu voz, sin decir que no puedes crear o adjuntar imágenes.'
    );
  }

  const voice = [
    sources.voiceRegister ? `registro: ${sources.voiceRegister}` : '',
    sources.voiceTics ? `tics y muletillas: ${sources.voiceTics}` : '',
  ].filter(Boolean);
  if (voice.length) lines.push(`- Tu forma de hablar — ${voice.join('; ')}.`);
  if (sources.voiceSample) {
    lines.push('', 'Así hablas (imita este tono, no repitas las frases):', sources.voiceSample.trim());
  }

  const arc = [
    sources.arc.want ? `quieres: ${sources.arc.want}` : '',
    sources.arc.flaw ? `tu defecto: ${sources.arc.flaw}` : '',
    sources.arc.lie ? `te crees que: ${sources.arc.lie}` : '',
    sources.arc.wound ? `tu herida: ${sources.arc.wound}` : '',
  ].filter(Boolean);
  if (arc.length) {
    lines.push(
      '',
      // The need is withheld on purpose: a character who can articulate what they
      // actually need has already completed their arc, and the interview stops being
      // interesting.
      `Lo que te mueve (no lo enuncies de forma explícita, actúa desde ahí): ${arc.join('; ')}.`
    );
  }

  if (sources.abilities.length) {
    lines.push('', 'Lo que sabes hacer:');
    for (const ability of sources.abilities.slice(0, 12)) {
      const detail = [ability.cost ? `te cuesta ${ability.cost}` : '', ability.limits ? `no puedes ${ability.limits}` : '']
        .filter(Boolean)
        .join('; ');
      lines.push(`- ${ability.name}${detail ? ` (${detail})` : ''}`);
    }
  }

  if (sources.scenes.length) {
    lines.push(
      '',
      'Escenas que has vivido en el relato (puedes recordarlas, pero no sabes lo que ocurre en escenas donde no apareces):'
    );
    for (const scene of sources.scenes.slice(0, 20)) {
      const role = scene.role ? `; tu función en la escena: ${scene.role}` : '';
      const summary = scene.summary?.replace(/\s+/g, ' ').trim().slice(0, 600);
      const notes = scene.notes?.replace(/\s+/g, ' ').trim().slice(0, 400);
      lines.push(`- ${scene.title}${role}.${summary ? ` ${summary}` : ''}${notes ? ` Claves del autor: ${notes}` : ''}`);
    }
  }

  lines.push('', '═══ TU FICHA ═══', composeCharacterBiographyContext(sources).replace(/\nRedacta la biografía.*$/s, '').trim());

  return lines.join('\n');
}

/**
 * Transcript scaffolding, per prompt language. The task contract the character reads is
 * localized, so the transcript must be too: a Spanish «Tú:» under an English contract is
 * the kind of seam that makes a model narrate the scene instead of answering inside it.
 */
interface InterviewTranscriptCopy {
  author: string;
  character: string;
  /** Stage direction naming the openings this character has already worn out. */
  avoidOpenings: (openings: string) => string;
}

const TRANSCRIPT_COPY: Record<PromptLanguage, InterviewTranscriptCopy> = {
  es: {
    author: 'Autor',
    character: 'Tú',
    avoidOpenings: (openings) =>
      `[Ya has abierto respuestas así: ${openings}. Empieza esta de otra forma y no repitas esas fórmulas.]`,
  },
  en: {
    author: 'Author',
    character: 'You',
    avoidOpenings: (openings) =>
      `[You have already opened replies like this: ${openings}. Start this one differently and do not reuse those formulas.]`,
  },
  fr: {
    author: 'Auteur',
    character: 'Toi',
    avoidOpenings: (openings) =>
      `[Tu as déjà commencé des réponses ainsi : ${openings}. Commence celle-ci autrement et ne réutilise pas ces formules.]`,
  },
  tr: {
    author: 'Yazar',
    character: 'Sen',
    avoidOpenings: (openings) =>
      `[Yanıtlarına daha önce şöyle başladın: ${openings}. Bu yanıta farklı başla ve bu kalıpları yineleme.]`,
  },
  de: {
    author: 'Autor',
    character: 'Du',
    avoidOpenings: (openings) =>
      `[Du hast Antworten bereits so begonnen: ${openings}. Beginne diese anders und wiederhole diese Formeln nicht.]`,
  },
  pt: {
    author: 'Autor',
    character: 'Tu',
    avoidOpenings: (openings) =>
      `[Já começaste respostas assim: ${openings}. Começa esta de outra forma e não repitas essas fórmulas.]`,
  },
  'pt-BR': {
    author: 'Autor',
    character: 'Você',
    avoidOpenings: (openings) =>
      `[Você já começou respostas assim: ${openings}. Comece esta de outro jeito e não repita essas fórmulas.]`,
  },
  it: {
    author: 'Autore',
    character: 'Tu',
    avoidOpenings: (openings) =>
      `[Hai già iniziato risposte così: ${openings}. Inizia questa in un altro modo e non ripetere quelle formule.]`,
  },
};

/**
 * How much of the exchange the character can see. Wide enough that the author can refer
 * back to something said several questions ago — a character who forgets the name you
 * gave them two turns earlier is not an interview — and bounded twice (turns AND
 * characters) so one long answer can't blow the prompt on the next turn.
 */
const HISTORY_TURNS = 24;
const HISTORY_CHARS = 7000;

/** How many past replies are checked for a repeated opening. */
const OPENINGS_CHECKED = 6;

/**
 * The opening words of a reply: long enough to recognise a formula the character keeps
 * reusing («Mira al borde, viajero», «Uno: …»), short enough that forbidding it forbids
 * a habit rather than a topic. Cut at the first punctuation, because the formula is the
 * clause and not the sentence, then capped twice — a reply with no punctuation at all
 * would otherwise be quoted back to the model almost whole.
 */
export function openingSignature(content: string): string {
  const flat = content.replace(/\s+/g, ' ').replace(/^[\s"“«—–-]+/, '').trim();
  const stop = flat.search(/[.,;:!?…]/);
  const head = (stop > 0 ? flat.slice(0, stop) : flat).trim();
  return head.split(' ').slice(0, 6).join(' ').slice(0, 70).trim();
}

/** Flatten the exchange into the plain transcript the completion endpoint receives. */
export function composeInterviewPrompt(
  history: InterviewTurn[],
  question: string,
  language: PromptLanguage = 'es'
): string {
  const copy = TRANSCRIPT_COPY[language] ?? TRANSCRIPT_COPY.es;

  // Newest first, so the character budget drops the OLDEST turns rather than the ones
  // that just happened.
  const recent: string[] = [];
  let budget = HISTORY_CHARS;
  for (const turn of history.slice(-HISTORY_TURNS).reverse()) {
    const line = `${turn.role === 'author' ? copy.author : copy.character}: ${turn.content.trim()}`;
    budget -= line.length + 1;
    if (budget < 0) break;
    recent.unshift(line);
  }
  const lines = [...recent, `${copy.author}: ${question.trim()}`];

  // Repetition is the failure mode of a voice sheet: told to preserve a speech pattern,
  // a model opens every single reply with the same catchphrase until the character reads
  // as a machine. A rule about frequency is not checkable by the model; the openings it
  // has already spent are, so they are named here, right before it takes the turn.
  const seen = new Set<string>();
  const openings: string[] = [];
  for (const turn of history.filter((entry) => entry.role === 'character').slice(-OPENINGS_CHECKED)) {
    const opening = openingSignature(turn.content);
    const key = opening.toLocaleLowerCase();
    if (opening.length < 3 || seen.has(key)) continue;
    seen.add(key);
    openings.push(`«${opening}»`);
  }
  if (openings.length) lines.push('', copy.avoidOpenings(openings.join('; ')));

  lines.push(`${copy.character}:`);
  return lines.join('\n');
}
