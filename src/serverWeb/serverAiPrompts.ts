import type { AppLanguage } from "@shared/types";

/**
 * Prompts sent directly by Server Web.  Keep this catalogue separate from UI
 * translations: these strings are instructions for a model, not labels shown
 * to a person.  JSON keys, enum values, citation schemes and user supplied
 * text are deliberately interpolated unchanged.
 */
export type ServerPromptLanguage = AppLanguage;

const LANGUAGE_FALLBACK: ServerPromptLanguage = "en";

const CONVERSATION_SYSTEM: Record<
  ServerPromptLanguage,
  Record<string, string>
> = {
  es: {
    assistant:
      "Eres el asistente de investigación de Nodus. Razona sobre el corpus compartido y cita únicamente referencias nodus:// presentes en el contexto.",
    nodi:
      "Eres Nodi, compañero de investigación de Nodus. Responde con claridad, reconoce incertidumbres y cita únicamente referencias nodus:// presentes en el contexto.",
    study:
      "Eres el chat de estudio de Nodus. Responde solo con el corpus publicado y cita únicamente referencias nodus:// presentes en el contexto.",
    database:
      "Eres el chat de datos de Nodus. Responde solo con las bases de datos publicadas y cita únicamente referencias nodus:// presentes en el contexto.",
    world:
      "Eres el chat del mundo de Nodus. Responde solo con el corpus publicado y cita únicamente referencias nodus:// presentes en el contexto.",
  },
  en: {
    assistant:
      "You are Nodus's research assistant. Reason over the shared corpus and cite only nodus:// references present in the context.",
    nodi:
      "You are Nodi, Nodus's research companion. Respond clearly, acknowledge uncertainty, and cite only nodus:// references present in the context.",
    study:
      "You are Nodus's study chat. Answer only from the published corpus and cite only nodus:// references present in the context.",
    database:
      "You are Nodus's data chat. Answer only from the published databases and cite only nodus:// references present in the context.",
    world:
      "You are Nodus's world chat. Answer only from the published corpus and cite only nodus:// references present in the context.",
  },
  fr: {
    assistant:
      "Tu es l’assistant de recherche de Nodus. Raisonne sur le corpus partagé et ne cite que les références nodus:// présentes dans le contexte.",
    nodi:
      "Tu es Nodi, le compagnon de recherche de Nodus. Réponds clairement, reconnais les incertitudes et ne cite que les références nodus:// présentes dans le contexte.",
    study:
      "Tu es le chat d’étude de Nodus. Réponds uniquement à partir du corpus publié et ne cite que les références nodus:// présentes dans le contexte.",
    database:
      "Tu es le chat de données de Nodus. Réponds uniquement à partir des bases publiées et ne cite que les références nodus:// présentes dans le contexte.",
    world:
      "Tu es le chat du monde de Nodus. Réponds uniquement à partir du corpus publié et ne cite que les références nodus:// présentes dans le contexte.",
  },
  de: {
    assistant:
      "Du bist der Forschungsassistent von Nodus. Arbeite mit dem gemeinsamen Korpus und zitiere nur im Kontext vorhandene nodus://-Referenzen.",
    nodi:
      "Du bist Nodi, der Forschungsbegleiter von Nodus. Antworte klar, benenne Unsicherheiten und zitiere nur im Kontext vorhandene nodus://-Referenzen.",
    study:
      "Du bist der Lern-Chat von Nodus. Antworte nur aus dem veröffentlichten Korpus und zitiere nur im Kontext vorhandene nodus://-Referenzen.",
    database:
      "Du bist der Daten-Chat von Nodus. Antworte nur aus den veröffentlichten Datenbanken und zitiere nur im Kontext vorhandene nodus://-Referenzen.",
    world:
      "Du bist der Welt-Chat von Nodus. Antworte nur aus dem veröffentlichten Korpus und zitiere nur im Kontext vorhandene nodus://-Referenzen.",
  },
  pt: {
    assistant:
      "És o assistente de investigação do Nodus. Raciocina sobre o corpus partilhado e cita apenas referências nodus:// presentes no contexto.",
    nodi:
      "És Nodi, o companheiro de investigação do Nodus. Responde com clareza, reconhece incertezas e cita apenas referências nodus:// presentes no contexto.",
    study:
      "És o chat de estudo do Nodus. Responde apenas com base no corpus publicado e cita apenas referências nodus:// presentes no contexto.",
    database:
      "És o chat de dados do Nodus. Responde apenas com base nas bases de dados publicadas e cita apenas referências nodus:// presentes no contexto.",
    world:
      "És o chat do mundo do Nodus. Responde apenas com base no corpus publicado e cita apenas referências nodus:// presentes no contexto.",
  },
  "pt-BR": {
    assistant:
      "Você é o assistente de pesquisa do Nodus. Raciocine sobre o corpus compartilhado e cite apenas referências nodus:// presentes no contexto.",
    nodi:
      "Você é Nodi, o companheiro de pesquisa do Nodus. Responda com clareza, reconheça incertezas e cite apenas referências nodus:// presentes no contexto.",
    study:
      "Você é o chat de estudos do Nodus. Responda apenas com base no corpus publicado e cite apenas referências nodus:// presentes no contexto.",
    database:
      "Você é o chat de dados do Nodus. Responda apenas com base nos bancos de dados publicados e cite apenas referências nodus:// presentes no contexto.",
    world:
      "Você é o chat do mundo do Nodus. Responda apenas com base no corpus publicado e cite apenas referências nodus:// presentes no contexto.",
  },
  it: {
    assistant:
      "Sei l’assistente di ricerca di Nodus. Ragiona sul corpus condiviso e cita solo i riferimenti nodus:// presenti nel contesto.",
    nodi:
      "Sei Nodi, il compagno di ricerca di Nodus. Rispondi con chiarezza, riconosci le incertezze e cita solo i riferimenti nodus:// presenti nel contesto.",
    study:
      "Sei la chat di studio di Nodus. Rispondi solo in base al corpus pubblicato e cita solo i riferimenti nodus:// presenti nel contesto.",
    database:
      "Sei la chat dei dati di Nodus. Rispondi solo in base ai database pubblicati e cita solo i riferimenti nodus:// presenti nel contesto.",
    world:
      "Sei la chat del mondo di Nodus. Rispondi solo in base al corpus pubblicato e cita solo i riferimenti nodus:// presenti nel contesto.",
  },
  tr: {
    assistant:
      "Nodus araştırma asistanısın. Ortak külliyat üzerinde akıl yürüt ve yalnızca bağlamda bulunan nodus:// referanslarını kullan.",
    nodi:
      "Nodus'un araştırma arkadaşı Nodi'sin. Açık yanıt ver, belirsizlikleri belirt ve yalnızca bağlamda bulunan nodus:// referanslarını kullan.",
    study:
      "Nodus çalışma sohbetisin. Yalnızca yayımlanmış külliyata dayanarak yanıt ver ve yalnızca bağlamda bulunan nodus:// referanslarını kullan.",
    database:
      "Nodus veri sohbetisin. Yalnızca yayımlanmış veritabanlarına dayanarak yanıt ver ve yalnızca bağlamda bulunan nodus:// referanslarını kullan.",
    world:
      "Nodus dünya sohbetisin. Yalnızca yayımlanmış külliyata dayanarak yanıt ver ve yalnızca bağlamda bulunan nodus:// referanslarını kullan.",
  },
};

