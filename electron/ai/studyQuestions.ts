import type {
  StudyQuestionGenerationRequest,
  StudyQuestionGenerationResult,
  StudyQuestionInput,
} from '@shared/studyQuestions';
import { findSimilarStudyQuestion, parseStudyDevelopmentQuestionBlocks, parseStudyQuestionBlocks, studyGeneratedQuestionType, studyQuestionSimilarity, STUDY_GENERATABLE_QUESTION_TYPES } from '@shared/studyQuestions';
import { compressStudyAssistantEvidence, studyAssistantSourceKey } from '@shared/studyAssistant';
import type { StudySearchIndexEntry, StudySearchOptions } from '@shared/studySearch';
import { listStudyQuestions } from '../db/studyQuestionsRepo';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { completeText } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';
import { retrieveStudyAssistantEntries } from './studySearch';
import { retrieveStudyKnowledgeContext } from './studyKnowledge';
import type { StudyAssessmentKnowledgeContext } from '@shared/studyKnowledge';
import type { PromptLanguage } from '@shared/types';

function searchOptions(request: StudyQuestionGenerationRequest): StudySearchOptions {
  return {
    courseId: request.courseId || undefined,
    subjectId: request.subjectId || undefined,
    // Folder and topic scopes are resolved to explicit source keys below so
    // descendants remain included instead of being filtered out here.
  };
}

function nestedSourceKeys(request: StudyQuestionGenerationRequest): string[] {
  if (!request.folderId && !request.topicId) return request.sourceKeys;
  const db = getDb();
  const topicRows = request.topicId
    ? db.prepare(`WITH RECURSIVE nested(id) AS (SELECT ? UNION ALL SELECT t.id FROM study_topics t JOIN nested n ON t.parent_id=n.id) SELECT id FROM nested`).all(request.topicId) as Array<{ id: string }>
    : db.prepare(`WITH RECURSIVE folders(id) AS (SELECT ? UNION ALL SELECT f.id FROM study_folders f JOIN folders p ON f.parent_id=p.id)
      SELECT t.id FROM study_topics t WHERE t.folder_id IN (SELECT id FROM folders)`).all(request.folderId) as Array<{ id: string }>;
  const topicIds = topicRows.map((row) => String(row.id));
  const folderRows = request.folderId
    ? db.prepare(`WITH RECURSIVE folders(id) AS (SELECT ? UNION ALL SELECT f.id FROM study_folders f JOIN folders p ON f.parent_id=p.id) SELECT id FROM folders`).all(request.folderId) as Array<{ id: string }>
    : [];
  const folderIds = folderRows.map((row) => String(row.id));
  const where: string[] = []; const params: string[] = [];
  if (topicIds.length) { where.push(`topic_id IN (${topicIds.map(() => '?').join(',')})`); params.push(...topicIds); }
  if (folderIds.length) { where.push(`folder_id IN (${folderIds.map(() => '?').join(',')})`); params.push(...folderIds); }
  if (!where.length) return request.sourceKeys.length ? request.sourceKeys : ['__empty_scope__'];
  const clause = where.join(' OR ');
  const docs = (db.prepare(`SELECT DISTINCT document_id id FROM study_placements WHERE deleted_at IS NULL AND (${clause})`).all(...params) as Array<{ id: string }>).map((row) => `document:${row.id}`);
  const materials = (db.prepare(`SELECT DISTINCT material_id id FROM study_material_placements WHERE deleted_at IS NULL AND (${clause})`).all(...params) as Array<{ id: string }>).map((row) => `material:${row.id}`);
  const transcripts = topicIds.length ? (db.prepare(`SELECT DISTINCT t.id FROM study_transcripts t JOIN study_recordings r ON r.id=t.recording_id WHERE r.topic_id IN (${topicIds.map(() => '?').join(',')}) AND t.status='ready'`).all(...topicIds) as Array<{ id: string }>).map((row) => `transcript:${row.id}`) : [];
  const keys = [...new Set([...request.sourceKeys, ...docs, ...materials, ...transcripts])];
  return keys.length ? keys : ['__empty_scope__'];
}

function queryFor(request: StudyQuestionGenerationRequest): string {
  return [request.selection, ...(request.weakConcepts ?? []), 'conceptos principales relaciones definiciones aplicaciones']
    .filter(Boolean).join(' ').slice(0, 1200);
}

