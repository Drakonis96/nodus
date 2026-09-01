import type { PromptLanguage } from './types';

export interface NotesOrderPromptPack {
  system: string;
  title: string;
  summary: string;
  notes: string;
  returnOrder: string;
}

const PACKS: Record<PromptLanguage, NotesOrderPromptPack> = {
  es: {
    system: 'Eres un editor académico. Ordena un conjunto de notas de investigación para que la sucesión de una nota tras otra tenga lógica: de lo general a lo concreto, respetando dependencias conceptuales (definiciones y premisas antes que sus consecuencias) y agrupando temas afines. Devuelve EXCLUSIVAMENTE un JSON con la forma {"order": ["id1","id2", ...]} usando los id exactos proporcionados, incluyendo todos los id una sola vez, sin inventar ni omitir ninguno.',
    title: 'título', summary: 'resumen', notes: 'Notas a ordenar',
    returnOrder: 'Devuelve el orden lógico como {"order": [...]} con los id exactos.',
  },
  en: {
    system: 'You are an academic editor. Order a set of research notes so that each note follows logically from the previous one: move from the general to the specific, respect conceptual dependencies (definitions and premises before their consequences), and group related topics. Return EXCLUSIVELY JSON in the form {"order": ["id1","id2", ...]}, using the exact ids provided and including every id exactly once, without inventing or omitting any.',
    title: 'title', summary: 'summary', notes: 'Notes to order',
    returnOrder: 'Return the logical order as {"order": [...]} with the exact ids.',
  },
  fr: {
    system: 'Tu es spécialiste de l’édition universitaire. Ordonne un ensemble de notes de recherche afin que leur enchaînement soit logique : va du général au particulier, respecte les dépendances conceptuelles (définitions et prémisses avant leurs conséquences) et regroupe les thèmes apparentés. Renvoie EXCLUSIVEMENT un JSON de la forme {"order": ["id1","id2", ...]}, en utilisant les identifiants exacts fournis et en incluant chacun une seule fois, sans en inventer ni en omettre.',
    title: 'titre', summary: 'résumé', notes: 'Notes à ordonner',
    returnOrder: 'Renvoie l’ordre logique sous la forme {"order": [...]} avec les identifiants exacts.',
  },
  de: {
    system: 'Du bist wissenschaftlicher Lektor. Ordne Forschungsnotizen so, dass jede Note logisch auf die vorherige folgt: vom Allgemeinen zum Besonderen, unter Beachtung begrifflicher Abhängigkeiten (Definitionen und Prämissen vor ihren Folgen) und mit einer Gruppierung verwandter Themen. Gib AUSSCHLIESSLICH JSON in der Form {"order": ["id1","id2", ...]} zurück. Verwende die exakt vorgegebenen IDs und nimm jede ID genau einmal auf, ohne eine zu erfinden oder auszulassen.',
    title: 'Titel', summary: 'Zusammenfassung', notes: 'Zu ordnende Notizen',
    returnOrder: 'Gib die logische Reihenfolge als {"order": [...]} mit den exakten IDs zurück.',
  },
  pt: {
    system: 'És editor académico. Ordena um conjunto de notas de investigação para que cada nota suceda logicamente à anterior: do geral para o concreto, respeitando dependências conceptuais (definições e premissas antes das respetivas consequências) e agrupando temas afins. Devolve EXCLUSIVAMENTE JSON com a forma {"order": ["id1","id2", ...]}, usando os ids exatos fornecidos e incluindo todos uma única vez, sem inventar nem omitir nenhum.',
    title: 'título', summary: 'resumo', notes: 'Notas a ordenar',
    returnOrder: 'Devolve a ordem lógica como {"order": [...]} com os ids exatos.',
  },
  'pt-BR': {
    system: 'Você é um editor acadêmico. Ordene um conjunto de notas de pesquisa para que cada nota suceda logicamente à anterior: do geral para o específico, respeitando as dependências conceituais (definições e premissas antes de suas consequências) e agrupando temas relacionados. Retorne EXCLUSIVAMENTE JSON no formato {"order": ["id1","id2", ...]}, usando os ids exatos fornecidos e incluindo todos uma única vez, sem inventar nem omitir nenhum.',
    title: 'título', summary: 'resumo', notes: 'Notas a ordenar',
    returnOrder: 'Retorne a ordem lógica como {"order": [...]} com os ids exatos.',
  },
  it: {
    system: 'Sei un editor accademico. Ordina un insieme di note di ricerca affinché ciascuna segua logicamente la precedente: procedi dal generale al particolare, rispetta le dipendenze concettuali (definizioni e premesse prima delle loro conseguenze) e raggruppa gli argomenti affini. Restituisci ESCLUSIVAMENTE JSON nella forma {"order": ["id1","id2", ...]}, usando gli id esatti forniti e includendo ciascun id una sola volta, senza inventarne né ometterne alcuno.',
    title: 'titolo', summary: 'riassunto', notes: 'Note da ordinare',
    returnOrder: 'Restituisci l’ordine logico come {"order": [...]} con gli id esatti.',
  },
  tr: {
    system: 'Akademik bir editörsün. Araştırma notlarını, her not bir öncekini mantıksal olarak izleyecek biçimde sırala: genelden özele ilerle, kavramsal bağımlılıklara uy (tanımlar ve öncüller sonuçlarından önce gelsin) ve ilişkili konuları grupla. Sağlanan kimlikleri aynen kullanarak ve her kimliği tam bir kez ekleyerek, hiçbirini uydurmadan veya atlamadan YALNIZCA {"order": ["id1","id2", ...]} biçiminde JSON döndür.',
    title: 'başlık', summary: 'özet', notes: 'Sıralanacak notlar',
    returnOrder: 'Mantıksal sırayı tam kimliklerle {"order": [...]} biçiminde döndür.',
  },
};

export function notesOrderPromptPack(language: PromptLanguage = 'es'): NotesOrderPromptPack {
  return PACKS[language] ?? PACKS.es;
}
