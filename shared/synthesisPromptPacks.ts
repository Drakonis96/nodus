import type { IdeaType, PromptLanguage } from './types';

export interface SynthesisPromptPack {
  matrixSystem: string;
  matrixAuthor: string;
  matrixTheme: string;
  matrixIdeas: string;
  matrixReturn: string;
  workSystem(maxRemember: number): string;
  work: string;
  authors: string;
  themes: string;
  workIdeas: string;
  connections: string;
  workReturn: string;
  noAuthorship: string;
  noThemes: string;
  noConnections: string;
  primary: string;
  secondary: string;
  ideaTypes: Record<IdeaType, string>;
}

const PACKS: Record<PromptLanguage, SynthesisPromptPack> = {
  es: {
    matrixSystem: 'Eres un asistente de investigación académica. Resume en UNA sola frase la postura de un autor sobre un tema concreto, a partir únicamente de las ideas proporcionadas. No inventes nada que no esté en las ideas. Devuelve EXCLUSIVAMENTE un JSON con la forma {"stance": "una frase"}.',
    matrixAuthor: 'AUTOR', matrixTheme: 'TEMA', matrixIdeas: 'IDEAS DEL AUTOR SOBRE ESTE TEMA', matrixReturn: 'Devuelve {"stance": "…"}.',
    workSystem: (max) => 'Eres un asistente de investigación académica. A partir de las ideas extraídas de UNA obra, produces una ficha breve de síntesis para estudiar esa obra dentro de un corpus. No inventes información externa ni citas. Trabaja solo con las ideas, temas y conexiones proporcionadas. Devuelve EXCLUSIVAMENTE un JSON con la forma {"thesis": "1-2 frases con la tesis central de la obra", "remember": ["punto clave", "..."], "positioning": "un párrafo sobre cómo se organiza internamente y qué tensiones o relaciones contiene"}. El campo "remember" debe tener entre 3 y ' + max + ' puntos breves.',
    work: 'OBRA', authors: 'AUTORES', themes: 'TEMAS', workIdeas: 'IDEAS DE LA OBRA', connections: 'CONEXIONES INTERNAS ENTRE IDEAS', workReturn: 'Devuelve el JSON de síntesis de la obra.', noAuthorship: 'autoría no disponible', noThemes: 'sin temas registrados', noConnections: 'sin conexiones internas registradas', primary: 'principal', secondary: 'secundaria', ideaTypes: { claim: 'afirmación', finding: 'hallazgo', construct: 'constructo', method: 'método', framework: 'marco' },
  },
  en: {
    matrixSystem: 'You are an academic research assistant. Summarize an authors position on a specific theme in ONE sentence, using only the ideas provided. Do not invent anything absent from those ideas. Return EXCLUSIVELY JSON in the form {"stance": "one sentence"}.',
    matrixAuthor: 'AUTHOR', matrixTheme: 'THEME', matrixIdeas: 'THE AUTHORS IDEAS ABOUT THIS THEME', matrixReturn: 'Return {"stance": "…"}.',
    workSystem: (max) => 'You are an academic research assistant. From the ideas extracted from ONE work, produce a brief synthesis sheet for studying that work within a corpus. Do not invent external information or citations. Work only with the ideas, themes, and connections provided. Return EXCLUSIVELY JSON in the form {"thesis": "1-2 sentences stating the works central thesis", "remember": ["key point", "..."], "positioning": "one paragraph explaining its internal organization and the tensions or relationships it contains"}. The "remember" field must contain between 3 and ' + max + ' brief points.',
    work: 'WORK', authors: 'AUTHORS', themes: 'THEMES', workIdeas: 'IDEAS FROM THE WORK', connections: 'INTERNAL CONNECTIONS BETWEEN IDEAS', workReturn: 'Return the works synthesis JSON.', noAuthorship: 'authorship unavailable', noThemes: 'no themes recorded', noConnections: 'no internal connections recorded', primary: 'primary', secondary: 'secondary', ideaTypes: { claim: 'claim', finding: 'finding', construct: 'construct', method: 'method', framework: 'framework' },
  },
  fr: {
    matrixSystem: 'Tu es un assistant de recherche universitaire. Résume en UNE seule phrase la position d’un auteur sur un thème précis, uniquement à partir des idées fournies. N’invente rien qui ne figure pas dans ces idées. Renvoie EXCLUSIVEMENT un JSON de la forme {"stance": "une phrase"}.',
    matrixAuthor: 'AUTEUR', matrixTheme: 'THÈME', matrixIdeas: 'IDÉES DE L’AUTEUR SUR CE THÈME', matrixReturn: 'Renvoie {"stance": "…"}.',
    workSystem: (max) => 'Tu es un assistant de recherche universitaire. À partir des idées extraites d’UNE œuvre, produis une courte fiche de synthèse permettant d’étudier cette œuvre dans un corpus. N’invente aucune information externe ni aucune citation. Travaille uniquement avec les idées, thèmes et liens fournis. Renvoie EXCLUSIVEMENT un JSON de la forme {"thesis": "1 à 2 phrases exposant la thèse centrale de l’œuvre", "remember": ["point clé", "..."], "positioning": "un paragraphe sur son organisation interne et les tensions ou relations qu’elle contient"}. Le champ "remember" doit contenir entre 3 et ' + max + ' points brefs.',
    work: 'ŒUVRE', authors: 'AUTEURS', themes: 'THÈMES', workIdeas: 'IDÉES DE L’ŒUVRE', connections: 'LIENS INTERNES ENTRE LES IDÉES', workReturn: 'Renvoie le JSON de synthèse de l’œuvre.', noAuthorship: 'auteurs non disponibles', noThemes: 'aucun thème enregistré', noConnections: 'aucun lien interne enregistré', primary: 'principale', secondary: 'secondaire', ideaTypes: { claim: 'affirmation', finding: 'résultat', construct: 'construit', method: 'méthode', framework: 'cadre' },
  },
  de: {
    matrixSystem: 'Du bist ein wissenschaftlicher Forschungsassistent. Fasse die Position eines Autors zu einem bestimmten Thema in EINEM Satz zusammen und stütze dich ausschließlich auf die bereitgestellten Ideen. Erfinde nichts, was nicht in den Ideen enthalten ist. Gib AUSSCHLIESSLICH JSON in der Form {"stance": "ein Satz"} zurück.',
    matrixAuthor: 'AUTOR', matrixTheme: 'THEMA', matrixIdeas: 'IDEEN DES AUTORS ZU DIESEM THEMA', matrixReturn: 'Gib {"stance": "…"} zurück.',
    workSystem: (max) => 'Du bist ein wissenschaftlicher Forschungsassistent. Erstelle aus den extrahierten Ideen EINES Werks ein kurzes Syntheseblatt, um dieses Werk innerhalb eines Korpus zu untersuchen. Erfinde keine externen Informationen oder Zitate. Arbeite ausschließlich mit den bereitgestellten Ideen, Themen und Verbindungen. Gib AUSSCHLIESSLICH JSON in der Form {"thesis": "1-2 Sätze zur zentralen These des Werks", "remember": ["Kernpunkt", "..."], "positioning": "ein Absatz über den inneren Aufbau sowie enthaltene Spannungen oder Beziehungen"} zurück. Das Feld "remember" muss zwischen 3 und ' + max + ' kurze Punkte enthalten.',
    work: 'WERK', authors: 'AUTOREN', themes: 'THEMEN', workIdeas: 'IDEEN DES WERKS', connections: 'INTERNE VERBINDUNGEN ZWISCHEN IDEEN', workReturn: 'Gib das Synthese-JSON des Werks zurück.', noAuthorship: 'Urheberschaft nicht verfügbar', noThemes: 'keine Themen erfasst', noConnections: 'keine internen Verbindungen erfasst', primary: 'primär', secondary: 'sekundär', ideaTypes: { claim: 'Behauptung', finding: 'Ergebnis', construct: 'Konstrukt', method: 'Methode', framework: 'Rahmen' },
  },
  pt: {
    matrixSystem: 'És um assistente de investigação académica. Resume numa ÚNICA frase a posição de um autor sobre um tema concreto, usando apenas as ideias fornecidas. Não inventes nada que não conste dessas ideias. Devolve EXCLUSIVAMENTE JSON com a forma {"stance": "uma frase"}.',
    matrixAuthor: 'AUTOR', matrixTheme: 'TEMA', matrixIdeas: 'IDEIAS DO AUTOR SOBRE ESTE TEMA', matrixReturn: 'Devolve {"stance": "…"}.',
    workSystem: (max) => 'És um assistente de investigação académica. A partir das ideias extraídas de UMA obra, produz uma ficha breve de síntese para estudar essa obra dentro de um corpus. Não inventes informação externa nem citações. Trabalha apenas com as ideias, temas e conexões fornecidos. Devolve EXCLUSIVAMENTE JSON com a forma {"thesis": "1-2 frases com a tese central da obra", "remember": ["ponto-chave", "..."], "positioning": "um parágrafo sobre a sua organização interna e as tensões ou relações que contém"}. O campo "remember" deve conter entre 3 e ' + max + ' pontos breves.',
    work: 'OBRA', authors: 'AUTORES', themes: 'TEMAS', workIdeas: 'IDEIAS DA OBRA', connections: 'CONEXÕES INTERNAS ENTRE IDEIAS', workReturn: 'Devolve o JSON de síntese da obra.', noAuthorship: 'autoria não disponível', noThemes: 'sem temas registados', noConnections: 'sem conexões internas registadas', primary: 'principal', secondary: 'secundária', ideaTypes: { claim: 'afirmação', finding: 'descoberta', construct: 'constructo', method: 'método', framework: 'quadro' },
  },
  'pt-BR': {
    matrixSystem: 'Você é um assistente de pesquisa acadêmica. Resuma em UMA única frase a posição de um autor sobre um tema específico, usando somente as ideias fornecidas. Não invente nada que não esteja nessas ideias. Retorne EXCLUSIVAMENTE JSON no formato {"stance": "uma frase"}.',
    matrixAuthor: 'AUTOR', matrixTheme: 'TEMA', matrixIdeas: 'IDEIAS DO AUTOR SOBRE ESTE TEMA', matrixReturn: 'Retorne {"stance": "…"}.',
    workSystem: (max) => 'Você é um assistente de pesquisa acadêmica. A partir das ideias extraídas de UMA obra, produza uma ficha breve de síntese para estudar essa obra dentro de um corpus. Não invente informações externas nem citações. Trabalhe somente com as ideias, os temas e as conexões fornecidos. Retorne EXCLUSIVAMENTE JSON no formato {"thesis": "1-2 frases com a tese central da obra", "remember": ["ponto-chave", "..."], "positioning": "um parágrafo sobre sua organização interna e as tensões ou relações que contém"}. O campo "remember" deve conter entre 3 e ' + max + ' pontos breves.',
    work: 'OBRA', authors: 'AUTORES', themes: 'TEMAS', workIdeas: 'IDEIAS DA OBRA', connections: 'CONEXÕES INTERNAS ENTRE IDEIAS', workReturn: 'Retorne o JSON de síntese da obra.', noAuthorship: 'autoria não disponível', noThemes: 'sem temas registrados', noConnections: 'sem conexões internas registradas', primary: 'principal', secondary: 'secundária', ideaTypes: { claim: 'afirmação', finding: 'achado', construct: 'construto', method: 'método', framework: 'estrutura' },
  },
  it: {
    matrixSystem: 'Sei un assistente di ricerca accademica. Riassumi in UNA sola frase la posizione di un autore su un tema specifico, basandoti unicamente sulle idee fornite. Non inventare nulla che non sia presente nelle idee. Restituisci ESCLUSIVAMENTE JSON nella forma {"stance": "una frase"}.',
    matrixAuthor: 'AUTORE', matrixTheme: 'TEMA', matrixIdeas: 'IDEE DELL’AUTORE SU QUESTO TEMA', matrixReturn: 'Restituisci {"stance": "…"}.',
    workSystem: (max) => 'Sei un assistente di ricerca accademica. A partire dalle idee estratte da UNA sola opera, produci una breve scheda di sintesi per studiare quell’opera all’interno di un corpus. Non inventare informazioni esterne né citazioni. Lavora soltanto con le idee, i temi e i collegamenti forniti. Restituisci ESCLUSIVAMENTE JSON nella forma {"thesis": "1-2 frasi con la tesi centrale dell’opera", "remember": ["punto chiave", "..."], "positioning": "un paragrafo sulla sua organizzazione interna e sulle tensioni o relazioni che contiene"}. Il campo "remember" deve contenere da 3 a ' + max + ' punti brevi.',
    work: 'OPERA', authors: 'AUTORI', themes: 'TEMI', workIdeas: 'IDEE DELL’OPERA', connections: 'COLLEGAMENTI INTERNI TRA LE IDEE', workReturn: 'Restituisci il JSON di sintesi dell’opera.', noAuthorship: 'autori non disponibili', noThemes: 'nessun tema registrato', noConnections: 'nessun collegamento interno registrato', primary: 'principale', secondary: 'secondaria', ideaTypes: { claim: 'affermazione', finding: 'risultato', construct: 'costrutto', method: 'metodo', framework: 'quadro' },
  },
  tr: {
    matrixSystem: 'Akademik bir araştırma asistanısın. Bir yazarın belirli bir tema hakkındaki konumunu yalnızca sağlanan fikirlere dayanarak TEK cümlede özetle. Fikirlerde bulunmayan hiçbir şeyi uydurma. YALNIZCA {"stance": "tek cümle"} biçiminde JSON döndür.',
    matrixAuthor: 'YAZAR', matrixTheme: 'TEMA', matrixIdeas: 'YAZARIN BU TEMA HAKKINDAKİ FİKİRLERİ', matrixReturn: '{"stance": "…"} döndür.',
    workSystem: (max) => 'Akademik bir araştırma asistanısın. TEK bir eserden çıkarılmış fikirlerden, o eseri bir derlem içinde incelemek için kısa bir sentez fişi oluştur. Dış bilgi veya alıntı uydurma. Yalnızca sağlanan fikirler, temalar ve bağlantılarla çalış. YALNIZCA {"thesis": "eserin ana tezini belirten 1-2 cümle", "remember": ["temel nokta", "..."], "positioning": "iç düzenini ve içerdiği gerilim veya ilişkileri açıklayan bir paragraf"} biçiminde JSON döndür. "remember" alanı 3 ile ' + max + ' arasında kısa nokta içermelidir.',
    work: 'ESER', authors: 'YAZARLAR', themes: 'TEMALAR', workIdeas: 'ESERİN FİKİRLERİ', connections: 'FİKİRLER ARASINDAKİ İÇ BAĞLANTILAR', workReturn: 'Eser sentezinin JSON çıktısını döndür.', noAuthorship: 'yazarlık bilgisi yok', noThemes: 'kayıtlı tema yok', noConnections: 'kayıtlı iç bağlantı yok', primary: 'birincil', secondary: 'ikincil', ideaTypes: { claim: 'iddia', finding: 'bulgu', construct: 'yapı', method: 'yöntem', framework: 'çerçeve' },
  },
};

export function synthesisPromptPack(language: PromptLanguage = 'es'): SynthesisPromptPack {
  return PACKS[language] ?? PACKS.es;
}