interface QuestionPromptSource { id: string; title: string; type: string; location: unknown; exactFragment: string }

const STUDY_QUESTION_SCAFFOLD: Record<PromptLanguage, { conceptMap: string; studentSelection: string }> = {
  es: { conceptMap: 'MAPA CONCEPTUAL DE LA ASIGNATURA', studentSelection: 'Selección del alumno' },
  en: { conceptMap: 'SUBJECT CONCEPT MAP', studentSelection: 'Student selection' },
  fr: { conceptMap: 'CARTE CONCEPTUELLE DE LA MATIÈRE', studentSelection: 'Sélection de l’étudiant' },
  de: { conceptMap: 'BEGRIFFSKARTE DES FACHES', studentSelection: 'Auswahl des Lernenden' },
  pt: { conceptMap: 'MAPA CONCEPTUAL DA DISCIPLINA', studentSelection: 'Seleção do estudante' },
  'pt-BR': { conceptMap: 'MAPA CONCEITUAL DA DISCIPLINA', studentSelection: 'Seleção do estudante' },
  it: { conceptMap: 'MAPPA CONCETTUALE DELLA MATERIA', studentSelection: 'Selezione dello studente' },
  tr: { conceptMap: 'DERS KAVRAM HARİTASI', studentSelection: 'Öğrenci seçimi' },
  'zh-Hans': { conceptMap: '学科概念图', studentSelection: '学生选择' },
  'zh-Hant': { conceptMap: '學科概念圖', studentSelection: '學生選擇' },
  vi: { conceptMap: 'SƠ ĐỒ KHÁI NIỆM MÔN HỌC', studentSelection: 'Lựa chọn của học viên' },
  ja: { conceptMap: '科目の概念マップ', studentSelection: '学生の選択' },
  ru: { conceptMap: 'КАРТА ПОНЯТИЙ ПРЕДМЕТА', studentSelection: 'Выбор студента' },
  uk: { conceptMap: 'КАРТА ПОНЯТЬ ПРЕДМЕТА', studentSelection: 'Вибір студента' },
  ko: { conceptMap: '교과 개념 지도', studentSelection: '학생 선택' },
};

export function studyQuestionGenerationTask(types: StudyQuestionGenerationRequest['types']): 'questions' | 'flashcards' {
  return types.length === 1 && types[0] === 'definition' ? 'flashcards' : 'questions';
}

function sourcePayload(entries: StudySearchIndexEntry[], selection: string | undefined, language: PromptLanguage): QuestionPromptSource[] {
  const sources: QuestionPromptSource[] = entries.map((entry, index) => {
    const compressed = compressStudyAssistantEvidence(entry.text, queryFor({ sourceKeys: [], count: 1, difficulty: 'medium', cognitiveLevels: [], types: [], selection }), 4200);
    return { id: `S${index + 1}`, title: entry.title, type: entry.kind, location: entry.location, exactFragment: compressed.text };
  });
  if (selection?.trim()) sources.unshift({ id: 'S0', title: STUDY_QUESTION_SCAFFOLD[language].studentSelection, type: 'selection', location: {}, exactFragment: selection.trim().slice(0, 8000) });
  return sources;
}

