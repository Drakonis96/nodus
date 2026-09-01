import type { PromptLanguage } from './types';

export interface StudyKnowledgePromptPack {
  system: string;
  title: string;
  text: string;
  insufficientText: string;
  externalPurpose: string;
  connection: string;
}

const SCHEMA = '{"ideas":[{"key":"i1","type":"concept","label":"...","statement":"...","role":"principal|secondary","confidence":0.8,"evidence":[{"quote":"...","location":"p. 2"}]}],"relations":[{"from":"i1","to":"i2","type":"related","basis":"...","confidence":0.8}]}';

const PACKS: Record<PromptLanguage, StudyKnowledgePromptPack> = {
  es: { system: `Analiza material docente y devuelve un mapa conceptual trazable. Extrae solo ideas respaldadas por el texto.
Cada idea necesita una etiqueta breve, un enunciado autosuficiente y una o más citas textuales exactas.
Usa tipos: concept, definition, principle, process, cause, consequence, example, debate.
Usa relaciones: related, supports, contrasts, causes, depends_on, part_of, applies.
Las relaciones solo pueden referirse a las claves de ideas devueltas. No inventes páginas ni citas.
Devuelve JSON: ${SCHEMA}`, title: 'TÍTULO', text: 'TEXTO', insufficientText: 'La fuente no contiene suficiente texto para extraer ideas.', externalPurpose: 'analizar el material y extraer un mapa conceptual trazable', connection: 'Conexión' },
  en: { system: `Analyze teaching material and return a traceable concept map. Extract only ideas supported by the text.
Each idea needs a short label, a self-contained statement, and one or more exact verbatim quotations.
Use types: concept, definition, principle, process, cause, consequence, example, debate.
Use relations: related, supports, contrasts, causes, depends_on, part_of, applies.
Relations may refer only to the keys of returned ideas. Do not invent pages or quotations.
Return JSON: ${SCHEMA}`, title: 'TITLE', text: 'TEXT', insufficientText: 'The source does not contain enough text to extract ideas.', externalPurpose: 'analyze the material and extract a traceable concept map', connection: 'Connection' },
  fr: { system: `Analyse le matériel pédagogique et renvoie une carte conceptuelle traçable. Extrais uniquement les idées étayées par le texte.
Chaque idée doit comporter un libellé bref, un énoncé autonome et une ou plusieurs citations textuelles exactes.
Utilise les types : concept, definition, principle, process, cause, consequence, example, debate.
Utilise les relations : related, supports, contrasts, causes, depends_on, part_of, applies.
Les relations ne peuvent se référer qu’aux clés des idées renvoyées. N’invente ni pages ni citations.
Renvoie du JSON : ${SCHEMA}`, title: 'TITRE', text: 'TEXTE', insufficientText: 'La source ne contient pas assez de texte pour extraire des idées.', externalPurpose: 'analyser le matériel et extraire une carte conceptuelle traçable', connection: 'Lien' },
  de: { system: `Analysiere Lehrmaterial und gib eine nachvollziehbare Begriffslandkarte zurück. Extrahiere nur Ideen, die durch den Text gestützt werden.
Jede Idee benötigt eine kurze Bezeichnung, eine eigenständige Aussage und ein oder mehrere exakte wörtliche Zitate.
Verwende die Typen: concept, definition, principle, process, cause, consequence, example, debate.
Verwende die Beziehungen: related, supports, contrasts, causes, depends_on, part_of, applies.
Beziehungen dürfen sich nur auf die Schlüssel der zurückgegebenen Ideen beziehen. Erfinde keine Seiten oder Zitate.
Gib JSON zurück: ${SCHEMA}`, title: 'TITEL', text: 'TEXT', insufficientText: 'Die Quelle enthält nicht genügend Text, um Ideen zu extrahieren.', externalPurpose: 'das Material analysieren und eine nachvollziehbare Begriffslandkarte extrahieren', connection: 'Verbindung' },
  pt: { system: `Analisa material docente e devolve um mapa conceptual rastreável. Extrai apenas ideias sustentadas pelo texto.
Cada ideia precisa de uma etiqueta breve, um enunciado autónomo e uma ou mais citações textuais exatas.
Usa os tipos: concept, definition, principle, process, cause, consequence, example, debate.
Usa as relações: related, supports, contrasts, causes, depends_on, part_of, applies.
As relações só podem referir-se às chaves das ideias devolvidas. Não inventes páginas nem citações.
Devolve JSON: ${SCHEMA}`, title: 'TÍTULO', text: 'TEXTO', insufficientText: 'A fonte não contém texto suficiente para extrair ideias.', externalPurpose: 'analisar o material e extrair um mapa conceptual rastreável', connection: 'Conexão' },
  'pt-BR': { system: `Analise o material didático e retorne um mapa conceitual rastreável. Extraia somente ideias sustentadas pelo texto.
Cada ideia precisa de um rótulo breve, um enunciado autônomo e uma ou mais citações textuais exatas.
Use os tipos: concept, definition, principle, process, cause, consequence, example, debate.
Use as relações: related, supports, contrasts, causes, depends_on, part_of, applies.
As relações podem se referir somente às chaves das ideias retornadas. Não invente páginas nem citações.
Retorne JSON: ${SCHEMA}`, title: 'TÍTULO', text: 'TEXTO', insufficientText: 'A fonte não contém texto suficiente para extrair ideias.', externalPurpose: 'analisar o material e extrair um mapa conceitual rastreável', connection: 'Conexão' },
  it: { system: `Analizza il materiale didattico e restituisci una mappa concettuale tracciabile. Estrai soltanto idee sostenute dal testo.
Ogni idea deve avere un’etichetta breve, un enunciato autonomo e una o più citazioni testuali esatte.
Usa i tipi: concept, definition, principle, process, cause, consequence, example, debate.
Usa le relazioni: related, supports, contrasts, causes, depends_on, part_of, applies.
Le relazioni possono riferirsi solo alle chiavi delle idee restituite. Non inventare pagine né citazioni.
Restituisci JSON: ${SCHEMA}`, title: 'TITOLO', text: 'TESTO', insufficientText: 'La fonte non contiene testo sufficiente per estrarre idee.', externalPurpose: 'analizzare il materiale ed estrarre una mappa concettuale tracciabile', connection: 'Collegamento' },
  tr: { system: `Öğretim materyalini incele ve izlenebilir bir kavram haritası döndür. Yalnızca metin tarafından desteklenen fikirleri çıkar.
Her fikir kısa bir etiket, kendi başına anlaşılır bir ifade ve bir veya daha fazla birebir alıntı içermelidir.
Şu türleri kullan: concept, definition, principle, process, cause, consequence, example, debate.
Şu ilişkileri kullan: related, supports, contrasts, causes, depends_on, part_of, applies.
İlişkiler yalnızca döndürülen fikirlerin anahtarlarına başvurabilir. Sayfa veya alıntı uydurma.
JSON döndür: ${SCHEMA}`, title: 'BAŞLIK', text: 'METİN', insufficientText: 'Kaynak, fikir çıkarmak için yeterli metin içermiyor.', externalPurpose: 'materyali incelemek ve izlenebilir bir kavram haritası çıkarmak', connection: 'Bağlantı' },
};

export function studyKnowledgePromptPack(language: PromptLanguage = 'es'): StudyKnowledgePromptPack {
  return PACKS[language] ?? PACKS.es;
}
