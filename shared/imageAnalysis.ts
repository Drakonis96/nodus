import type { PromptLanguage } from './types';

/**
 * Vision analysis of archive images: a consistent, indexable visual description plus
 * a verbatim OCR transcription, so photographed records and pages become searchable.
 * Pure and dependency-free — the prompt, the output guard, and the per-provider
 * multimodal message content builders live here; the electron side supplies the
 * model call.
 *
 * Two provider message shapes are supported: the OpenAI-compatible `image_url`
 * content part (openai, openrouter, gemini, deepseek, xiaomi, ollama, lmstudio) and
 * the Anthropic native `image` block. Both take a base64 data payload.
 */

/** MIME types every supported vision API accepts (OpenAI + Anthropic intersection). */
export const VISION_SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function isVisionMime(mime: string | null | undefined): boolean {
  return VISION_SUPPORTED_MIME.has((mime ?? '').toLowerCase());
}

/**
 * System prompt. The tight word range keeps descriptions consistent in length; the
 * strict JSON shape separates the searchable description from the literal OCR. The
 * output-language directive is appended by the caller, so descriptions follow the
 * user's chosen language.
 */
export const IMAGE_ANALYSIS_SYSTEM = `Eres un archivero que describe imágenes de documentos y fotografías (históricas o familiares) para hacerlas buscables en un archivo de evidencias. Analiza la imagen y devuelve SOLO un objeto JSON con exactamente estos dos campos:

{
  "description": "…",
  "text": "…"
}

- "description": una descripción OBJETIVA y CONSISTENTE de la imagen, en un único párrafo de entre 60 y 100 palabras. Indica qué tipo de material es (fotografía, partida, censo, carta, mapa, grabado…), qué se observa (personas y su disposición, lugar, objetos, vestimenta, época aparente, estado de conservación) y cualquier rasgo visual útil para identificarla o encontrarla. Describe SOLO lo observable; no infieras identidades, nombres ni fechas que no se vean. No empieces con "La imagen muestra" ni añadas preámbulos.
- "text": la transcripción LITERAL de todo el texto legible en la imagen (manuscrito o impreso), tal como aparece, conservando los saltos de línea. Si no hay texto legible, devuelve una cadena vacía "".

No añadas ningún otro campo, comentario ni texto fuera del objeto JSON.`;

export const IMAGE_ANALYSIS_USER = 'Analiza esta imagen y devuelve el JSON con "description" y "text".';