const PROMPT_COPY = {
  es: { role: 'Creas preguntas tipo test a partir de materiales de estudio.', developmentRole: 'Creas preguntas de desarrollo breve para comprobar la comprensión de los conceptos clave.', source: 'CONTENIDO INDEXADO', custom: 'INDICACIONES ADICIONALES', grounding: 'Usa solamente el contenido proporcionado. No inventes datos y evita preguntas repetidas o ambiguas.', development: (count: number) => `Genera exactamente ${count} preguntas. Tras cada pregunta incluye una respuesta modelo breve y suficiente para corregirla.`, test: (count: number, options: number) => `Genera exactamente ${count} preguntas con ${options} respuestas cada una. Solo una debe ser correcta. Las respuestas incorrectas deben ser creíbles.`, rules: 'Devuelve solo las preguntas. No añadas introducciones, numeración, Markdown, bloques de código ni explicaciones.', format: 'Formato obligatorio para cada pregunta', question: 'Aquí va la pregunta', correct: 'Respuesta correcta', incorrect: 'Respuesta incorrecta' },
  en: { role: 'Create multiple-choice questions from study materials.', developmentRole: 'Create short-answer questions that check understanding of the key concepts.', source: 'INDEXED CONTENT', custom: 'ADDITIONAL INSTRUCTIONS', grounding: 'Use only the provided content. Do not invent facts, and avoid repeated or ambiguous questions.', development: (count: number) => `Generate exactly ${count} questions. After each question, include a concise model answer that is sufficient for grading.`, test: (count: number, options: number) => `Generate exactly ${count} questions with ${options} answers each. Only one answer may be correct. The incorrect answers must be plausible.`, rules: 'Return only the questions. Do not add an introduction, numbering, Markdown, code fences, or explanations.', format: 'Required format for every question', question: 'Question goes here', correct: 'Correct answer', incorrect: 'Incorrect answer' },
  fr: { role: 'Crée des questions à choix multiple à partir des supports de cours.', developmentRole: 'Crée des questions à réponse courte pour vérifier la compréhension des concepts clés.', source: 'CONTENU INDEXÉ', custom: 'CONSIGNES SUPPLÉMENTAIRES', grounding: 'Utilise uniquement le contenu fourni. N’invente aucune information et évite les questions répétitives ou ambiguës.', development: (count: number) => `Génère exactement ${count} questions. Après chaque question, ajoute une réponse modèle courte et suffisante pour la correction.`, test: (count: number, options: number) => `Génère exactement ${count} questions avec ${options} réponses chacune. Une seule réponse doit être correcte. Les réponses incorrectes doivent être plausibles.`, rules: 'Renvoie uniquement les questions. N’ajoute ni introduction, ni numérotation, ni Markdown, ni bloc de code, ni explication.', format: 'Format obligatoire pour chaque question', question: 'La question apparaît ici', correct: 'Réponse correcte', incorrect: 'Réponse incorrecte' },
  tr: { role: 'Ders materyallerinden çoktan seçmeli sorular oluştur.', developmentRole: 'Temel kavramların anlaşılıp anlaşılmadığını ölçen kısa yanıtlı sorular oluştur.', source: 'DİZİNE EKLENMİŞ İÇERİK', custom: 'EK TALİMATLAR', grounding: 'Yalnızca verilen içeriği kullan. Bilgi uydurma, tekrarlanan veya belirsiz sorulardan kaçın.', development: (count: number) => `Tam olarak ${count} soru oluştur. Her sorudan sonra değerlendirme için yeterli, kısa bir örnek yanıt ekle.`, test: (count: number, options: number) => `Her biri ${options} yanıt içeren tam olarak ${count} soru oluştur. Yalnızca bir yanıt doğru olmalı. Yanlış yanıtlar inandırıcı olmalı.`, rules: 'Yalnızca soruları döndür. Giriş, numaralandırma, Markdown, kod bloğu veya açıklama ekleme.', format: 'Her soru için zorunlu biçim', question: 'Soru buraya yazılır', correct: 'Doğru yanıt', incorrect: 'Yanlış yanıt' },
  'zh-Hans': { role: '根据学习材料创建多项选择题。', developmentRole: '创建简答题，以检验对关键概念的理解。', source: '已索引的内容', custom: '附加指示', grounding: '仅使用所提供的内容。不要编造事实，并避免重复或含糊的问题。', development: (count: number) => `请生成恰好 ${count} 道题。每道题后附上一个简短、足以用于评分的参考答案。`, test: (count: number, options: number) => `请生成恰好 ${count} 道题，每题有 ${options} 个答案。只有一个答案正确。错误答案必须具有迷惑性。`, rules: '只返回题目。不要添加引言、编号、Markdown、代码块或解释。', format: '每道题的强制格式', question: '问题写在这里', correct: '正确答案', incorrect: '错误答案' },
  'zh-Hant': { role: '根據學習材料建立選擇題。', developmentRole: '建立簡答題，以檢驗對關鍵概念的理解。', source: '已索引的內容', custom: '附加指示', grounding: '僅使用所提供的內容。不要編造事實，並避免重複或含糊的問題。', development: (count: number) => `請產生恰好 ${count} 道題。每道題後附上簡短、足以用於評分的參考答案。`, test: (count: number, options: number) => `請產生恰好 ${count} 道題，每題有 ${options} 個答案。只有一個答案正確。錯誤答案必須具有說服力。`, rules: '只回傳題目。不要加入引言、編號、Markdown、程式碼區塊或解釋。', format: '每道題的強制格式', question: '問題寫在這裡', correct: '正確答案', incorrect: '錯誤答案' },
  vi: { role: 'Tạo câu hỏi trắc nghiệm từ tài liệu học tập.', developmentRole: 'Tạo câu hỏi trả lời ngắn để kiểm tra mức độ hiểu các khái niệm then chốt.', source: 'NỘI DUNG ĐÃ ĐƯỢC LẬP CHỈ MỤC', custom: 'CHỈ DẪN BỔ SUNG', grounding: 'Chỉ dùng nội dung được cung cấp. Không bịa đặt dữ kiện và tránh các câu hỏi trùng lặp hoặc mơ hồ.', development: (count: number) => `Tạo đúng ${count} câu hỏi. Sau mỗi câu hỏi, thêm một câu trả lời mẫu ngắn gọn, đủ để chấm điểm.`, test: (count: number, options: number) => `Tạo đúng ${count} câu hỏi, mỗi câu có ${options} câu trả lời. Chỉ một câu trả lời được đúng. Các câu trả lời sai phải có vẻ hợp lý.`, rules: 'Chỉ trả về các câu hỏi. Không thêm phần mở đầu, số thứ tự, Markdown, khối mã hay giải thích.', format: 'Định dạng bắt buộc cho mỗi câu hỏi', question: 'Câu hỏi nằm ở đây', correct: 'Câu trả lời đúng', incorrect: 'Câu trả lời sai' },
  ja: { role: '学習資料から多肢選択問題を作成します。', developmentRole: '主要な概念の理解を確認する短答式問題を作成します。', source: '索引付けされた内容', custom: '追加の指示', grounding: '提供された内容のみを使用してください。事実を捏造せず、繰り返しや曖昧な質問を避けてください。', development: (count: number) => `ちょうど ${count} 問を生成してください。各質問の後に、採点に十分な簡潔な模範解答を付けてください。`, test: (count: number, options: number) => `それぞれ ${options} 個の選択肢を持つ質問をちょうど ${count} 問生成してください。正解は 1 つだけにしてください。不正解の選択肢はもっともらしくしてください。`, rules: '質問のみを返してください。導入、番号付け、Markdown、コードブロック、説明を加えないでください。', format: '各質問の必須形式', question: 'ここに質問を記入', correct: '正解', incorrect: '不正解' },
  ru: { role: 'Создавайте тестовые вопросы с вариантами ответов на основе учебных материалов.', developmentRole: 'Создавайте вопросы с кратким ответом для проверки понимания ключевых понятий.', source: 'ИНДЕКСИРОВАННОЕ СОДЕРЖАНИЕ', custom: 'ДОПОЛНИТЕЛЬНЫЕ УКАЗАНИЯ', grounding: 'Используйте только предоставленное содержание. Не выдумывайте факты и избегайте повторяющихся или двусмысленных вопросов.', development: (count: number) => `Сгенерируйте ровно ${count} вопросов. После каждого вопроса добавьте краткий образцовый ответ, достаточный для проверки.`, test: (count: number, options: number) => `Сгенерируйте ровно ${count} вопросов, в каждом ${options} ответов. Правильным должен быть только один. Неправильные ответы должны быть правдоподобными.`, rules: 'Верните только вопросы. Не добавляйте вступление, нумерацию, Markdown, блоки кода или пояснения.', format: 'Обязательный формат для каждого вопроса', question: 'Здесь размещается вопрос', correct: 'Правильный ответ', incorrect: 'Неправильный ответ' },
  uk: { role: 'Створюйте тестові запитання з варіантами відповідей на основі навчальних матеріалів.', developmentRole: 'Створюйте запитання з короткою відповіддю для перевірки розуміння ключових понять.', source: 'ПРОІНДЕКСОВАНИЙ ЗМІСТ', custom: 'ДОДАТКОВІ ВКАЗІВКИ', grounding: 'Використовуйте лише наданий зміст. Не вигадуйте факти й уникайте повторюваних або двозначних запитань.', development: (count: number) => `Згенеруйте рівно ${count} запитань. Після кожного запитання додайте стислу зразкову відповідь, достатню для оцінювання.`, test: (count: number, options: number) => `Згенеруйте рівно ${count} запитань, у кожному ${options} відповідей. Правильною має бути лише одна. Неправильні відповіді мають бути правдоподібними.`, rules: 'Поверніть лише запитання. Не додавайте вступ, нумерацію, Markdown, блоки коду чи пояснення.', format: 'Обов’язковий формат для кожного запитання', question: 'Тут розміщується запитання', correct: 'Правильна відповідь', incorrect: 'Неправильна відповідь' },
  ko: { role: '학습 자료에서 객관식 문제를 만드십시오.', developmentRole: '핵심 개념의 이해를 확인하는 단답형 문제를 만드십시오.', source: '색인된 콘텐츠', custom: '추가 지침', grounding: '제공된 내용만 사용하십시오. 사실을 날조하지 말고 반복되거나 모호한 질문을 피하십시오.', development: (count: number) => `정확히 ${count}개의 문제를 생성하십시오. 각 문제 뒤에 채점에 충분한 간결한 모범 답안을 포함하십시오.`, test: (count: number, options: number) => `각각 ${options}개의 답이 있는 문제를 정확히 ${count}개 생성하십시오. 정답은 하나뿐이어야 합니다. 오답은 그럴듯해야 합니다.`, rules: '문제만 반환하십시오. 도입부, 번호 매기기, Markdown, 코드 블록 또는 설명을 추가하지 마십시오.', format: '각 문제의 필수 형식', question: '여기에 문제를 입력', correct: '정답', incorrect: '오답' },
  de: { role: 'Erstelle Multiple-Choice-Fragen aus Lernmaterialien.', developmentRole: 'Erstelle kurze Freitextfragen, um das Verständnis der Schlüsselkonzepte zu überprüfen.', source: 'INDEXIERTER INHALT', custom: 'ZUSÄTZLICHE ANWEISUNGEN', grounding: 'Verwende ausschließlich den bereitgestellten Inhalt. Erfinde keine Fakten und vermeide wiederholte oder mehrdeutige Fragen.', development: (count: number) => `Erstelle genau ${count} Fragen. Füge nach jeder Frage eine kurze Musterantwort hinzu, die für die Bewertung ausreicht.`, test: (count: number, options: number) => `Erstelle genau ${count} Fragen mit jeweils ${options} Antworten. Nur eine Antwort darf richtig sein. Die falschen Antworten müssen plausibel sein.`, rules: 'Gib nur die Fragen zurück. Füge keine Einleitung, Nummerierung, Markdown, Codeblöcke oder Erklärungen hinzu.', format: 'Pflichtformat für jede Frage', question: 'Hier steht die Frage', correct: 'Richtige Antwort', incorrect: 'Falsche Antwort' },
  pt: { role: 'Cria perguntas de escolha múltipla a partir de materiais de estudo.', developmentRole: 'Cria perguntas de resposta curta para verificar a compreensão dos conceitos-chave.', source: 'CONTEÚDO INDEXADO', custom: 'INSTRUÇÕES ADICIONAIS', grounding: 'Utiliza apenas o conteúdo fornecido. Não inventes factos e evita perguntas repetidas ou ambíguas.', development: (count: number) => `Gera exatamente ${count} perguntas. Depois de cada pergunta, inclui uma resposta-modelo breve e suficiente para a correção.`, test: (count: number, options: number) => `Gera exatamente ${count} perguntas com ${options} respostas cada. Apenas uma resposta deve estar correta. As respostas incorretas devem ser plausíveis.`, rules: 'Devolve apenas as perguntas. Não acrescentes introdução, numeração, Markdown, blocos de código nem explicações.', format: 'Formato obrigatório para cada pergunta', question: 'A pergunta vai aqui', correct: 'Resposta correta', incorrect: 'Resposta incorreta' },
  'pt-BR': { role: 'Crie perguntas de múltipla escolha a partir de materiais de estudo.', developmentRole: 'Crie perguntas de resposta curta para verificar a compreensão dos conceitos-chave.', source: 'CONTEÚDO INDEXADO', custom: 'INSTRUÇÕES ADICIONAIS', grounding: 'Use apenas o conteúdo fornecido. Não invente fatos e evite perguntas repetidas ou ambíguas.', development: (count: number) => `Gere exatamente ${count} perguntas. Depois de cada pergunta, inclua uma resposta-modelo breve e suficiente para a correção.`, test: (count: number, options: number) => `Gere exatamente ${count} perguntas com ${options} respostas cada uma. Apenas uma resposta deve estar correta. As respostas incorretas devem ser plausíveis.`, rules: 'Devolva apenas as perguntas. Não acrescente introdução, numeração, Markdown, blocos de código nem explicações.', format: 'Formato obrigatório para cada pergunta', question: 'A pergunta vai aqui', correct: 'Resposta correta', incorrect: 'Resposta incorreta' },
  it: { role: 'Crea domande a scelta multipla a partire dai materiali di studio.', developmentRole: 'Crea domande a risposta breve per verificare la comprensione dei concetti chiave.', source: 'CONTENUTO INDICIZZATO', custom: 'ISTRUZIONI AGGIUNTIVE', grounding: 'Usa esclusivamente il contenuto fornito. Non inventare informazioni ed evita domande ripetitive o ambigue.', development: (count: number) => `Genera esattamente ${count} domande. Dopo ogni domanda, includi una risposta modello breve e sufficiente per la correzione.`, test: (count: number, options: number) => `Genera esattamente ${count} domande con ${options} risposte ciascuna. Deve esserci una sola risposta corretta. Le risposte errate devono essere plausibili.`, rules: 'Restituisci soltanto le domande. Non aggiungere introduzioni, numerazione, Markdown, blocchi di codice o spiegazioni.', format: 'Formato obbligatorio per ogni domanda', question: 'Inserisci qui la domanda', correct: 'Risposta corretta', incorrect: 'Risposta errata' },
} as const;

