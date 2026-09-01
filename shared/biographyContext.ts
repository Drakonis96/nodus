/**
 * Assemble the evidence a person's AI biography is written from — kinship, life
 * events, linked documents and cited evidence — into a compact, source-faithful
 * context. Pure so it is unit-tested without the DB; the electron side gathers the
 * data and runs the model. The biography is factual and only as rich as the sources.
 */

import type { PromptLanguage } from './types';

const EVENT_LABEL: Record<string, string> = {
  birth: 'nacimiento',
  baptism: 'bautismo',
  marriage: 'matrimonio',
  death: 'defunción',
  burial: 'entierro',
  census: 'censo',
  residence: 'residencia',
  migration: 'migración',
  occupation: 'ocupación',
  other: 'evento',
};

export interface BiographySources {
  name: string;
  sex: string;
  birthDate: string | null;
  deathDate: string | null;
  parents: string[];
  spouses: string[];
  children: string[];
  siblings: string[];
  events: { type: string; date: string | null; place: string | null }[];
  documents: { title: string; docType: string | null; text: string | null }[];
  evidence: { quote: string | null; location: string | null }[];
}

export const BIOGRAPHY_SYSTEM = `Eres un genealogista que redacta una biografía breve y FACTUAL de una persona basándote ÚNICAMENTE en la evidencia proporcionada (parentescos, eventos, documentos y citas). Reglas estrictas:
- No inventes datos, fechas, lugares ni parentescos que no consten en la evidencia.
- Escribe en prosa continua, en pasado, de 120 a 220 palabras aproximadamente.
- Respeta las fechas tal como se dan (incluidas las inciertas como "hacia 1850"); no las normalices.
- Si la evidencia es escasa, dilo con naturalidad en lugar de rellenar con conjeturas.
- No incluyas encabezados, viñetas ni notas: solo el texto de la biografía.`;

interface BiographyPromptCopy {
  system: string;
  person: string; male: string; female: string; birth: string; death: string;
  parents: string; spouses: string; children: string; siblings: string; events: string;
  documents: string; evidenceQuotes: string; inPlace: string; write: string;
  eventLabels: Record<string, string>;
}

const eventLabels = (birth: string, baptism: string, marriage: string, death: string, burial: string, census: string, residence: string, migration: string, occupation: string, other: string) => ({ birth, baptism, marriage, death, burial, census, residence, migration, occupation, other });

