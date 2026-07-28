/**
 * Pure character-chat decisions. Image generation is opt-in twice: the switch must be
 * enabled and the author must explicitly ask the character to send/show an image.
 */

import type { DecorativeImageStyle } from './types';
import { imageStyleTemplate } from './imageStyles';

const IMAGE_NOUN =
  /\b(imagen|foto(?:graf[ií]a)?|retrato|selfie|dibujo|ilustraci[oó]n|picture|photo|image|portrait|photograph|bild|foto|portr[aä]t|zeichnung|illustration|imagem|fotografia|retrato|desenho|illustra[cç][aã]o|immagine|fotografia|ritratto|disegno|illustrazione|g[oö]rsel|foto[gğ]raf|resm(?:i|ini)|portre|[cç]izim|ill[uü]strasyon)\b/i;
const IMAGE_ACTION =
  /\b(env[ií]a(?:r|me)?|manda(?:r|me)?|mu[eé]stra(?:me)?|mostrar(?:me)?|ens[eé][ñn]a(?:r|me)?|compart(?:e|ir)|genera(?:r)?|crea(?:r)?|haz|send|show|share|generate|create|draw|envoie|montre|partage|g[eé]n[eè]re|cr[eé]e|dessine|sende|zeig|teile|generiere|erstelle|zeichne|envia|envie|manda|mostra|partilha|gera|cria|desenha|invia|mandami|mostrami|condividi|genera|crea|disegna|g[oö]nder|g[oö]ster|payla[sş]|[uü]ret|olu[sş]tur|[cç]iz)\b/i;

export function isCharacterImageRequest(text: string): boolean {
  const clean = text.replace(/[¿?¡!.,;:()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
  return IMAGE_NOUN.test(clean) && IMAGE_ACTION.test(clean);
}

export function characterChatTitle(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim();
  return clean.slice(0, 72) || 'Conversación';
}

export function buildCharacterChatImagePrompt(input: {
  style: DecorativeImageStyle;
  name: string;
  visualSeed: string | null;
  appearance: string | null;
  request: string;
  answer: string;
}): string {
  const clean = (value: string | null, limit: number) =>
    (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  return [
    imageStyleTemplate(input.style).prompt,
    `Fictional character: ${clean(input.name, 100)}`,
    clean(input.visualSeed, 320),
    clean(input.appearance, 320),
    `The author explicitly asked the character for this image: ${clean(input.request, 280)}`,
    `The character's accompanying message establishes this mood and intent: ${clean(input.answer, 220)}`,
    'Create the concrete image the fictional character would voluntarily send in this roleplay chat',
    'keep the character visually consistent; one coherent scene; no chat interface',
    'no text, no words, no letters, no numbers, no caption, no signature, no watermark, no border',
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 1400);
}