const CONCEPT_MAP_RULE = {
  es: 'El mapa conceptual sirve para elegir qué evaluar, pero no es evidencia. Toda respuesta correcta y todo distractor deben poder verificarse en CONTENIDO INDEXADO.',
  en: 'The concept map helps choose what to assess, but it is not evidence. Every correct answer and distractor must be verifiable in INDEXED CONTENT.',
  fr: 'La carte conceptuelle sert à choisir ce qui sera évalué, mais ne constitue pas une preuve. Toute bonne réponse et tout distracteur doivent pouvoir être vérifiés dans le CONTENU INDEXÉ.',
  tr: 'Kavram haritası neyin değerlendirileceğini seçmeye yarar, ancak kanıt değildir. Her doğru yanıt ve çeldirici DİZİNE EKLENMİŞ İÇERİK içinde doğrulanabilmelidir.',
  'zh-Hans': '概念图有助于选择评估内容，但它不是证据。每个正确答案和干扰项都必须能在已索引的内容中核实。',
  'zh-Hant': '概念圖有助於選擇評估內容，但它不是證據。每個正確答案和誘答選項都必須能在已索引的內容中核實。',
  vi: 'Sơ đồ khái niệm giúp chọn nội dung cần đánh giá, nhưng nó không phải là bằng chứng. Mọi câu trả lời đúng và mọi phương án nhiễu đều phải kiểm chứng được trong NỘI DUNG ĐÃ ĐƯỢC LẬP CHỈ MỤC.',
  ja: '概念マップは何を評価するかを選ぶ助けにはなりますが、根拠ではありません。正解と誤答選択肢はすべて、索引付けされた内容の中で検証可能でなければなりません。',
  ru: 'Карта понятий помогает выбрать, что оценивать, но не является доказательством. Каждый правильный ответ и каждый отвлекающий вариант должны быть проверяемы в ИНДЕКСИРОВАННОМ СОДЕРЖИМОМ.',
  uk: 'Карта понять допомагає вибрати, що оцінювати, але не є доказом. Кожна правильна відповідь і кожен варіант-відволікач мають бути перевірюваними в ПРОІНДЕКСОВАНОМУ ЗМІСТІ.',
  ko: '개념 지도는 무엇을 평가할지 선택하는 데 도움이 되지만 증거는 아닙니다. 모든 정답과 오답 선택지는 색인된 콘텐츠에서 검증 가능해야 합니다.',
  de: 'Die Konzeptkarte hilft bei der Auswahl der Prüfungsinhalte, ist aber kein Beleg. Jede richtige Antwort und jeder Distraktor muss im INDEXIERTEN INHALT überprüfbar sein.',
  pt: 'O mapa conceptual ajuda a escolher o que avaliar, mas não é evidência. Todas as respostas corretas e todos os distratores devem poder ser verificados no CONTEÚDO INDEXADO.',
  'pt-BR': 'O mapa conceitual ajuda a escolher o que avaliar, mas não é evidência. Toda resposta correta e todo distrator deve poder ser verificado no CONTEÚDO INDEXADO.',
  it: 'La mappa concettuale serve a scegliere cosa valutare, ma non è una prova. Ogni risposta corretta e ogni distrattore devono poter essere verificati nel CONTENUTO INDICIZZATO.',
} as const;