const BIOGRAPHY_PROMPT_COPY: Record<PromptLanguage, BiographyPromptCopy> = {
  es: { system: BIOGRAPHY_SYSTEM, person: 'Persona', male: 'hombre', female: 'mujer', birth: 'Nacimiento', death: 'Defunción', parents: 'Padres', spouses: 'Cónyuges', children: 'Hijos', siblings: 'Hermanos', events: 'Eventos', documents: 'Documentos vinculados', evidenceQuotes: 'Citas de evidencia', inPlace: 'en', write: 'Redacta la biografía factual a partir de lo anterior.', eventLabels: EVENT_LABEL },
  en: { system: 'You are a genealogist writing a brief, FACTUAL biography of one person based ONLY on the supplied evidence (kinship, events, documents, and quotations). Strict rules:\n- Do not invent data, dates, places, or kinship absent from the evidence.\n- Write continuous prose in the past tense, approximately 120 to 220 words.\n- Preserve dates exactly as supplied, including uncertain forms such as “circa 1850”; do not normalize them.\n- If evidence is sparse, say so naturally instead of filling gaps with guesses.\n- Do not include headings, bullets, or notes: return only the biography text.', person: 'Person', male: 'man', female: 'woman', birth: 'Birth', death: 'Death', parents: 'Parents', spouses: 'Spouses', children: 'Children', siblings: 'Siblings', events: 'Events', documents: 'Linked documents', evidenceQuotes: 'Evidence quotations', inPlace: 'in', write: 'Write the factual biography from the information above.', eventLabels: eventLabels('birth', 'baptism', 'marriage', 'death', 'burial', 'census', 'residence', 'migration', 'occupation', 'event') },
  fr: { system: 'Vous êtes généalogiste et rédigez une biographie brève et FACTUELLE d’une personne en vous fondant UNIQUEMENT sur les preuves fournies (parentés, événements, documents et citations). Règles strictes :\n- N’inventez aucune donnée, date, lieu ou parenté absente des preuves.\n- Rédigez une prose continue au passé, d’environ 120 à 220 mots.\n- Respectez les dates exactement comme elles sont données, y compris les formes incertaines telles que « vers 1850 » ; ne les normalisez pas.\n- Si les preuves sont rares, dites-le naturellement au lieu de combler les lacunes par des conjectures.\n- N’incluez ni titres, ni puces, ni notes : retournez uniquement le texte de la biographie.', person: 'Personne', male: 'homme', female: 'femme', birth: 'Naissance', death: 'Décès', parents: 'Parents', spouses: 'Conjoints', children: 'Enfants', siblings: 'Frères et sœurs', events: 'Événements', documents: 'Documents liés', evidenceQuotes: 'Citations de preuve', inPlace: 'à', write: 'Rédigez la biographie factuelle à partir des informations ci-dessus.', eventLabels: eventLabels('naissance', 'baptême', 'mariage', 'décès', 'inhumation', 'recensement', 'résidence', 'migration', 'profession', 'événement') },
  de: { system: 'Du bist Genealoge und verfasst eine kurze, SACHLICHE Biografie einer Person AUSSCHLIESSLICH anhand der bereitgestellten Belege (Verwandtschaft, Ereignisse, Dokumente und Zitate). Strenge Regeln:\n- Erfinde keine Daten, Datumsangaben, Orte oder Verwandtschaft, die nicht belegt sind.\n- Schreibe fortlaufende Prosa in der Vergangenheit mit ungefähr 120 bis 220 Wörtern.\n- Bewahre Datumsangaben exakt wie geliefert, einschließlich unsicherer Formen wie „um 1850“; normalisiere sie nicht.\n- Bei dünner Beleglage sage das natürlich, statt Lücken durch Vermutungen zu füllen.\n- Verwende keine Überschriften, Aufzählungen oder Anmerkungen: gib nur den Biografietext zurück.', person: 'Person', male: 'Mann', female: 'Frau', birth: 'Geburt', death: 'Tod', parents: 'Eltern', spouses: 'Ehepartner', children: 'Kinder', siblings: 'Geschwister', events: 'Ereignisse', documents: 'Verknüpfte Dokumente', evidenceQuotes: 'Belegzitate', inPlace: 'in', write: 'Verfasse anhand der obigen Angaben die sachliche Biografie.', eventLabels: eventLabels('Geburt', 'Taufe', 'Eheschließung', 'Tod', 'Bestattung', 'Volkszählung', 'Wohnsitz', 'Migration', 'Beruf', 'Ereignis') },
  pt: { system: 'És genealogista e rediges uma biografia breve e FACTUAL de uma pessoa com base APENAS nas evidências fornecidas (parentescos, acontecimentos, documentos e citações). Regras estritas:\n- Não inventes dados, datas, lugares ou parentescos que não constem das evidências.\n- Escreve prosa contínua no passado, com aproximadamente 120 a 220 palavras.\n- Conserva as datas exatamente como são fornecidas, incluindo formas incertas como «cerca de 1850»; não as normalizes.\n- Se as evidências forem escassas, di-lo naturalmente em vez de preencher lacunas com conjeturas.\n- Não incluas títulos, listas ou notas: devolve apenas o texto da biografia.', person: 'Pessoa', male: 'homem', female: 'mulher', birth: 'Nascimento', death: 'Falecimento', parents: 'Pais', spouses: 'Cônjuges', children: 'Filhos', siblings: 'Irmãos', events: 'Acontecimentos', documents: 'Documentos associados', evidenceQuotes: 'Citações de evidência', inPlace: 'em', write: 'Redige a biografia factual a partir da informação anterior.', eventLabels: eventLabels('nascimento', 'batismo', 'casamento', 'falecimento', 'sepultamento', 'censo', 'residência', 'migração', 'profissão', 'acontecimento') },
  'pt-BR': { system: 'Você é genealogista e escreve uma biografia breve e FACTUAL de uma pessoa com base SOMENTE nas evidências fornecidas (parentescos, eventos, documentos e citações). Regras estritas:\n- Não invente dados, datas, lugares ou parentescos que não constem das evidências.\n- Escreva prosa contínua no passado, com aproximadamente 120 a 220 palavras.\n- Preserve as datas exatamente como fornecidas, inclusive formas incertas como “por volta de 1850”; não as normalize.\n- Se as evidências forem escassas, diga isso naturalmente em vez de preencher lacunas com suposições.\n- Não inclua títulos, listas ou notas: retorne apenas o texto da biografia.', person: 'Pessoa', male: 'homem', female: 'mulher', birth: 'Nascimento', death: 'Falecimento', parents: 'Pais', spouses: 'Cônjuges', children: 'Filhos', siblings: 'Irmãos', events: 'Eventos', documents: 'Documentos vinculados', evidenceQuotes: 'Citações de evidência', inPlace: 'em', write: 'Escreva a biografia factual a partir das informações acima.', eventLabels: eventLabels('nascimento', 'batismo', 'casamento', 'falecimento', 'sepultamento', 'censo', 'residência', 'migração', 'ocupação', 'evento') },
  it: { system: 'Sei un genealogista e redigi una biografia breve e FATTUALE di una persona basandoti ESCLUSIVAMENTE sulle prove fornite (parentele, eventi, documenti e citazioni). Regole rigorose:\n- Non inventare dati, date, luoghi o parentele assenti dalle prove.\n- Scrivi prosa continua al passato, di circa 120-220 parole.\n- Conserva le date esattamente come fornite, comprese le forme incerte come «circa 1850»; non normalizzarle.\n- Se le prove sono scarse, dichiaralo con naturalezza invece di colmare le lacune con congetture.\n- Non includere titoli, elenchi o note: restituisci solo il testo della biografia.', person: 'Persona', male: 'uomo', female: 'donna', birth: 'Nascita', death: 'Morte', parents: 'Genitori', spouses: 'Coniugi', children: 'Figli', siblings: 'Fratelli e sorelle', events: 'Eventi', documents: 'Documenti collegati', evidenceQuotes: 'Citazioni di prova', inPlace: 'a', write: 'Scrivi la biografia fattuale a partire dalle informazioni precedenti.', eventLabels: eventLabels('nascita', 'battesimo', 'matrimonio', 'morte', 'sepoltura', 'censimento', 'residenza', 'migrazione', 'occupazione', 'evento') },
  tr: { system: 'Yalnızca sağlanan kanıtlara (akrabalıklar, olaylar, belgeler ve alıntılar) dayanarak bir kişinin kısa ve OLGUSAL biyografisini yazan bir soybilimcisin. Kesin kurallar:\n- Kanıtlarda bulunmayan veri, tarih, yer veya akrabalık uydurma.\n- Geçmiş zamanda, yaklaşık 120-220 kelimelik kesintisiz düzyazı yaz.\n- “1850 civarı” gibi belirsiz biçimler dâhil tarihleri sağlandığı biçimde koru; standartlaştırma.\n- Kanıt azsa boşlukları varsayımla doldurmak yerine bunu doğal biçimde söyle.\n- Başlık, madde işareti veya not ekleme: yalnızca biyografi metnini döndür.', person: 'Kişi', male: 'erkek', female: 'kadın', birth: 'Doğum', death: 'Ölüm', parents: 'Ebeveynler', spouses: 'Eşler', children: 'Çocuklar', siblings: 'Kardeşler', events: 'Olaylar', documents: 'Bağlı belgeler', evidenceQuotes: 'Kanıt alıntıları', inPlace: 'yer', write: 'Yukarıdaki bilgilerden olgusal biyografiyi yaz.', eventLabels: eventLabels('doğum', 'vaftiz', 'evlilik', 'ölüm', 'defin', 'nüfus sayımı', 'ikamet', 'göç', 'meslek', 'olay') },
};

