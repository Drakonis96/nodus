import type { AppLanguage } from './types';
import { normalizeUiLanguage } from './uiLanguage';

export { normalizeUiLanguage };

export type WorldPromptLocale = AppLanguage;

type LocalizedRecord<K extends string> = Record<WorldPromptLocale, Record<K, string>>;

const ENTRY_KIND_LABELS: LocalizedRecord<string> = {
  es: { article: 'Artículo', character: 'Personaje', place: 'Lugar', group: 'Facción o cultura', scene: 'Escena', map: 'Mapa', conflict: 'Conflicto', rule: 'Regla' },
  en: { article: 'Article', character: 'Character', place: 'Place', group: 'Faction or culture', scene: 'Scene', map: 'Map', conflict: 'Conflict', rule: 'Rule' },
  fr: { article: 'Article', character: 'Personnage', place: 'Lieu', group: 'Faction ou culture', scene: 'Scène', map: 'Carte', conflict: 'Conflit', rule: 'Règle' },
  de: { article: 'Artikel', character: 'Figur', place: 'Ort', group: 'Fraktion oder Kultur', scene: 'Szene', map: 'Karte', conflict: 'Konflikt', rule: 'Regel' },
  pt: { article: 'Artigo', character: 'Personagem', place: 'Lugar', group: 'Facção ou cultura', scene: 'Cena', map: 'Mapa', conflict: 'Conflito', rule: 'Regra' },
  'pt-BR': { article: 'Artigo', character: 'Personagem', place: 'Lugar', group: 'Facção ou cultura', scene: 'Cena', map: 'Mapa', conflict: 'Conflito', rule: 'Regra' },
  it: { article: 'Articolo', character: 'Personaggio', place: 'Luogo', group: 'Fazione o cultura', scene: 'Scena', map: 'Mappa', conflict: 'Conflitto', rule: 'Regola' },
  tr: { article: 'Madde', character: 'Karakter', place: 'Yer', group: 'Fraksiyon veya kültür', scene: 'Sahne', map: 'Harita', conflict: 'Çatışma', rule: 'Kural' },
};

const ARTICLE_CATEGORY_LABELS: LocalizedRecord<string> = {
  es: { magic: 'Sistema de magia', religion: 'Religión', language: 'Lengua', creature: 'Criatura', species: 'Especie', artifact: 'Artefacto', technology: 'Tecnología', concept: 'Concepto', event: 'Suceso', organization: 'Organización', flora: 'Flora', fauna: 'Fauna', custom: 'Costumbre', other: 'Otro' },
  en: { magic: 'Magic system', religion: 'Religion', language: 'Language', creature: 'Creature', species: 'Species', artifact: 'Artifact', technology: 'Technology', concept: 'Concept', event: 'Event', organization: 'Organization', flora: 'Flora', fauna: 'Fauna', custom: 'Custom', other: 'Other' },
  fr: { magic: 'Système de magie', religion: 'Religion', language: 'Langue', creature: 'Créature', species: 'Espèce', artifact: 'Artefact', technology: 'Technologie', concept: 'Concept', event: 'Événement', organization: 'Organisation', flora: 'Flore', fauna: 'Faune', custom: 'Coutume', other: 'Autre' },
  de: { magic: 'Magiesystem', religion: 'Religion', language: 'Sprache', creature: 'Kreatur', species: 'Spezies', artifact: 'Artefakt', technology: 'Technologie', concept: 'Konzept', event: 'Ereignis', organization: 'Organisation', flora: 'Flora', fauna: 'Fauna', custom: 'Brauch', other: 'Sonstiges' },
  pt: { magic: 'Sistema de magia', religion: 'Religião', language: 'Língua', creature: 'Criatura', species: 'Espécie', artifact: 'Artefacto', technology: 'Tecnologia', concept: 'Conceito', event: 'Acontecimento', organization: 'Organização', flora: 'Flora', fauna: 'Fauna', custom: 'Costume', other: 'Outro' },
  'pt-BR': { magic: 'Sistema de magia', religion: 'Religião', language: 'Língua', creature: 'Criatura', species: 'Espécie', artifact: 'Artefato', technology: 'Tecnologia', concept: 'Conceito', event: 'Evento', organization: 'Organização', flora: 'Flora', fauna: 'Fauna', custom: 'Costume', other: 'Outro' },
  it: { magic: 'Sistema magico', religion: 'Religione', language: 'Lingua', creature: 'Creatura', species: 'Specie', artifact: 'Artefatto', technology: 'Tecnologia', concept: 'Concetto', event: 'Evento', organization: 'Organizzazione', flora: 'Flora', fauna: 'Fauna', custom: 'Usanza', other: 'Altro' },
  tr: { magic: 'Büyü sistemi', religion: 'Din', language: 'Dil', creature: 'Yaratık', species: 'Tür', artifact: 'Artefakt', technology: 'Teknoloji', concept: 'Kavram', event: 'Olay', organization: 'Örgüt', flora: 'Flora', fauna: 'Fauna', custom: 'Gelenek', other: 'Diğer' },
};