export function buildStudyQuestionPrompt(request: StudyQuestionGenerationRequest, sources: QuestionPromptSource[], knowledge?: StudyAssessmentKnowledgeContext, requestedLanguage?: PromptLanguage) {
  const count = Math.max(1, Math.min(40, Math.round(request.count)));
  const development = request.types.includes('essay');
  const optionCount = Math.max(2, Math.min(10, Math.round(request.optionCount ?? 4)));
  const language = requestedLanguage ?? getSettings().promptLanguage ?? 'es';
  const copy = PROMPT_COPY[language];
  return {
    system: `${development ? copy.developmentRole : copy.role}
${copy.grounding}
${CONCEPT_MAP_RULE[language] ?? CONCEPT_MAP_RULE.en}
${development ? copy.development(count) : copy.test(count, optionCount)}
${copy.rules}

${copy.format}
Q: ${copy.question}
* ${copy.correct}
${development ? '' : Array.from({ length: optionCount - 1 }, () => `- ${copy.incorrect}`).join('\n')}`,
    user: `${knowledge?.outline ? `${STUDY_QUESTION_SCAFFOLD[language].conceptMap}\n${knowledge.outline}\n\n` : ''}${copy.source}\n${sources.map((source) => `[${source.title}]\n${source.exactFragment}`).join('\n\n')}${request.customPrompt?.trim() ? `\n\n${copy.custom}\n${request.customPrompt.trim()}` : ''}`,
    count, optionCount, development,
  };
}

