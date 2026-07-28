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

/** Flatten the exchange into the plain transcript the completion endpoint receives. */
export function composeInterviewPrompt(history: InterviewTurn[], question: string): string {
  const lines = history.slice(-12).map((turn) => `${turn.role === 'author' ? 'Autor' : 'Tú'}: ${turn.content.trim()}`);
  lines.push(`Autor: ${question.trim()}`);
  lines.push('Tú:');
  return lines.join('\n');
}
