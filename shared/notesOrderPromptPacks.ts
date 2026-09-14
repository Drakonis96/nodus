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
  'zh-Hans': {
    system: '你是一位学术编辑。请对一组研究笔记进行排序，使每条笔记在逻辑上承接前一条：从一般到具体，遵循概念依赖关系（定义和前提先于其结论），并将相关主题归为一组。请仅返回如下形式的 JSON：{"order": ["id1","id2", ...]}，使用所提供的准确 id，每个 id 恰好包含一次，不得编造或遗漏任何 id。',
    title: '标题', summary: '摘要', notes: '待排序的笔记',
    returnOrder: '请按 {"order": [...]} 形式返回逻辑顺序，并使用准确的 id。',
  },
  'zh-Hant': {
    system: '你是一位學術編輯。請對一組研究筆記進行排序，使每則筆記在邏輯上承接前一則：從一般到具體，遵循概念依賴關係（定義與前提先於其結論），並將相關主題歸為一組。請僅回傳如下形式的 JSON：{"order": ["id1","id2", ...]}，使用所提供的準確 id，每個 id 恰好包含一次，不得編造或遺漏任何 id。',
    title: '標題', summary: '摘要', notes: '待排序的筆記',
    returnOrder: '請以 {"order": [...]} 形式回傳邏輯順序，並使用準確的 id。',
  },
  vi: {
    system: 'Bạn là biên tập viên học thuật. Hãy sắp xếp một tập hợp ghi chú nghiên cứu sao cho mỗi ghi chú tiếp nối hợp lý ghi chú trước: đi từ khái quát đến cụ thể, tôn trọng các phụ thuộc khái niệm (định nghĩa và tiền đề trước hệ quả của chúng) và nhóm các chủ đề liên quan. Chỉ trả về JSON theo dạng {"order": ["id1","id2", ...]}, dùng đúng các id được cung cấp và bao gồm mỗi id đúng một lần, không bịa đặt hay bỏ sót id nào.',
    title: 'tiêu đề', summary: 'tóm tắt', notes: 'Ghi chú cần sắp xếp',
    returnOrder: 'Trả về thứ tự logic dưới dạng {"order": [...]} với các id chính xác.',
  },
  ja: {
    system: 'あなたは学術編集者です。一連の研究ノートを、各ノートが前のノートから論理的に続くように並べ替えてください。一般から具体へ進み、概念上の依存関係（定義と前提をその帰結より前に置く）を守り、関連するテーマをまとめます。提供された正確な id を使用し、すべての id をちょうど一度ずつ含め、いずれも捏造または省略することなく、{"order": ["id1","id2", ...]} の形式の JSON のみを返してください。',
    title: 'タイトル', summary: '要約', notes: '並べ替えるノート',
    returnOrder: '論理的な順序を正確な id とともに {"order": [...]} の形式で返してください。',
  },
  ru: {
    system: 'Вы академический редактор. Упорядочьте набор исследовательских заметок так, чтобы каждая заметка логически продолжала предыдущую: от общего к конкретному, соблюдая концептуальные зависимости (определения и предпосылки перед их следствиями) и группируя связанные темы. Верните ИСКЛЮЧИТЕЛЬНО JSON в форме {"order": ["id1","id2", ...]}, используя точные предоставленные id и включая каждый id ровно один раз, ничего не выдумывая и не пропуская.',
    title: 'название', summary: 'резюме', notes: 'Заметки для упорядочивания',
    returnOrder: 'Верните логический порядок в виде {"order": [...]} с точными id.',
  },
  uk: {
    system: 'Ви академічний редактор. Упорядкуйте набір дослідницьких нотаток так, щоб кожна нотатка логічно продовжувала попередню: від загального до конкретного, дотримуючись концептуальних залежностей (визначення та передумови перед їхніми наслідками) і групуючи споріднені теми. Поверніть ВИКЛЮЧНО JSON у формі {"order": ["id1","id2", ...]}, використовуючи точні надані id і включаючи кожен id рівно один раз, нічого не вигадуючи та не пропускаючи.',
    title: 'назва', summary: 'резюме', notes: 'Нотатки для впорядкування',
    returnOrder: 'Поверніть логічний порядок у вигляді {"order": [...]} з точними id.',
  },
  ko: {
    system: '당신은 학술 편집자입니다. 일련의 연구 노트를 각 노트가 이전 노트를 논리적으로 잇도록 정렬하십시오: 일반에서 구체로 나아가고, 개념적 의존 관계(정의와 전제를 그 결과보다 먼저)를 존중하며, 관련 주제를 묶으십시오. 제공된 정확한 id를 사용하고 모든 id를 정확히 한 번씩 포함하며, 어떤 id도 날조하거나 누락하지 않고 {"order": ["id1","id2", ...]} 형식의 JSON만 반환하십시오.',
    title: '제목', summary: '요약', notes: '정렬할 노트',
    returnOrder: '논리적 순서를 정확한 id와 함께 {"order": [...]} 형식으로 반환하십시오.',
  },
};

export function notesOrderPromptPack(language: PromptLanguage = 'es'): NotesOrderPromptPack {
  return PACKS[language] ?? PACKS.es;
}