export function mergeStudyAssessmentKnowledgeContexts(contexts: StudyAssessmentKnowledgeContext[]): StudyAssessmentKnowledgeContext {
  const ideas = new Map(contexts.flatMap((context) => context.ideas).map((idea) => [idea.id, idea]));
  const connections = new Map(contexts.flatMap((context) => context.connections).map((edge) => [edge.id, edge]));
  return {
    ideas: [...ideas.values()],
    connections: [...connections.values()],
    outline: [...new Set(contexts.flatMap((context) => context.outline.split('\n')).filter(Boolean))].join('\n'),
    embeddingAvailable: contexts.some((context) => context.embeddingAvailable),
  };
}

function applySource(question: StudyQuestionInput, entries: StudySearchIndexEntry[], selection: string | undefined, language: PromptLanguage): StudyQuestionInput {
  if (!entries.length && selection?.trim()) return { ...question, source: { title: STUDY_QUESTION_SCAFFOLD[language].studentSelection, excerpt: selection.trim() } };
  const entry = [...entries].sort((a, b) => studyQuestionSimilarity(question.prompt, b.text) - studyQuestionSimilarity(question.prompt, a.text))[0];
  if (!entry) return question;
  const excerpt = compressStudyAssistantEvidence(entry.text, question.prompt, 2200).text;
  return {
    ...question,
    courseId: entry.scope.courseId ?? null, subjectId: entry.scope.subjectId ?? null, folderId: entry.scope.folderId ?? null, topicId: entry.scope.topicId ?? null,
    documentId: entry.kind === 'document' ? entry.sourceId : null,
    materialId: entry.kind === 'material' ? entry.sourceId : null,
    recordingId: entry.location.recordingId ?? null,
    transcriptId: entry.kind === 'transcript' ? entry.sourceId : null,
    source: { sourceKey: studyAssistantSourceKey(entry.kind, entry.sourceId), title: entry.title, excerpt, location: entry.location },
  };
}