export function biographySystemPrompt(language: PromptLanguage = 'es'): string {
  return BIOGRAPHY_PROMPT_COPY[language]?.system ?? BIOGRAPHY_SYSTEM;
}

function list(label: string, items: string[]): string {
  const clean = items.map((x) => x.trim()).filter(Boolean);
  return clean.length ? `${label}: ${clean.join(', ')}.` : '';
}

/** Build the user message: a structured, deduplicated digest of the person's sources. */
export function composeBiographyContext(s: BiographySources, language: PromptLanguage = 'es'): string {
  const copy = BIOGRAPHY_PROMPT_COPY[language] ?? BIOGRAPHY_PROMPT_COPY.es;
  const lines: string[] = [];
  lines.push(`${copy.person}: ${s.name}${s.sex && s.sex !== 'unknown' ? ` (${s.sex === 'male' ? copy.male : copy.female})` : ''}.`);
  if (s.birthDate) lines.push(`${copy.birth}: ${s.birthDate}.`);
  if (s.deathDate) lines.push(`${copy.death}: ${s.deathDate}.`);
  const kin = [list(copy.parents, s.parents), list(copy.spouses, s.spouses), list(copy.children, s.children), list(copy.siblings, s.siblings)].filter(Boolean);
  if (kin.length) lines.push(kin.join(' '));

  if (s.events.length) {
    lines.push(`${copy.events}:`);
    for (const e of s.events.slice(0, 40)) {
      const parts = [copy.eventLabels[e.type] ?? e.type];
      if (e.date) parts.push(e.date);
      if (e.place) parts.push(`${copy.inPlace} ${e.place}`);
      lines.push(`- ${parts.join(', ')}.`);
    }
  }

  const docs = s.documents.filter((d) => d.title || d.text);
  if (docs.length) {
    lines.push(`${copy.documents}:`);
    for (const d of docs.slice(0, 12)) {
      const snippet = (d.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      lines.push(`- ${d.title}${d.docType ? ` [${d.docType}]` : ''}${snippet ? `: ${snippet}` : ''}`);
    }
  }

  const quotes = s.evidence.filter((e) => e.quote);
  if (quotes.length) {
    lines.push(`${copy.evidenceQuotes}:`);
    for (const q of quotes.slice(0, 12)) {
      lines.push(`- "${(q.quote ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)}"${q.location ? ` (${q.location})` : ''}`);
    }
  }

  lines.push(`\n${copy.write}`);
  return lines.join('\n');
}

/** True when there is enough to write anything at all. */
export function hasBiographyEvidence(s: BiographySources): boolean {
  return Boolean(
    s.birthDate ||
      s.deathDate ||
      s.events.length ||
      s.documents.some((d) => d.title || d.text) ||
      s.evidence.some((e) => e.quote) ||
      s.parents.length ||
      s.spouses.length ||
      s.children.length
  );
}