const IMAGE_ANALYSIS_PROMPTS: Record<PromptLanguage, { system: string; user: string }> = {
  es: { system: IMAGE_ANALYSIS_SYSTEM, user: IMAGE_ANALYSIS_USER },
  en: {
    system: `You are an archivist who describes images of documents and historical or family photographs so they can be searched in an evidence archive. Analyze the image and return ONLY one JSON object with exactly these two fields:

{
  "description": "…",
  "text": "…"
}

- "description": an OBJECTIVE and CONSISTENT description of the image in a single paragraph of 60 to 100 words. State the material type (photograph, certificate, census, letter, map, engraving…), what is visible (people and their arrangement, place, objects, clothing, apparent period, condition), and any visual feature useful for identifying or finding it. Describe ONLY what is observable; do not infer identities, names, or dates that are not visible. Do not begin with "The image shows" or add a preamble.
- "text": a VERBATIM transcription of all legible text in the image, handwritten or printed, exactly as it appears and preserving line breaks. If no text is legible, return an empty string "".

Do not add any other field, comment, or text outside the JSON object.`,
    user: 'Analyze this image and return the JSON with "description" and "text".',
  },
  fr: {
    system: `Vous êtes archiviste et décrivez des images de documents ainsi que des photographies historiques ou familiales afin de les rendre consultables dans une archive de preuves. Analysez l’image et retournez UNIQUEMENT un objet JSON comportant exactement ces deux champs :

{
  "description": "…",
  "text": "…"
}

- "description" : une description OBJECTIVE et COHÉRENTE de l’image, en un seul paragraphe de 60 à 100 mots. Indiquez le type de document (photographie, acte, recensement, lettre, carte, gravure…), ce qui est visible (personnes et leur disposition, lieu, objets, vêtements, époque apparente, état de conservation) et tout trait visuel utile pour l’identifier ou la retrouver. Décrivez UNIQUEMENT ce qui est observable ; n’inférez ni identités, ni noms, ni dates invisibles. Ne commencez pas par « L’image montre » et n’ajoutez aucun préambule.
- "text" : la transcription LITTÉRALE de tout le texte lisible dans l’image, manuscrit ou imprimé, tel qu’il apparaît et en conservant les sauts de ligne. Si aucun texte n’est lisible, retournez une chaîne vide "".

N’ajoutez aucun autre champ, commentaire ou texte hors de l’objet JSON.`,
    user: 'Analysez cette image et retournez le JSON avec "description" et "text".',
  },
  de: {
    system: `Du bist Archivar und beschreibst Bilder von Dokumenten sowie historische oder familiäre Fotografien, damit sie in einem Belegarchiv durchsuchbar werden. Analysiere das Bild und gib NUR ein JSON-Objekt mit genau diesen beiden Feldern zurück:

{
  "description": "…",
  "text": "…"
}

- "description": eine OBJEKTIVE und KONSISTENTE Bildbeschreibung in einem einzigen Absatz mit 60 bis 100 Wörtern. Nenne die Materialart (Fotografie, Urkunde, Volkszählung, Brief, Karte, Stich …), das Sichtbare (Personen und ihre Anordnung, Ort, Gegenstände, Kleidung, mutmaßliche Zeit, Erhaltungszustand) und jedes visuelle Merkmal, das beim Identifizieren oder Auffinden hilft. Beschreibe NUR Beobachtbares; leite keine nicht sichtbaren Identitäten, Namen oder Daten ab. Beginne nicht mit „Das Bild zeigt“ und füge keine Einleitung hinzu.
- "text": eine WÖRTLICHE Transkription sämtlichen lesbaren handschriftlichen oder gedruckten Textes im Bild, genau wie er erscheint und mit erhaltenen Zeilenumbrüchen. Ist kein Text lesbar, gib eine leere Zeichenkette "" zurück.

Füge kein anderes Feld, keinen Kommentar und keinen Text außerhalb des JSON-Objekts hinzu.`,
    user: 'Analysiere dieses Bild und gib das JSON mit "description" und "text" zurück.',
  },
  pt: {
    system: `És arquivista e descreves imagens de documentos e fotografias históricas ou familiares para que possam ser pesquisadas num arquivo de evidências. Analisa a imagem e devolve APENAS um objeto JSON com exatamente estes dois campos:

{
  "description": "…",
  "text": "…"
}

- "description": uma descrição OBJETIVA e CONSISTENTE da imagem, num único parágrafo de 60 a 100 palavras. Indica o tipo de material (fotografia, assento, recenseamento, carta, mapa, gravura…), o que é visível (pessoas e a sua disposição, lugar, objetos, vestuário, época aparente, estado de conservação) e qualquer traço visual útil para a identificar ou encontrar. Descreve APENAS o observável; não infiras identidades, nomes ou datas que não estejam visíveis. Não comeces por «A imagem mostra» nem acrescentes preâmbulos.
- "text": a transcrição LITERAL de todo o texto legível na imagem, manuscrito ou impresso, tal como aparece e conservando as quebras de linha. Se não houver texto legível, devolve uma cadeia vazia "".

Não acrescentes nenhum outro campo, comentário ou texto fora do objeto JSON.`,
    user: 'Analisa esta imagem e devolve o JSON com "description" e "text".',
  },
  'pt-BR': {
    system: `Você é um arquivista que descreve imagens de documentos e fotografias históricas ou familiares para torná-las pesquisáveis em um arquivo de evidências. Analise a imagem e retorne SOMENTE um objeto JSON com exatamente estes dois campos:

{
  "description": "…",
  "text": "…"
}

- "description": uma descrição OBJETIVA e CONSISTENTE da imagem, em um único parágrafo de 60 a 100 palavras. Indique o tipo de material (fotografia, certidão, censo, carta, mapa, gravura…), o que está visível (pessoas e sua disposição, lugar, objetos, vestuário, época aparente, estado de conservação) e qualquer traço visual útil para identificá-la ou encontrá-la. Descreva SOMENTE o observável; não infira identidades, nomes ou datas que não estejam visíveis. Não comece com “A imagem mostra” nem acrescente preâmbulos.
- "text": a transcrição LITERAL de todo o texto legível na imagem, manuscrito ou impresso, exatamente como aparece e preservando as quebras de linha. Se não houver texto legível, retorne uma string vazia "".

Não acrescente nenhum outro campo, comentário ou texto fora do objeto JSON.`,
    user: 'Analise esta imagem e retorne o JSON com "description" e "text".',
  },
  it: {
    system: `Sei un archivista che descrive immagini di documenti e fotografie storiche o familiari per renderle ricercabili in un archivio di prove. Analizza l’immagine e restituisci SOLO un oggetto JSON con esattamente questi due campi:

{
  "description": "…",
  "text": "…"
}

- "description": una descrizione OBIETTIVA e COERENTE dell’immagine, in un unico paragrafo di 60-100 parole. Indica il tipo di materiale (fotografia, certificato, censimento, lettera, mappa, incisione…), ciò che è visibile (persone e disposizione, luogo, oggetti, abbigliamento, epoca apparente, stato di conservazione) e qualsiasi tratto visivo utile per identificarla o ritrovarla. Descrivi SOLO ciò che è osservabile; non dedurre identità, nomi o date non visibili. Non iniziare con «L’immagine mostra» e non aggiungere preamboli.
- "text": la trascrizione LETTERALE di tutto il testo leggibile nell’immagine, manoscritto o stampato, così come appare e conservando le interruzioni di riga. Se non c’è testo leggibile, restituisci una stringa vuota "".

Non aggiungere altri campi, commenti o testo fuori dall’oggetto JSON.`,
    user: 'Analizza questa immagine e restituisci il JSON con "description" e "text".',
  },
  tr: {
    system: `Kanıt arşivinde aranabilmeleri için belge görüntülerini ve tarihî ya da aile fotoğraflarını betimleyen bir arşivcisin. Görseli analiz et ve tam olarak şu iki alanı içeren TEK bir JSON nesnesi döndür:

{
  "description": "…",
  "text": "…"
}

- "description": görselin 60-100 kelimelik tek paragraftan oluşan NESNEL ve TUTARLI betimi. Malzeme türünü (fotoğraf, kayıt, nüfus sayımı, mektup, harita, gravür…), görünür unsurları (kişiler ve yerleşimleri, mekân, nesneler, giysiler, görünür dönem, korunma durumu) ve görseli tanımaya ya da bulmaya yarayan özellikleri belirt. YALNIZCA gözlemlenebilir olanı betimle; görünmeyen kimlik, ad veya tarih çıkarımı yapma. “Görselde” diye başlama ve giriş ekleme.
- "text": görseldeki okunabilir el yazısı veya basılı metnin, satır sonları korunarak göründüğü biçimde BİREBİR transkripsiyonu. Okunabilir metin yoksa boş dize "" döndür.

JSON nesnesi dışında başka alan, yorum veya metin ekleme.`,
    user: 'Bu görseli analiz et ve "description" ile "text" alanlarını içeren JSON’u döndür.',
  },
};

export function imageAnalysisPrompt(language: PromptLanguage = 'es'): { system: string; user: string } {
  return IMAGE_ANALYSIS_PROMPTS[language] ?? IMAGE_ANALYSIS_PROMPTS.es;
}

export interface ImageAnalysis {
  description: string;
  text: string;
}

/** Lenient guard: an object; description/text coerced to strings by normalizeAnalysis. */
export function isImageAnalysisShape(v: unknown): v is { description?: unknown; text?: unknown } {
  return !!v && typeof v === 'object';
}

export function normalizeAnalysis(v: { description?: unknown; text?: unknown }): ImageAnalysis {
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  return { description: str(v.description), text: str(v.text) };
}

export interface VisionImagePart {
  base64: string;
  mediaType: string;
}

/** OpenAI-compatible user content: a text part + one image_url part per image. */
export function openAiVisionContent(text: string, images: VisionImagePart[]): unknown[] {
  return [
    { type: 'text', text },
    ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}` } })),
  ];
}

/** Anthropic native user content: a text block + one image block per image. */
export function anthropicVisionContent(text: string, images: VisionImagePart[]): unknown[] {
  return [
    { type: 'text', text },
    ...images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    })),
  ];
}