const FIELD_LABELS: LocalizedRecord<string> = {
  es: { body: 'Cuerpo', summary: 'Resumen', notes: 'Notas', backstory: 'Trasfondo', personality: 'Personalidad', appearance: 'Apariencia', atmosphere: 'Atmósfera', history: 'Historia', description: 'Descripción', biography: 'Biografía', pitch: 'De qué va', stakes: 'Qué se pierde', outcome: 'Cómo acaba', statement: 'La regla', cost: 'Qué cuesta romperla', limits: 'Hasta dónde no llega', text: 'Manuscrito' },
  en: { body: 'Body', summary: 'Summary', notes: 'Notes', backstory: 'Backstory', personality: 'Personality', appearance: 'Appearance', atmosphere: 'Atmosphere', history: 'History', description: 'Description', biography: 'Biography', pitch: 'What it is about', stakes: 'What is at stake', outcome: 'How it ends', statement: 'The rule', cost: 'Cost of breaking it', limits: 'What it does not cover', text: 'Manuscript' },
  fr: { body: 'Corps', summary: 'Résumé', notes: 'Notes', backstory: 'Passé', personality: 'Personnalité', appearance: 'Apparence', atmosphere: 'Atmosphère', history: 'Histoire', description: 'Description', biography: 'Biographie', pitch: 'De quoi s’agit-il', stakes: 'Ce qui est en jeu', outcome: 'Comment cela finit', statement: 'La règle', cost: 'Prix de la transgression', limits: 'Ce qu’elle ne couvre pas', text: 'Manuscrit' },
  de: { body: 'Text', summary: 'Zusammenfassung', notes: 'Notizen', backstory: 'Hintergrund', personality: 'Persönlichkeit', appearance: 'Aussehen', atmosphere: 'Atmosphäre', history: 'Geschichte', description: 'Beschreibung', biography: 'Biografie', pitch: 'Worum es geht', stakes: 'Was auf dem Spiel steht', outcome: 'Wie es endet', statement: 'Das Gesetz', cost: 'Preis des Bruchs', limits: 'Wo es nicht greift', text: 'Manuskript' },
  pt: { body: 'Corpo', summary: 'Resumo', notes: 'Notas', backstory: 'Antecedentes', personality: 'Personalidade', appearance: 'Aparência', atmosphere: 'Atmosfera', history: 'História', description: 'Descrição', biography: 'Biografia', pitch: 'Do que trata', stakes: 'O que se perde', outcome: 'Como termina', statement: 'A regra', cost: 'Preço de a quebrar', limits: 'Onde não se aplica', text: 'Manuscrito' },
  'pt-BR': { body: 'Corpo', summary: 'Resumo', notes: 'Notas', backstory: 'Histórico', personality: 'Personalidade', appearance: 'Aparência', atmosphere: 'Atmosfera', history: 'História', description: 'Descrição', biography: 'Biografia', pitch: 'Do que se trata', stakes: 'O que está em jogo', outcome: 'Como termina', statement: 'A regra', cost: 'Custo de quebrá-la', limits: 'Onde não se aplica', text: 'Manuscrito' },
  it: { body: 'Corpo', summary: 'Sommario', notes: 'Note', backstory: 'Passato', personality: 'Personalità', appearance: 'Aspetto', atmosphere: 'Atmosfera', history: 'Storia', description: 'Descrizione', biography: 'Biografia', pitch: 'Di cosa parla', stakes: 'Cosa si perde', outcome: 'Come finisce', statement: 'La regola', cost: 'Costo della violazione', limits: 'Dove non vale', text: 'Manoscritto' },
  tr: { body: 'Gövde', summary: 'Özet', notes: 'Notlar', backstory: 'Geçmiş', personality: 'Kişilik', appearance: 'Görünüş', atmosphere: 'Atmosfer', history: 'Tarihçe', description: 'Açıklama', biography: 'Biyografi', pitch: 'Konusu', stakes: 'Kaybedilen', outcome: 'Sonu', statement: 'Kural', cost: 'Çiğneme bedeli', limits: 'Nereye kadar geçerli değil', text: 'El yazması' },
};