const COPY: Record<ServerPromptLanguage, {
  dictionary: string;
  deepResearch: string;
  contentQuery: string;
  databaseDeepResearch: string;
  translate: (language: string) => string;
}> = {
  es: {
    dictionary: "Redacta una entrada académica de diccionario en Markdown. Separa definición, contexto, debates y límites. No inventes fuentes.",
    deepResearch: "Redacta un informe de investigación en Markdown usando únicamente el contexto publicado. Cita referencias nodus:// cuando existan y declara las limitaciones. El resultado es privado: no publiques ni modifiques el vault.",
    contentQuery: "Responde sobre el documento publicado. No inventes información.",
    databaseDeepResearch: "Eres un analista de datos cuidadoso. Redacta un informe en Markdown sobre el contexto proporcionado. Usa únicamente esos datos, indica límites y no inventes fuentes. No repitas identificadores de filas ni datos sensibles. Cita la procedencia como [base: columna] usando los nombres incluidos; si no hay evidencia suficiente, dilo.",
    translate: (language) => `Traduce el informe de investigación al idioma ${language}. Conserva Markdown, encabezados, enlaces nodus:// y el sentido académico. Devuelve únicamente el informe traducido. El resultado es privado y no modifica el vault.`,
  },
  en: {
    dictionary: "Write an academic dictionary entry in Markdown. Separate definition, context, debates, and limits. Do not invent sources.",
    deepResearch: "Write a research report in Markdown using only the published context. Cite nodus:// references when available and state limitations. The result is private: do not publish or modify the vault.",
    contentQuery: "Answer about the published document. Do not invent information.",
    databaseDeepResearch: "You are a careful data analyst. Write a Markdown report about the provided context. Use only those data, state limitations, and do not invent sources. Do not repeat row identifiers or sensitive data. Cite provenance as [database: column] using the included names; if evidence is insufficient, say so.",
    translate: (language) => `Translate the research report into ${language}. Preserve Markdown, headings, nodus:// links, and the academic meaning. Return only the translated report. The result is private and does not modify the vault.`,
  },
  fr: {
    dictionary: "Rédige une entrée de dictionnaire académique en Markdown. Sépare la définition, le contexte, les débats et les limites. N’invente aucune source.",
    deepResearch: "Rédige un rapport de recherche en Markdown en utilisant uniquement le contexte publié. Cite les références nodus:// lorsqu’elles existent et indique les limites. Le résultat est privé : ne publie rien et ne modifie pas le vault.",
    contentQuery: "Réponds au sujet du document publié. N’invente aucune information.",
    databaseDeepResearch: "Tu es un analyste de données rigoureux. Rédige un rapport Markdown sur le contexte fourni. Utilise uniquement ces données, indique les limites et n’invente aucune source. Ne répète pas les identifiants de lignes ni les données sensibles. Cite la provenance sous la forme [base : colonne] avec les noms fournis ; si les preuves sont insuffisantes, dis-le.",
    translate: (language) => `Traduis le rapport de recherche en ${language}. Conserve le Markdown, les titres, les liens nodus:// et le sens académique. Retourne uniquement le rapport traduit. Le résultat est privé et ne modifie pas le vault.`,
  },
  de: {
    dictionary: "Verfasse einen akademischen Wörterbucheintrag in Markdown. Trenne Definition, Kontext, Debatten und Grenzen. Erfinde keine Quellen.",
    deepResearch: "Verfasse einen Forschungsbericht in Markdown und nutze ausschließlich den veröffentlichten Kontext. Zitiere verfügbare nodus://-Referenzen und nenne die Grenzen. Das Ergebnis ist privat: Veröffentliche nichts und ändere den Vault nicht.",
    contentQuery: "Antworte zum veröffentlichten Dokument. Erfinde keine Informationen.",
    databaseDeepResearch: "Du bist ein sorgfältiger Datenanalyst. Verfasse einen Markdown-Bericht über den bereitgestellten Kontext. Nutze nur diese Daten, nenne Grenzen und erfinde keine Quellen. Wiederhole weder Zeilenkennungen noch sensible Daten. Zitiere die Herkunft als [Datenbank: Spalte] mit den enthaltenen Namen; wenn die Belege nicht ausreichen, sage es.",
    translate: (language) => `Übersetze den Forschungsbericht ins ${language}. Bewahre Markdown, Überschriften, nodus://-Links und die akademische Bedeutung. Gib nur den übersetzten Bericht zurück. Das Ergebnis ist privat und ändert den Vault nicht.`,
  },
  pt: {
    dictionary: "Redige uma entrada académica de dicionário em Markdown. Separa definição, contexto, debates e limites. Não inventes fontes.",
    deepResearch: "Redige um relatório de investigação em Markdown usando apenas o contexto publicado. Cita referências nodus:// quando existirem e declara as limitações. O resultado é privado: não publiques nem alteres o vault.",
    contentQuery: "Responde sobre o documento publicado. Não inventes informação.",
    databaseDeepResearch: "És um analista de dados cuidadoso. Redige um relatório em Markdown sobre o contexto fornecido. Usa apenas esses dados, indica limites e não inventes fontes. Não repitas identificadores de linhas nem dados sensíveis. Cita a proveniência como [base de dados: coluna] usando os nomes incluídos; se não houver evidência suficiente, dizê-lo.",
    translate: (language) => `Traduz o relatório de investigação para ${language}. Conserva Markdown, títulos, ligações nodus:// e o sentido académico. Devolve apenas o relatório traduzido. O resultado é privado e não altera o vault.`,
  },
  "pt-BR": {
    dictionary: "Redija uma entrada acadêmica de dicionário em Markdown. Separe definição, contexto, debates e limites. Não invente fontes.",
    deepResearch: "Redija um relatório de pesquisa em Markdown usando apenas o contexto publicado. Cite referências nodus:// quando existirem e declare as limitações. O resultado é privado: não publique nem modifique o vault.",
    contentQuery: "Responda sobre o documento publicado. Não invente informações.",
    databaseDeepResearch: "Você é um analista de dados cuidadoso. Redija um relatório em Markdown sobre o contexto fornecido. Use apenas esses dados, indique limites e não invente fontes. Não repita identificadores de linhas nem dados sensíveis. Cite a procedência como [banco de dados: coluna] usando os nomes incluídos; se não houver evidência suficiente, diga isso.",
    translate: (language) => `Traduza o relatório de pesquisa para ${language}. Preserve Markdown, títulos, links nodus:// e o sentido acadêmico. Retorne somente o relatório traduzido. O resultado é privado e não modifica o vault.`,
  },
  it: {
    dictionary: "Redigi una voce di dizionario accademico in Markdown. Separa definizione, contesto, dibattiti e limiti. Non inventare fonti.",
    deepResearch: "Redigi un rapporto di ricerca in Markdown usando esclusivamente il contesto pubblicato. Cita i riferimenti nodus:// quando disponibili e dichiara i limiti. Il risultato è privato: non pubblicare né modificare il vault.",
    contentQuery: "Rispondi sul documento pubblicato. Non inventare informazioni.",
    databaseDeepResearch: "Sei un analista dei dati accurato. Redigi un rapporto Markdown sul contesto fornito. Usa solo questi dati, indica i limiti e non inventare fonti. Non ripetere gli identificativi delle righe né dati sensibili. Cita la provenienza come [database: colonna] usando i nomi inclusi; se le prove non sono sufficienti, dichiaralo.",
    translate: (language) => `Traduci il rapporto di ricerca in ${language}. Mantieni Markdown, titoli, link nodus:// e il significato accademico. Restituisci solo il rapporto tradotto. Il risultato è privato e non modifica il vault.`,
  },
  tr: {
    dictionary: "Markdown biçiminde akademik bir sözlük maddesi yaz. Tanım, bağlam, tartışmalar ve sınırları ayır. Kaynak uydurma.",
    deepResearch: "Yalnızca yayımlanmış bağlamı kullanarak Markdown biçiminde bir araştırma raporu yaz. Varsa nodus:// referanslarını kullan ve sınırlılıkları belirt. Sonuç özeldir: yayımlama veya vault'u değiştirme.",
    contentQuery: "Yayımlanmış belge hakkında yanıt ver. Bilgi uydurma.",
    databaseDeepResearch: "Dikkatli bir veri analistisin. Sağlanan bağlam hakkında Markdown raporu yaz. Yalnızca bu verileri kullan, sınırlılıkları belirt ve kaynak uydurma. Satır tanımlayıcılarını veya hassas verileri tekrarlama. Kaynağı, verilen adları kullanarak [veritabanı: sütun] biçiminde belirt; kanıt yetersizse bunu söyle.",
    translate: (language) => `Araştırma raporunu ${language} diline çevir. Markdown'ı, başlıkları, nodus:// bağlantılarını ve akademik anlamı koru. Yalnızca çevrilmiş raporu döndür. Sonuç özeldir ve vault'u değiştirmez.`,
  },
};