export async function generateStudyQuestions(request: StudyQuestionGenerationRequest): Promise<StudyQuestionGenerationResult> {
  const aiSettings = getSettings();
  const language = aiSettings.promptLanguage ?? 'es';
  if (!request.types.length) throw new Error('Selecciona al menos un tipo de pregunta.');
  if (!request.cognitiveLevels.length) throw new Error('Selecciona al menos un nivel cognitivo.');
  // The prompt has only a development and a multiple-choice shape, so anything outside
  // STUDY_GENERATABLE_QUESTION_TYPES used to come back as a single_choice question under
  // the requested name. Refuse it instead of quietly substituting a different type.
  const unsupported = request.types.filter((type) => !(STUDY_GENERATABLE_QUESTION_TYPES as readonly string[]).includes(type));
  if (unsupported.length) throw new Error(`La generación con IA aún no admite estos tipos de pregunta: ${unsupported.join(', ')}. Créalos a mano en el banco de preguntas.`);
  const sourceKeys = nestedSourceKeys(request);
  const retrievalQuery = queryFor(request);
  const entries = await retrieveStudyAssistantEntries(retrievalQuery, searchOptions(request), sourceKeys, Math.min(80, Math.max(24, sourceKeys.length * 4)));
  const subjectIds = [...new Set([
    request.subjectId,
    ...entries.map((entry) => entry.scope.subjectId),
  ].filter((id): id is string => Boolean(id)))];
  const knowledgeContexts = await Promise.all(subjectIds.map((subjectId) => retrieveStudyKnowledgeContext(subjectId, retrievalQuery, sourceKeys)));
  const knowledge = knowledgeContexts.length ? mergeStudyAssessmentKnowledgeContexts(knowledgeContexts) : undefined;
  if (!entries.length && !request.selection?.trim()) throw new Error('No hay fuentes de estudio disponibles para generar preguntas.');
  const sources = sourcePayload(entries, request.selection, language);
  const prompt = buildStudyQuestionPrompt(request, sources, knowledge, language);
  const task = studyQuestionGenerationTask(request.types);
  const completed = await runStudyAiTask<string>({ task, explicitModel: request.model, subjectId: request.subjectId ?? (subjectIds.length === 1 ? subjectIds[0] : undefined), inputChars: prompt.system.length + prompt.user.length, outputChars: (value) => value.length },
    (model) => completeText({ system: prompt.system, user: prompt.user, temperature: aiSettings.studyAiTemperature, maxTokens: Math.min(aiSettings.studyAiMaxOutputTokens, Math.max(1800, prompt.count * prompt.optionCount * 90)), reasoning: 'off' }, model));
  const raw = prompt.development ? parseStudyDevelopmentQuestionBlocks(completed.value) : parseStudyQuestionBlocks(completed.value, prompt.optionCount); const model = completed.model;
  if (!raw.length) throw new Error('La IA no devolvió preguntas con el formato Q, * y - solicitado.');
  // The parsers name the FORMAT they read (development prose or multiple choice); this
  // names what the run was for. A flashcard run reads the multiple-choice format but is
  // a `definition` card, and recording that keeps it distinguishable from a test item.
  const generatedType = studyGeneratedQuestionType(request.types);
  // Deduplicate within the same type only. A definition flashcard and a single_choice
  // test question can legitimately cover one concept — they are different study artifacts
  // — so comparing across every type meant that generating a test first silently left a
  // later flashcard run with nothing to show for itself.
  const existing = listStudyQuestions({ archived: true }).filter((question) => question.type === generatedType);
  const accepted: StudyQuestionInput[] = []; let rejectedDuplicates = 0;
  for (const normalized of raw) {
    const duplicate = findSimilarStudyQuestion(normalized.prompt, [
      ...existing,
      ...accepted.map((question, index) => ({ id: `new-${index}`, prompt: question.prompt })),
    ]);
    if (duplicate) { rejectedDuplicates += 1; continue; }
    accepted.push({
      ...applySource(normalized, entries, request.selection, language),
      type: generatedType,
      difficulty: request.difficulty === 'mixed' ? normalized.difficulty : request.difficulty,
      courseId: request.courseId ?? normalized.courseId ?? null,
      subjectId: request.subjectId ?? normalized.subjectId ?? null,
      folderId: request.folderId ?? normalized.folderId ?? null,
      topicId: request.topicId ?? normalized.topicId ?? null,
      model,
      generationPrompt: JSON.stringify({ format: prompt.development ? 'Q-star-development' : 'Q-star-dash', optionCount: prompt.development ? 0 : prompt.optionCount, customPrompt: request.customPrompt ?? '', language: aiSettings.promptLanguage,
        knowledgeIdeaIds: knowledge?.ideas.map((idea) => idea.id) ?? [], knowledgeConnectionIds: knowledge?.connections.map((edge) => edge.id) ?? [] }),
    });
    if (accepted.length >= prompt.count) break;
  }
  return { questions: accepted, rejectedDuplicates, sourceCount: sources.length, ideaCount: knowledge?.ideas.length ?? 0, connectionCount: knowledge?.connections.length ?? 0, model };
}