const HARDNESS_LABELS: LocalizedRecord<string> = {
  es: { physical: 'Imposible', costly: 'Tiene un precio', social: 'Está prohibido' },
  en: { physical: 'Impossible', costly: 'Has a cost', social: 'Forbidden' },
  fr: { physical: 'Impossible', costly: 'A un prix', social: 'Interdit' },
  de: { physical: 'Unmöglich', costly: 'Hat einen Preis', social: 'Verboten' },
  pt: { physical: 'Impossível', costly: 'Tem um preço', social: 'É proibido' },
  'pt-BR': { physical: 'Impossível', costly: 'Tem um custo', social: 'É proibido' },
  it: { physical: 'Impossibile', costly: 'Ha un prezzo', social: 'È vietato' },
  tr: { physical: 'İmkânsız', costly: 'Bedeli var', social: 'Yasak' },
};

const HARDNESS_HINTS: LocalizedRecord<string> = {
  es: { physical: 'Aquí no puede pasar. Si pasa, es un error de continuidad.', costly: 'Puede pasar, pero cuesta algo. Si no se paga, es trampa.', social: 'Se puede, pero está prohibido. Romperlo es una trama.' },
  en: { physical: 'It cannot happen here. If it does, it is a continuity error.', costly: 'It can happen, but it costs something. If it is not paid, it is cheating.', social: 'It is possible, but forbidden. Breaking it is plot.' },
  fr: { physical: 'Cela ne peut pas arriver ici. Si cela arrive, c’est une erreur de continuité.', costly: 'C’est possible, mais cela coûte quelque chose. Sans paiement, c’est une triche.', social: 'C’est possible, mais interdit. Le transgresser fait partie de l’intrigue.' },
  de: { physical: 'Hier kann es nicht geschehen. Geschieht es doch, ist es ein Kontinuitätsfehler.', costly: 'Es kann geschehen, kostet aber etwas. Ohne Preis ist es Schummeln.', social: 'Es ist möglich, aber verboten. Der Bruch wird zur Handlung.' },
  pt: { physical: 'Aqui não pode acontecer. Se acontecer, é um erro de continuidade.', costly: 'Pode acontecer, mas tem um preço. Se não for pago, é batota.', social: 'É possível, mas proibido. Quebrá-lo é enredo.' },
  'pt-BR': { physical: 'Aqui não pode acontecer. Se acontecer, é um erro de continuidade.', costly: 'Pode acontecer, mas tem um custo. Se não for pago, é trapaça.', social: 'É possível, mas proibido. Quebrá-lo é parte da trama.' },
  it: { physical: 'Qui non può accadere. Se accade, è un errore di continuità.', costly: 'Può accadere, ma ha un costo. Se non viene pagato, è un trucco.', social: 'È possibile, ma vietato. Infrangerlo è trama.' },
  tr: { physical: 'Burada gerçekleşemez. Gerçekleşirse süreklilik hatasıdır.', costly: 'Gerçekleşebilir ama bir bedeli vardır. Ödenmezse hiledir.', social: 'Mümkündür ama yasaktır. Çiğnenmesi olay örgüsüdür.' },
};

const SCOPE_LABELS: LocalizedRecord<string> = {
  es: { world: 'Todo el mundo', group: 'Una facción', place: 'Un lugar' },
  en: { world: 'The whole world', group: 'A faction', place: 'A place' },
  fr: { world: 'Tout le monde', group: 'Une faction', place: 'Un lieu' },
  de: { world: 'Die ganze Welt', group: 'Eine Fraktion', place: 'Ein Ort' },
  pt: { world: 'Todo o mundo', group: 'Uma facção', place: 'Um lugar' },
  'pt-BR': { world: 'Todo o mundo', group: 'Uma facção', place: 'Um lugar' },
  it: { world: 'Tutto il mondo', group: 'Una fazione', place: 'Un luogo' },
  tr: { world: 'Tüm dünya', group: 'Bir fraksiyon', place: 'Bir yer' },
};