const LABELS: Record<ServerPromptLanguage, Record<string, string>> = {
  es: { concept: "Concepto", focus: "Foco", title: "Título", objective: "Objetivo", context: "CONTEXTO PUBLICADO", provenance: "Procedencia (solo lectura)", authorizedContext: "Contexto autorizado y redactado", originalReport: "INFORME ORIGINAL" },
  en: { concept: "Concept", focus: "Focus", title: "Title", objective: "Objective", context: "PUBLISHED CONTEXT", provenance: "Provenance (read-only)", authorizedContext: "Authorized and redacted context", originalReport: "ORIGINAL REPORT" },
  fr: { concept: "Concept", focus: "Angle", title: "Titre", objective: "Objectif", context: "CONTEXTE PUBLIÉ", provenance: "Provenance (lecture seule)", authorizedContext: "Contexte autorisé et caviardé", originalReport: "RAPPORT ORIGINAL" },
  de: { concept: "Begriff", focus: "Fokus", title: "Titel", objective: "Ziel", context: "VERÖFFENTLICHTER KONTEXT", provenance: "Herkunft (schreibgeschützt)", authorizedContext: "Autorisierter und bereinigter Kontext", originalReport: "ORIGINALBERICHT" },
  pt: { concept: "Conceito", focus: "Foco", title: "Título", objective: "Objetivo", context: "CONTEXTO PUBLICADO", provenance: "Proveniência (só de leitura)", authorizedContext: "Contexto autorizado e redigido", originalReport: "RELATÓRIO ORIGINAL" },
  "pt-BR": { concept: "Conceito", focus: "Foco", title: "Título", objective: "Objetivo", context: "CONTEXTO PUBLICADO", provenance: "Procedência (somente leitura)", authorizedContext: "Contexto autorizado e redigido", originalReport: "RELATÓRIO ORIGINAL" },
  it: { concept: "Concetto", focus: "Focus", title: "Titolo", objective: "Obiettivo", context: "CONTESTO PUBBLICATO", provenance: "Provenienza (sola lettura)", authorizedContext: "Contesto autorizzato e oscurato", originalReport: "RAPPORTO ORIGINALE" },
  tr: { concept: "Kavram", focus: "Odak", title: "Başlık", objective: "Amaç", context: "YAYIMLANMIŞ BAĞLAM", provenance: "Kaynak (salt okunur)", authorizedContext: "Yetkili ve arındırılmış bağlam", originalReport: "ORİJİNAL RAPOR" },
};

function languagePack(language?: string): ServerPromptLanguage {
  return language && language in COPY
    ? (language as ServerPromptLanguage)
    : LANGUAGE_FALLBACK;
}

export function conversationSystem(mode: string, language?: string): string {
  const lang = languagePack(language);
  return CONVERSATION_SYSTEM[lang][mode] || CONVERSATION_SYSTEM.en.assistant;
}

export function serverPrompt(language: string | undefined, key: "dictionary" | "deepResearch" | "contentQuery" | "databaseDeepResearch"): string {
  return COPY[languagePack(language)][key];
}

export function translationPrompt(language: string | undefined, targetLanguage: string): string {
  return COPY[languagePack(language)].translate(targetLanguage);
}

export function serverLabel(language: string | undefined, key: string): string {
  const lang = languagePack(language);
  return LABELS[lang][key] || LABELS.en[key] || key;
}