const MARK_LABELS: LocalizedRecord<string> = {
  es: { obeys: 'Se cumple', bends: 'Se dobla', breaks: 'Se rompe', establishes: 'Se establece', raise: 'Sube', turn: 'Gira', ease: 'Baja', resolve: 'Se cierra', step: 'Avanza' },
  en: { obeys: 'Obeys', bends: 'Bends', breaks: 'Breaks', establishes: 'Establishes', raise: 'Rises', turn: 'Turns', ease: 'Eases', resolve: 'Resolves', step: 'Advances' },
  fr: { obeys: 'Est respectée', bends: 'Plie', breaks: 'Est enfreinte', establishes: 'Est établie', raise: 'Monte', turn: 'Tourne', ease: 'Baisse', resolve: 'Se clôt', step: 'Avance' },
  de: { obeys: 'Wird befolgt', bends: 'Wird gebeugt', breaks: 'Wird gebrochen', establishes: 'Wird festgelegt', raise: 'Steigt', turn: 'Dreht sich', ease: 'Sinkt', resolve: 'Wird abgeschlossen', step: 'Geht weiter' },
  pt: { obeys: 'É cumprida', bends: 'Dobra-se', breaks: 'É quebrada', establishes: 'É estabelecida', raise: 'Sobe', turn: 'Muda', ease: 'Desce', resolve: 'Fecha-se', step: 'Avança' },
  'pt-BR': { obeys: 'É cumprida', bends: 'Dobra', breaks: 'É quebrada', establishes: 'É estabelecida', raise: 'Sobe', turn: 'Vira', ease: 'Desce', resolve: 'Se encerra', step: 'Avança' },
  it: { obeys: 'È rispettata', bends: 'Si piega', breaks: 'Si spezza', establishes: 'Si stabilisce', raise: 'Sale', turn: 'Svolta', ease: 'Scende', resolve: 'Si chiude', step: 'Avanza' },
  tr: { obeys: 'Uyulur', bends: 'Bükülür', breaks: 'Çiğnenir', establishes: 'Belirlenir', raise: 'Yükselir', turn: 'Döner', ease: 'Azalır', resolve: 'Çözülür', step: 'İlerler' },
};

export function worldEntryKindLabel(kind: string, language: unknown): string {
  const locale = normalizeUiLanguage(language);
  return ENTRY_KIND_LABELS[locale][kind] ?? kind;
}

export function worldArticleCategoryLabel(category: string, language: unknown): string {
  const locale = normalizeUiLanguage(language);
  return ARTICLE_CATEGORY_LABELS[locale][category] ?? category;
}

export function worldFieldLabel(field: string, language: unknown): string {
  const locale = normalizeUiLanguage(language);
  return FIELD_LABELS[locale][field] ?? field;
}

export function worldRuleHardnessLabel(hardness: string, language: unknown): string {
  const locale = normalizeUiLanguage(language);
  return HARDNESS_LABELS[locale][hardness] ?? hardness;
}

export function worldRuleHardnessHint(hardness: string, language: unknown): string {
  const locale = normalizeUiLanguage(language);
  return HARDNESS_HINTS[locale][hardness] ?? hardness;
}

export function worldRuleScopeLabel(scope: string, language: unknown): string {
  const locale = normalizeUiLanguage(language);
  return SCOPE_LABELS[locale][scope] ?? scope;
}

export function worldBeatMarkLabel(mark: string, language: unknown): string {
  const locale = normalizeUiLanguage(language);
  return MARK_LABELS[locale][mark] ?? mark;
}

const RESPONSE_LANGUAGE_INSTRUCTION: Record<AppLanguage, string> = {
  es: 'Responde íntegramente en español.',
  en: 'Respond entirely in English.',
  fr: 'Réponds intégralement en français.',
  de: 'Antworte vollständig auf Deutsch.',
  pt: 'Responde integralmente em português europeu.',
  'pt-BR': 'Responda integralmente em português do Brasil.',
  it: 'Rispondi interamente in italiano.',
  tr: 'Yanıtın tamamını Türkçe ver.',
};

/**
 * Worldbuilding prompts carry author prose and invented proper names verbatim, but every
 * generated explanation or draft must follow the prompt language selected for the
 * vault. Keeping this instruction in the target language also works with small local
 * models that underweight a final English-only locale code.
 */
export function withWorldPromptLanguage(system: string, language: unknown): string {
  const locale = normalizeUiLanguage(language);
  return `${system}\n\n${RESPONSE_LANGUAGE_INSTRUCTION[locale]}`;
}
