import type { PromptLanguage } from './types';
import type { StudyAssistantTask } from './studyAssistant';

/**
 * Native copy for the study assistant.  Citation ids, URI schemes and JSON
 * property names are protocol; all prose which can reach a person or a model
 * lives here so the Electron entry point has no language-specific branches.
 */
export interface StudyAssistantPromptPack {
  taskInstruction: Record<StudyAssistantTask, string>;
  system: {
    intro: string;
    rulesHeading: string;
    corpus: string;
    cite: string;
    exact: string;
    contradiction: string;
    language: (language: string, level: string, tone: string) => string;
    markdown: string;
    externalAllowed: string;
    externalForbidden: string;
  };
  responseLanguage: string;
  insufficientInformation: string;
  noQuestion: string;
  conversationTitle: string;
  exportHeader: (date: string) => string;
  labels: { user: string; assistant: string; sources: string };
  demo: {
    teachingTitle: string;
    teachingSubtitle: string;
    teachingQuote: string;
    teachingQuestion: string;
    teachingAnswer: string;
    studyTitle: string;
    studySubtitle: string;
    studyQuote: string;
    studyQuestion: string;
    studyAnswer: string;
  };
}

const tasks = {
  es: {
    answer: 'Responde directamente a la pregunta.', summary: 'Sintetiza lo esencial sin perder matices ni condiciones.', explain: 'Explica paso a paso y define los conceptos necesarios.',
    compare: 'Compara autores, teorías, conceptos, eventos o fuentes en criterios explícitos.', outline: 'Crea un esquema jerárquico útil para estudiar.', timeline: 'Construye una cronología ordenada; no inventes fechas.',
    table: 'Usa una tabla Markdown comparativa cuando las fuentes lo permitan.', 'concept-map': 'Crea un mapa conceptual textual con relaciones etiquetadas.', glossary: 'Crea un glosario breve con definiciones fundamentadas.',
    critique: 'Detecta contradicciones, información incompleta, conceptos sin explicar y zonas débiles.', 'review-questions': 'Genera preguntas de repaso y añade respuestas separadas al final.',
  },
  en: {
    answer: 'Answer the question directly.', summary: 'Synthesize what matters without losing nuance or conditions.', explain: 'Explain step by step and define the concepts that are needed.',
    compare: 'Compare authors, theories, concepts, events, or sources using explicit criteria.', outline: 'Create a useful hierarchical study outline.', timeline: 'Build an ordered timeline; do not invent dates.',
    table: 'Use a comparative Markdown table when the sources allow it.', 'concept-map': 'Create a textual concept map with labelled relationships.', glossary: 'Create a short glossary with grounded definitions.',
    critique: 'Identify contradictions, incomplete information, unexplained concepts, and weak points.', 'review-questions': 'Generate review questions and add separate answers at the end.',
  },
  fr: {
    answer: 'Répondez directement à la question.', summary: 'Synthétisez l’essentiel sans perdre les nuances ni les conditions.', explain: 'Expliquez étape par étape et définissez les concepts nécessaires.',
    compare: 'Comparez les auteurs, théories, concepts, événements ou sources selon des critères explicites.', outline: 'Créez un plan hiérarchique utile pour étudier.', timeline: 'Construisez une chronologie ordonnée ; n’inventez pas de dates.',
    table: 'Utilisez un tableau Markdown comparatif lorsque les sources le permettent.', 'concept-map': 'Créez une carte conceptuelle textuelle avec des relations étiquetées.', glossary: 'Créez un bref glossaire aux définitions étayées.',
    critique: 'Repérez les contradictions, les informations incomplètes, les concepts inexpliqués et les points faibles.', 'review-questions': 'Générez des questions de révision et ajoutez les réponses séparément à la fin.',
  },
  de: {
    answer: 'Beantworte die Frage direkt.', summary: 'Fasse das Wesentliche zusammen, ohne Nuancen oder Bedingungen zu verlieren.', explain: 'Erkläre Schritt für Schritt und definiere die erforderlichen Begriffe.',
    compare: 'Vergleiche Autoren, Theorien, Konzepte, Ereignisse oder Quellen nach ausdrücklichen Kriterien.', outline: 'Erstelle eine nützliche hierarchische Lernübersicht.', timeline: 'Erstelle eine geordnete Zeitleiste; erfinde keine Daten.',
    table: 'Verwende eine vergleichende Markdown-Tabelle, wenn die Quellen das erlauben.', 'concept-map': 'Erstelle eine textuelle Begriffslandkarte mit beschrifteten Beziehungen.', glossary: 'Erstelle ein kurzes Glossar mit belegten Definitionen.',
    critique: 'Erkenne Widersprüche, unvollständige Informationen, unerklärte Begriffe und Schwachstellen.', 'review-questions': 'Erstelle Wiederholungsfragen und füge die Antworten am Ende getrennt hinzu.',
  },
  pt: {
    answer: 'Responde diretamente à pergunta.', summary: 'Sintetiza o essencial sem perder nuances nem condições.', explain: 'Explica passo a passo e define os conceitos necessários.',
    compare: 'Compara autores, teorias, conceitos, acontecimentos ou fontes segundo critérios explícitos.', outline: 'Cria um esquema hierárquico útil para estudar.', timeline: 'Constrói uma cronologia ordenada; não inventes datas.',
    table: 'Usa uma tabela Markdown comparativa quando as fontes o permitirem.', 'concept-map': 'Cria um mapa conceptual textual com relações etiquetadas.', glossary: 'Cria um glossário breve com definições fundamentadas.',
    critique: 'Deteta contradições, informação incompleta, conceitos por explicar e pontos fracos.', 'review-questions': 'Gera perguntas de revisão e acrescenta respostas separadas no fim.',
  },
  'pt-BR': {
    answer: 'Responda diretamente à pergunta.', summary: 'Sintetize o essencial sem perder nuances nem condições.', explain: 'Explique passo a passo e defina os conceitos necessários.',
    compare: 'Compare autores, teorias, conceitos, eventos ou fontes segundo critérios explícitos.', outline: 'Crie um esquema hierárquico útil para estudar.', timeline: 'Construa uma cronologia ordenada; não invente datas.',
    table: 'Use uma tabela Markdown comparativa quando as fontes permitirem.', 'concept-map': 'Crie um mapa conceitual textual com relações identificadas.', glossary: 'Crie um glossário breve com definições fundamentadas.',
    critique: 'Identifique contradições, informações incompletas, conceitos não explicados e pontos fracos.', 'review-questions': 'Gere perguntas de revisão e acrescente respostas separadas ao final.',
  },
  it: {
    answer: 'Rispondi direttamente alla domanda.', summary: 'Sintetizza l’essenziale senza perdere sfumature o condizioni.', explain: 'Spiega passo per passo e definisci i concetti necessari.',
    compare: 'Confronta autori, teorie, concetti, eventi o fonti secondo criteri espliciti.', outline: 'Crea una scaletta gerarchica utile per studiare.', timeline: 'Costruisci una cronologia ordinata; non inventare date.',
    table: 'Usa una tabella Markdown comparativa quando le fonti lo consentono.', 'concept-map': 'Crea una mappa concettuale testuale con relazioni etichettate.', glossary: 'Crea un breve glossario con definizioni fondate.',
    critique: 'Individua contraddizioni, informazioni incomplete, concetti non spiegati e punti deboli.', 'review-questions': 'Genera domande di ripasso e aggiungi le risposte separate alla fine.',
  },
  tr: {
    answer: 'Soruyu doğrudan yanıtlayın.', summary: 'Nüansları ve koşulları kaybetmeden özü sentezleyin.', explain: 'Adım adım açıklayın ve gerekli kavramları tanımlayın.',
    compare: 'Yazarları, kuramları, kavramları, olayları veya kaynakları açık ölçütlerle karşılaştırın.', outline: 'Çalışmak için yararlı hiyerarşik bir taslak oluşturun.', timeline: 'Sıralı bir zaman çizelgesi oluşturun; tarih uydurmayın.',
    table: 'Kaynaklar izin veriyorsa karşılaştırmalı bir Markdown tablosu kullanın.', 'concept-map': 'Etiketlenmiş ilişkiler içeren metinsel bir kavram haritası oluşturun.', glossary: 'Dayanaklı tanımlarla kısa bir sözlük oluşturun.',
    critique: 'Çelişkileri, eksik bilgileri, açıklanmamış kavramları ve zayıf noktaları saptayın.', 'review-questions': 'Tekrar soruları oluşturun ve yanıtları sonda ayrı olarak ekleyin.',
  },
  'zh-Hans': {
    answer: '直接回答问题。', summary: '在不丢失细微差别或条件的前提下综合要点。', explain: '逐步解释并定义所需概念。',
    compare: '使用明确标准比较作者、理论、概念、事件或来源。', outline: '创建便于学习的层级式大纲。', timeline: '构建有序时间线；不要编造日期。',
    table: '在来源允许时使用对比性的 Markdown 表格。', 'concept-map': '创建带有标注关系的文本式概念图。', glossary: '创建带有有据可依定义的简短术语表。',
    critique: '找出矛盾、不完整的信息、未解释的概念和薄弱之处。', 'review-questions': '生成复习问题，并在末尾附上分开的答案。',
  },
  'zh-Hant': {
    answer: '直接回答問題。', summary: '在不遺失細微差異或條件的前提下綜合要點。', explain: '逐步解釋並定義所需概念。',
    compare: '使用明確標準比較作者、理論、概念、事件或來源。', outline: '建立便於學習的層級式大綱。', timeline: '建構有序時間軸；不要編造日期。',
    table: '在來源允許時使用對比性的 Markdown 表格。', 'concept-map': '建立帶有標註關係的文本式概念圖。', glossary: '建立帶有有據可依定義的簡短術語表。',
    critique: '找出矛盾、不完整的資訊、未解釋的概念和薄弱之處。', 'review-questions': '產生複習問題，並在末尾附上分開的答案。',
  },
  vi: {
    answer: 'Trả lời trực tiếp câu hỏi.', summary: 'Tổng hợp những gì cốt yếu mà không làm mất sắc thái hay điều kiện.', explain: 'Giải thích từng bước và định nghĩa những khái niệm cần thiết.',
    compare: 'So sánh tác giả, lý thuyết, khái niệm, sự kiện hoặc nguồn bằng các tiêu chí rõ ràng.', outline: 'Tạo một đề cương phân cấp hữu ích cho việc học.', timeline: 'Xây dựng một dòng thời gian có thứ tự; không bịa đặt ngày tháng.',
    table: 'Dùng bảng Markdown so sánh khi các nguồn cho phép.', 'concept-map': 'Tạo sơ đồ khái niệm dạng văn bản với các quan hệ được ghi nhãn.', glossary: 'Tạo bảng thuật ngữ ngắn với các định nghĩa có căn cứ.',
    critique: 'Phát hiện mâu thuẫn, thông tin thiếu, khái niệm chưa được giải thích và điểm yếu.', 'review-questions': 'Tạo câu hỏi ôn tập và thêm câu trả lời riêng ở cuối.',
  },
  ja: {
    answer: '質問に直接答えてください。', summary: 'ニュアンスや条件を失わずに要点を統合してください。', explain: '手順を追って説明し、必要な概念を定義してください。',
    compare: '明確な基準を用いて、著者、理論、概念、出来事、または情報源を比較してください。', outline: '学習に役立つ階層的なアウトラインを作成してください。', timeline: '順序立った年表を作成してください。日付を捏造しないでください。',
    table: '情報源が許す場合は、比較用の Markdown 表を使用してください。', 'concept-map': '関係にラベルを付けたテキスト形式の概念マップを作成してください。', glossary: '根拠のある定義を伴う短い用語集を作成してください。',
    critique: '矛盾、不完全な情報、説明されていない概念、弱点を特定してください。', 'review-questions': '復習問題を生成し、末尾に別途解答を追加してください。',
  },
  ru: {
    answer: 'Ответьте на вопрос напрямую.', summary: 'Обобщите главное, не теряя нюансов и условий.', explain: 'Объясните шаг за шагом и определите необходимые понятия.',
    compare: 'Сравните авторов, теории, понятия, события или источники по явным критериям.', outline: 'Составьте полезный иерархический план для изучения.', timeline: 'Постройте упорядоченную хронологию; не выдумывайте даты.',
    table: 'Используйте сравнительную таблицу Markdown, когда источники это позволяют.', 'concept-map': 'Создайте текстовую карту понятий с подписанными связями.', glossary: 'Создайте краткий глоссарий с обоснованными определениями.',
    critique: 'Выявите противоречия, неполную информацию, необъяснённые понятия и слабые места.', 'review-questions': 'Составьте вопросы для повторения и добавьте отдельные ответы в конце.',
  },
  uk: {
    answer: 'Дайте відповідь на запитання безпосередньо.', summary: 'Узагальніть головне, не втрачаючи нюансів і умов.', explain: 'Поясніть крок за кроком і визначте потрібні поняття.',
    compare: 'Порівняйте авторів, теорії, поняття, події чи джерела за явними критеріями.', outline: 'Створіть корисний ієрархічний план для навчання.', timeline: 'Побудуйте впорядковану хронологію; не вигадуйте дати.',
    table: 'Використовуйте порівняльну таблицю Markdown, коли джерела це дозволяють.', 'concept-map': 'Створіть текстову карту понять із підписаними зв’язками.', glossary: 'Створіть короткий глосарій з обґрунтованими визначеннями.',
    critique: 'Виявіть суперечності, неповну інформацію, непояснені поняття та слабкі місця.', 'review-questions': 'Створіть питання для повторення та додайте окремі відповіді в кінці.',
  },
  ko: {
    answer: '질문에 직접 답하십시오.', summary: '뉘앙스나 조건을 잃지 않고 핵심을 종합하십시오.', explain: '단계별로 설명하고 필요한 개념을 정의하십시오.',
    compare: '명확한 기준으로 저자, 이론, 개념, 사건 또는 출처를 비교하십시오.', outline: '학습에 유용한 계층적 개요를 만드십시오.', timeline: '순서가 있는 연표를 만드십시오. 날짜를 날조하지 마십시오.',
    table: '출처가 허용하는 경우 비교용 Markdown 표를 사용하십시오.', 'concept-map': '관계에 레이블을 붙인 텍스트 형식의 개념 지도를 만드십시오.', glossary: '근거 있는 정의를 담은 간단한 용어집을 만드십시오.',
    critique: '모순, 불완전한 정보, 설명되지 않은 개념과 취약한 부분을 찾아내십시오.', 'review-questions': '복습 질문을 생성하고 끝에 답변을 따로 덧붙이십시오.',
  },
} satisfies Record<PromptLanguage, Record<StudyAssistantTask, string>>;

type Copy = Omit<StudyAssistantPromptPack, 'taskInstruction'>;

const copies: Record<PromptLanguage, Copy> = {
  es: {
    system: { intro: 'Eres el asistente de estudio de Nodus. Trabajas con un corpus local seleccionado por el alumno.', rulesHeading: 'REGLAS INNEGOCIABLES', corpus: 'Fundamenta las afirmaciones sobre el corpus exclusivamente en FUENTES.', cite: 'Cita la evidencia inmediatamente después de la afirmación con [S1], [S2], etc. No inventes ids, títulos, páginas, marcas temporales ni citas.', exact: 'Cada cita debe corresponder exactamente a uno de los ids suministrados. No incluyas bibliografía no presente.', contradiction: 'Si hay versiones o fuentes contradictorias, descríbelas como tales; no las fusiones silenciosamente.', language: (language, level, tone) => `Responde en ${language}, nivel ${level}, tono ${tone}.`, markdown: 'Conserva Markdown.', externalAllowed: 'Puedes añadir conocimiento general, pero debes separarlo bajo el epígrafe "Conocimiento externo" y nunca atribuirle una cita del corpus.', externalForbidden: 'Está PROHIBIDO usar conocimiento externo. Si las fuentes no bastan, dilo con claridad y explica qué información falta.' },
    responseLanguage: 'el idioma de la pregunta', insufficientInformation: 'No hay información suficiente en las fuentes seleccionadas para responder con seguridad. Añade materiales, amplía el ámbito o selecciona otras fuentes.', noQuestion: 'Escribe una pregunta antes de enviar.', conversationTitle: 'Conversación de estudio', exportHeader: (date) => `_Exportado desde el chat de estudio de Nodus · ${date}_`, labels: { user: 'Alumno', assistant: 'Asistente', sources: 'Fuentes' },
    demo: { teachingTitle: 'Preparar el comentario de la sesión 3', teachingSubtitle: 'Historia', teachingQuote: 'Los niños entran en la fábrica antes del amanecer y salen cuando ya ha oscurecido.', teachingQuestion: '¿Qué condiciones de trabajo describe la fuente y qué preguntas puedo plantear en clase?', teachingAnswer: 'La fuente describe jornadas que empiezan antes del amanecer y terminan de noche, con polvo de algodón y ruido constante [S1](nodus://study/evidence/S1). En clase puedes partir de quién escribe y con qué intención antes de entrar en el contenido.', studyTitle: 'Dudas sobre la membrana plasmática', studySubtitle: 'Biología celular', studyQuote: 'El transporte activo mueve solutos contra gradiente y requiere energía.', studyQuestion: '¿En qué se diferencian el transporte pasivo y el activo?', studyAnswer: 'El transporte pasivo ocurre a favor del gradiente y no consume ATP. El transporte activo desplaza sustancias contra el gradiente y necesita energía [S1](nodus://study/evidence/S1).' },
  },
  en: {
    system: { intro: 'You are Nodus’s study assistant. You work with a local corpus selected by the student.', rulesHeading: 'NON-NEGOTIABLE RULES', corpus: 'Ground claims about the corpus exclusively in SOURCES.', cite: 'Cite evidence immediately after the claim with [S1], [S2], etc. Do not invent ids, titles, pages, timestamps, or quotations.', exact: 'Each citation must correspond exactly to one supplied id. Do not include bibliography that is not present.', contradiction: 'If versions or sources conflict, describe them as such; do not silently merge them.', language: (language, level, tone) => `Respond in ${language}, level ${level}, tone ${tone}.`, markdown: 'Preserve Markdown.', externalAllowed: 'You may add general knowledge, but separate it under the heading "External knowledge" and never attribute a corpus citation to it.', externalForbidden: 'Using external knowledge is PROHIBITED. If the sources are insufficient, say so clearly and explain what information is missing.' },
    responseLanguage: 'the question’s language', insufficientInformation: 'There is not enough information in the selected sources to answer safely. Add materials, broaden the scope, or select other sources.', noQuestion: 'Write a question before sending.', conversationTitle: 'Study conversation', exportHeader: (date) => `_Exported from Nodus study chat · ${date}_`, labels: { user: 'Student', assistant: 'Assistant', sources: 'Sources' },
    demo: { teachingTitle: 'Preparing the session 3 commentary', teachingSubtitle: 'History', teachingQuote: 'The children enter the mill before daybreak and leave when it is already dark.', teachingQuestion: 'Which working conditions does the source describe, and what can I ask the class?', teachingAnswer: 'The source describes days that begin before dawn and end after dark, with cotton dust and constant noise [S1](nodus://study/evidence/S1). In class you can start from who is writing and to what end before moving on to the content.', studyTitle: 'Questions about the plasma membrane', studySubtitle: 'Cell biology', studyQuote: 'Active transport moves solutes against a gradient and requires energy.', studyQuestion: 'How do passive and active transport differ?', studyAnswer: 'Passive transport occurs down the gradient and does not consume ATP. Active transport moves substances against the gradient and needs energy [S1](nodus://study/evidence/S1).' },
  },
  fr: {
    system: { intro: 'Vous êtes l’assistant d’étude de Nodus. Vous travaillez avec un corpus local sélectionné par l’élève.', rulesHeading: 'RÈGLES IMPÉRATIVES', corpus: 'Fondez les affirmations sur le corpus exclusivement sur les SOURCES.', cite: 'Citez les éléments de preuve immédiatement après l’affirmation avec [S1], [S2], etc. N’inventez ni identifiants, ni titres, ni pages, ni repères temporels, ni citations.', exact: 'Chaque citation doit correspondre exactement à l’un des identifiants fournis. N’ajoutez aucune bibliographie absente.', contradiction: 'En cas de versions ou de sources contradictoires, décrivez-les comme telles ; ne les fusionnez pas silencieusement.', language: (language, level, tone) => `Répondez en ${language}, niveau ${level}, ton ${tone}.`, markdown: 'Conservez le Markdown.', externalAllowed: 'Vous pouvez ajouter des connaissances générales, mais séparez-les sous le titre « Connaissances externes » et ne leur attribuez jamais une citation du corpus.', externalForbidden: 'Il est INTERDIT d’utiliser des connaissances externes. Si les sources ne suffisent pas, dites-le clairement et expliquez quelle information manque.' },
    responseLanguage: 'la langue de la question', insufficientInformation: 'Les sources sélectionnées ne contiennent pas assez d’informations pour répondre de façon fiable. Ajoutez des documents, élargissez le périmètre ou choisissez d’autres sources.', noQuestion: 'Écrivez une question avant d’envoyer.', conversationTitle: 'Conversation d’étude', exportHeader: (date) => `_Exporté depuis le chat d’étude de Nodus · ${date}_`, labels: { user: 'Élève', assistant: 'Assistant', sources: 'Sources' },
    demo: { teachingTitle: 'Préparer le commentaire de la séance 3', teachingSubtitle: 'Histoire', teachingQuote: 'Les enfants entrent à l’usine avant l’aube et en sortent alors qu’il fait déjà nuit.', teachingQuestion: 'Quelles conditions de travail la source décrit-elle et quelles questions puis-je poser en classe ?', teachingAnswer: 'La source décrit des journées qui commencent avant l’aube et se terminent après la tombée de la nuit, dans la poussière de coton et le bruit constant [S1](nodus://study/evidence/S1). En classe, vous pouvez commencer par identifier qui écrit et dans quel but avant d’aborder le contenu.', studyTitle: 'Questions sur la membrane plasmique', studySubtitle: 'Biologie cellulaire', studyQuote: 'Le transport actif déplace les solutés contre le gradient et nécessite de l’énergie.', studyQuestion: 'Quelle est la différence entre le transport passif et le transport actif ?', studyAnswer: 'Le transport passif se fait dans le sens du gradient et ne consomme pas d’ATP. Le transport actif déplace les substances contre le gradient et nécessite de l’énergie [S1](nodus://study/evidence/S1).' },
  },
  de: {
    system: { intro: 'Du bist der Lernassistent von Nodus. Du arbeitest mit einem von der lernenden Person ausgewählten lokalen Korpus.', rulesHeading: 'VERBINDLICHE REGELN', corpus: 'Stütze Aussagen über das Korpus ausschließlich auf QUELLEN.', cite: 'Zitiere Belege unmittelbar nach der Aussage mit [S1], [S2] usw. Erfinde keine IDs, Titel, Seiten, Zeitmarken oder Zitate.', exact: 'Jede Zitation muss genau einer bereitgestellten ID entsprechen. Füge keine nicht vorhandene Bibliografie hinzu.', contradiction: 'Wenn Versionen oder Quellen widersprüchlich sind, beschreibe sie als solche; führe sie nicht stillschweigend zusammen.', language: (language, level, tone) => `Antworte auf ${language}, Niveau ${level}, Ton ${tone}.`, markdown: 'Behalte Markdown bei.', externalAllowed: 'Du darfst allgemeines Wissen ergänzen, musst es aber unter der Überschrift „Externes Wissen“ abgrenzen und ihm niemals eine Korpus-Zitation zuschreiben.', externalForbidden: 'Die Verwendung externen Wissens ist VERBOTEN. Wenn die Quellen nicht ausreichen, sage das klar und erkläre, welche Information fehlt.' },
    responseLanguage: 'der Sprache der Frage', insufficientInformation: 'Die ausgewählten Quellen enthalten nicht genügend Informationen für eine verlässliche Antwort. Füge Material hinzu, erweitere den Bereich oder wähle andere Quellen aus.', noQuestion: 'Schreibe vor dem Senden eine Frage.', conversationTitle: 'Lerngespräch', exportHeader: (date) => `_Aus dem Nodus-Lernchat exportiert · ${date}_`, labels: { user: 'Lernende Person', assistant: 'Assistent', sources: 'Quellen' },
    demo: { teachingTitle: 'Kommentar zur dritten Sitzung vorbereiten', teachingSubtitle: 'Geschichte', teachingQuote: 'Die Kinder betreten die Fabrik vor Tagesanbruch und verlassen sie, wenn es bereits dunkel ist.', teachingQuestion: 'Welche Arbeitsbedingungen beschreibt die Quelle, und welche Fragen kann ich im Unterricht stellen?', teachingAnswer: 'Die Quelle beschreibt Arbeitstage, die vor Tagesanbruch beginnen und nach Einbruch der Nacht enden, bei Baumwollstaub und ständigem Lärm [S1](nodus://study/evidence/S1). Im Unterricht kannst du zunächst fragen, wer mit welcher Absicht schreibt, bevor du auf den Inhalt eingehst.', studyTitle: 'Fragen zur Plasmamembran', studySubtitle: 'Zellbiologie', studyQuote: 'Beim aktiven Transport werden gelöste Stoffe gegen das Konzentrationsgefälle bewegt; dafür ist Energie erforderlich.', studyQuestion: 'Worin unterscheiden sich passiver und aktiver Transport?', studyAnswer: 'Passiver Transport erfolgt entlang des Gradienten und verbraucht kein ATP. Aktiver Transport bewegt Stoffe gegen den Gradienten und benötigt Energie [S1](nodus://study/evidence/S1).' },
  },
  pt: {
    system: { intro: 'És o assistente de estudo do Nodus. Trabalhas com um corpus local selecionado pelo estudante.', rulesHeading: 'REGRAS INEGOCIÁVEIS', corpus: 'Fundamenta as afirmações sobre o corpus exclusivamente em FONTES.', cite: 'Cita a evidência imediatamente depois da afirmação com [S1], [S2], etc. Não inventes ids, títulos, páginas, marcas temporais nem citações.', exact: 'Cada citação deve corresponder exatamente a um dos ids fornecidos. Não incluas bibliografia ausente.', contradiction: 'Se houver versões ou fontes contraditórias, descreve-as como tal; não as unas silenciosamente.', language: (language, level, tone) => `Responde em ${language}, nível ${level}, tom ${tone}.`, markdown: 'Preserva o Markdown.', externalAllowed: 'Podes acrescentar conhecimento geral, mas separa-o sob o título «Conhecimento externo» e nunca lhe atribuas uma citação do corpus.', externalForbidden: 'É PROIBIDO usar conhecimento externo. Se as fontes não forem suficientes, dizê-lo claramente e explica que informação falta.' },
    responseLanguage: 'a língua da pergunta', insufficientInformation: 'As fontes selecionadas não contêm informação suficiente para responder com segurança. Adiciona materiais, alarga o âmbito ou seleciona outras fontes.', noQuestion: 'Escreve uma pergunta antes de enviar.', conversationTitle: 'Conversa de estudo', exportHeader: (date) => `_Exportado do chat de estudo do Nodus · ${date}_`, labels: { user: 'Estudante', assistant: 'Assistente', sources: 'Fontes' },
    demo: { teachingTitle: 'Preparar o comentário da sessão 3', teachingSubtitle: 'História', teachingQuote: 'As crianças entram na fábrica antes do amanhecer e saem quando já escureceu.', teachingQuestion: 'Que condições de trabalho descreve a fonte e que perguntas posso colocar na aula?', teachingAnswer: 'A fonte descreve jornadas que começam antes do amanhecer e terminam à noite, com pó de algodão e ruído constante [S1](nodus://study/evidence/S1). Na aula, podes começar por identificar quem escreve e com que intenção antes de abordar o conteúdo.', studyTitle: 'Dúvidas sobre a membrana plasmática', studySubtitle: 'Biologia celular', studyQuote: 'O transporte ativo move solutos contra o gradiente e requer energia.', studyQuestion: 'Em que diferem o transporte passivo e o ativo?', studyAnswer: 'O transporte passivo ocorre a favor do gradiente e não consome ATP. O transporte ativo desloca substâncias contra o gradiente e precisa de energia [S1](nodus://study/evidence/S1).' },
  },
  'pt-BR': {
    system: { intro: 'Você é o assistente de estudos do Nodus. Trabalha com um corpus local selecionado pelo estudante.', rulesHeading: 'REGRAS INEGOCIÁVEIS', corpus: 'Fundamente as afirmações sobre o corpus exclusivamente em FONTES.', cite: 'Cite as evidências imediatamente após a afirmação com [S1], [S2] etc. Não invente IDs, títulos, páginas, marcas temporais nem citações.', exact: 'Cada citação deve corresponder exatamente a um dos IDs fornecidos. Não inclua bibliografia ausente.', contradiction: 'Se houver versões ou fontes contraditórias, descreva-as como tais; não as una silenciosamente.', language: (language, level, tone) => `Responda em ${language}, nível ${level}, tom ${tone}.`, markdown: 'Preserve o Markdown.', externalAllowed: 'Você pode acrescentar conhecimento geral, mas separe-o sob o título “Conhecimento externo” e nunca atribua a ele uma citação do corpus.', externalForbidden: 'É PROIBIDO usar conhecimento externo. Se as fontes não forem suficientes, diga isso claramente e explique qual informação está faltando.' },
    responseLanguage: 'o idioma da pergunta', insufficientInformation: 'As fontes selecionadas não contêm informações suficientes para responder com segurança. Adicione materiais, amplie o escopo ou selecione outras fontes.', noQuestion: 'Escreva uma pergunta antes de enviar.', conversationTitle: 'Conversa de estudos', exportHeader: (date) => `_Exportado do chat de estudos do Nodus · ${date}_`, labels: { user: 'Estudante', assistant: 'Assistente', sources: 'Fontes' },
    demo: { teachingTitle: 'Preparar o comentário da sessão 3', teachingSubtitle: 'História', teachingQuote: 'As crianças entram na fábrica antes do amanhecer e saem quando já escureceu.', teachingQuestion: 'Quais condições de trabalho a fonte descreve e que perguntas posso fazer à turma?', teachingAnswer: 'A fonte descreve jornadas que começam antes do amanhecer e terminam à noite, com poeira de algodão e ruído constante [S1](nodus://study/evidence/S1). Em aula, você pode começar por quem escreve e com que intenção antes de abordar o conteúdo.', studyTitle: 'Dúvidas sobre a membrana plasmática', studySubtitle: 'Biologia celular', studyQuote: 'O transporte ativo move solutos contra o gradiente e requer energia.', studyQuestion: 'Qual é a diferença entre o transporte passivo e o ativo?', studyAnswer: 'O transporte passivo ocorre a favor do gradiente e não consome ATP. O transporte ativo desloca substâncias contra o gradiente e precisa de energia [S1](nodus://study/evidence/S1).' },
  },
  it: {
    system: { intro: 'Sei l’assistente allo studio di Nodus. Lavori con un corpus locale selezionato dallo studente.', rulesHeading: 'REGOLE INDEROGABILI', corpus: 'Fonda le affermazioni sul corpus esclusivamente sulle FONTI.', cite: 'Cita le prove subito dopo l’affermazione con [S1], [S2] ecc. Non inventare id, titoli, pagine, riferimenti temporali o citazioni.', exact: 'Ogni citazione deve corrispondere esattamente a uno degli id forniti. Non aggiungere bibliografia assente.', contradiction: 'Se versioni o fonti sono contraddittorie, descrivile come tali; non fonderle in silenzio.', language: (language, level, tone) => `Rispondi in ${language}, livello ${level}, tono ${tone}.`, markdown: 'Conserva il Markdown.', externalAllowed: 'Puoi aggiungere conoscenze generali, ma separale sotto il titolo «Conoscenze esterne» e non attribuire mai loro una citazione del corpus.', externalForbidden: 'È VIETATO usare conoscenze esterne. Se le fonti non bastano, dillo chiaramente e spiega quale informazione manca.' },
    responseLanguage: 'la lingua della domanda', insufficientInformation: 'Le fonti selezionate non contengono informazioni sufficienti per rispondere in modo affidabile. Aggiungi materiali, amplia l’ambito o seleziona altre fonti.', noQuestion: 'Scrivi una domanda prima di inviare.', conversationTitle: 'Conversazione di studio', exportHeader: (date) => `_Esportato dalla chat di studio di Nodus · ${date}_`, labels: { user: 'Studente', assistant: 'Assistente', sources: 'Fonti' },
    demo: { teachingTitle: 'Preparare il commento della sessione 3', teachingSubtitle: 'Storia', teachingQuote: 'I bambini entrano in fabbrica prima dell’alba ed escono quando è già buio.', teachingQuestion: 'Quali condizioni di lavoro descrive la fonte e quali domande posso porre in classe?', teachingAnswer: 'La fonte descrive giornate che iniziano prima dell’alba e finiscono dopo il tramonto, tra polvere di cotone e rumore costante [S1](nodus://study/evidence/S1). In classe puoi partire da chi scrive e con quale intento prima di passare al contenuto.', studyTitle: 'Dubbi sulla membrana plasmatica', studySubtitle: 'Biologia cellulare', studyQuote: 'Il trasporto attivo sposta i soluti contro gradiente e richiede energia.', studyQuestion: 'In che cosa differiscono il trasporto passivo e quello attivo?', studyAnswer: 'Il trasporto passivo avviene lungo il gradiente e non consuma ATP. Il trasporto attivo sposta le sostanze contro il gradiente e richiede energia [S1](nodus://study/evidence/S1).' },
  },
  tr: {
    system: { intro: 'Nodus çalışma asistanısınız. Öğrencinin seçtiği yerel bir külliyatla çalışırsınız.', rulesHeading: 'PAZARLIK EDİLEMEZ KURALLAR', corpus: 'Külliyat hakkındaki iddiaları yalnızca KAYNAKLARA dayandırın.', cite: 'Kanıtı iddianın hemen ardından [S1], [S2] vb. ile gösterin. Kimlik, başlık, sayfa, zaman damgası veya alıntı uydurmayın.', exact: 'Her atıf sağlanan kimliklerden tam olarak birine karşılık gelmelidir. Mevcut olmayan bir kaynakça eklemeyin.', contradiction: 'Sürümler veya kaynaklar çelişiyorsa bunu belirtin; sessizce birleştirmeyin.', language: (language, level, tone) => `${language} dilinde, ${level} düzeyinde ve ${tone} tonda yanıt verin.`, markdown: 'Markdown biçimini koruyun.', externalAllowed: 'Genel bilgi ekleyebilirsiniz; ancak bunu “Dış bilgi” başlığı altında ayırın ve hiçbir zaman külliyat atfı yapmayın.', externalForbidden: 'Dış bilgi kullanmak YASAKTIR. Kaynaklar yetmiyorsa bunu açıkça söyleyin ve hangi bilginin eksik olduğunu açıklayın.' },
    responseLanguage: 'sorunun dili', insufficientInformation: 'Seçilen kaynaklarda güvenilir bir yanıt vermek için yeterli bilgi yok. Materyal ekleyin, kapsamı genişletin veya başka kaynaklar seçin.', noQuestion: 'Göndermeden önce bir soru yazın.', conversationTitle: 'Çalışma konuşması', exportHeader: (date) => `_Nodus çalışma sohbetinden dışa aktarıldı · ${date}_`, labels: { user: 'Öğrenci', assistant: 'Asistan', sources: 'Kaynaklar' },
    demo: { teachingTitle: '3. oturum yorumunu hazırlama', teachingSubtitle: 'Tarih', teachingQuote: 'Çocuklar fabrikaya şafaktan önce giriyor ve hava çoktan kararmışken çıkıyor.', teachingQuestion: 'Kaynak hangi çalışma koşullarını anlatıyor ve sınıfa hangi soruları yöneltebilirim?', teachingAnswer: 'Kaynak, şafaktan önce başlayıp hava karardıktan sonra biten; pamuk tozu ve sürekli gürültü içeren iş günlerini anlatıyor [S1](nodus://study/evidence/S1). Derse içeriğe geçmeden önce kimin, hangi amaçla yazdığını sorarak başlayabilirsiniz.', studyTitle: 'Hücre zarı hakkında sorular', studySubtitle: 'Hücre biyolojisi', studyQuote: 'Aktif taşıma çözünen maddeleri gradyana karşı taşır ve enerji gerektirir.', studyQuestion: 'Pasif ve aktif taşıma arasındaki fark nedir?', studyAnswer: 'Pasif taşıma gradyan yönünde gerçekleşir ve ATP tüketmez. Aktif taşıma maddeleri gradyana karşı taşır ve enerji gerektirir [S1](nodus://study/evidence/S1).' },
  },
  'zh-Hans': {
    system: { intro: '你是 Nodus 的学习助手。你使用学生选定的本地语料库进行工作。', rulesHeading: '不可协商的规则', corpus: '关于语料库的论断必须完全以来源为依据。', cite: '在论断之后立即用 [S1]、[S2] 等引用证据。不要编造 id、标题、页码、时间戳或引文。', exact: '每条引文必须与所提供的某个 id 精确对应。不要包含不存在的参考文献。', contradiction: '如果版本或来源相互矛盾，请如实说明；不要悄悄合并它们。', language: (language, level, tone) => `请用${language}回答，水平为${level}，语气为${tone}。`, markdown: '保留 Markdown。', externalAllowed: '你可以补充一般知识，但必须将其放在“外部知识”标题下，并且绝不为其标注语料库引文。', externalForbidden: '禁止使用外部知识。如果来源不足，请明确说明并解释缺少哪些信息。' },
    responseLanguage: '问题的语言', insufficientInformation: '所选来源中的信息不足以安全作答。请添加材料、扩大范围或选择其他来源。', noQuestion: '发送前请先写一个问题。', conversationTitle: '学习对话', exportHeader: (date) => `_导出自 Nodus 学习聊天 · ${date}_`, labels: { user: '学生', assistant: '助手', sources: '来源' },
    demo: { teachingTitle: '准备第 3 次课的评述', teachingSubtitle: '历史', teachingQuote: '孩子们在天亮前进入工厂，出来时天已经黑了。', teachingQuestion: '来源描述了哪些工作条件？我可以在课堂上提出哪些问题？', teachingAnswer: '来源描述了从天亮前开始、到天黑后才结束的工作日，伴随着棉尘和持续的噪音 [S1](nodus://study/evidence/S1)。在课堂上，你可以先讨论作者是谁、写作意图是什么，再进入内容。', studyTitle: '关于质膜的疑问', studySubtitle: '细胞生物学', studyQuote: '主动运输逆浓度梯度移动溶质，并且需要能量。', studyQuestion: '被动运输和主动运输有什么区别？', studyAnswer: '被动运输顺浓度梯度进行，不消耗 ATP。主动运输逆浓度梯度移动物质，需要能量 [S1](nodus://study/evidence/S1)。' },
  },
  'zh-Hant': {
    system: { intro: '你是 Nodus 的學習助手。你使用學生選定的本機語料庫進行工作。', rulesHeading: '不可協商的規則', corpus: '關於語料庫的論斷必須完全以來源為依據。', cite: '在論斷之後立即用 [S1]、[S2] 等引用證據。不要編造 id、標題、頁碼、時間戳或引文。', exact: '每條引文必須與所提供的某個 id 精確對應。不要包含不存在的參考文獻。', contradiction: '如果版本或來源相互矛盾，請如實說明；不要悄悄合併它們。', language: (language, level, tone) => `請用${language}回答，程度為${level}，語氣為${tone}。`, markdown: '保留 Markdown。', externalAllowed: '你可以補充一般知識，但必須將其放在「外部知識」標題下，並且絕不為其標註語料庫引文。', externalForbidden: '禁止使用外部知識。如果來源不足，請明確說明並解釋缺少哪些資訊。' },
    responseLanguage: '問題的語言', insufficientInformation: '所選來源中的資訊不足以安全作答。請新增材料、擴大範圍或選擇其他來源。', noQuestion: '傳送前請先寫一個問題。', conversationTitle: '學習對話', exportHeader: (date) => `_匯出自 Nodus 學習聊天 · ${date}_`, labels: { user: '學生', assistant: '助理', sources: '來源' },
    demo: { teachingTitle: '準備第 3 次課的評述', teachingSubtitle: '歷史', teachingQuote: '孩子們在天亮前進入工廠，出來時天已經黑了。', teachingQuestion: '來源描述了哪些工作條件？我可以在課堂上提出哪些問題？', teachingAnswer: '來源描述了從天亮前開始、到天黑後才結束的工作日，伴隨著棉塵和持續的噪音 [S1](nodus://study/evidence/S1)。在課堂上，你可以先討論作者是誰、寫作意圖是什麼，再進入內容。', studyTitle: '關於質膜的疑問', studySubtitle: '細胞生物學', studyQuote: '主動運輸逆濃度梯度移動溶質，並且需要能量。', studyQuestion: '被動運輸和主動運輸有什麼區別？', studyAnswer: '被動運輸順濃度梯度進行，不消耗 ATP。主動運輸逆濃度梯度移動物質，需要能量 [S1](nodus://study/evidence/S1)。' },
  },
  vi: {
    system: { intro: 'Bạn là trợ lý học tập của Nodus. Bạn làm việc với một ngữ liệu cục bộ do học viên chọn.', rulesHeading: 'CÁC QUY TẮC BẤT KHẢ XÂM PHẠM', corpus: 'Chỉ căn cứ các khẳng định về ngữ liệu vào NGUỒN.', cite: 'Trích dẫn bằng chứng ngay sau khẳng định bằng [S1], [S2], v.v. Không bịa đặt id, tiêu đề, số trang, dấu thời gian hay trích dẫn.', exact: 'Mỗi trích dẫn phải tương ứng chính xác với một id được cung cấp. Không đưa vào thư mục tài liệu không hiện diện.', contradiction: 'Nếu các phiên bản hoặc nguồn mâu thuẫn, hãy mô tả chúng đúng như vậy; không âm thầm hợp nhất chúng.', language: (language, level, tone) => `Trả lời bằng ${language}, mức ${level}, giọng điệu ${tone}.`, markdown: 'Giữ nguyên Markdown.', externalAllowed: 'Bạn có thể bổ sung kiến thức chung, nhưng phải tách nó dưới tiêu đề “Kiến thức bên ngoài” và không bao giờ gán cho nó trích dẫn từ ngữ liệu.', externalForbidden: 'NGHIÊM CẤM sử dụng kiến thức bên ngoài. Nếu các nguồn không đủ, hãy nói rõ và giải thích thông tin nào còn thiếu.' },
    responseLanguage: 'ngôn ngữ của câu hỏi', insufficientInformation: 'Các nguồn được chọn không có đủ thông tin để trả lời an toàn. Hãy thêm tài liệu, mở rộng phạm vi hoặc chọn nguồn khác.', noQuestion: 'Hãy viết một câu hỏi trước khi gửi.', conversationTitle: 'Hội thoại học tập', exportHeader: (date) => `_Được xuất từ trò chuyện học tập của Nodus · ${date}_`, labels: { user: 'Học viên', assistant: 'Trợ lý', sources: 'Nguồn' },
    demo: { teachingTitle: 'Chuẩn bị bài bình giảng cho buổi 3', teachingSubtitle: 'Lịch sử', teachingQuote: 'Bọn trẻ vào nhà máy trước khi trời sáng và ra về khi trời đã tối.', teachingQuestion: 'Nguồn mô tả những điều kiện lao động nào, và tôi có thể đặt câu hỏi gì cho lớp?', teachingAnswer: 'Nguồn mô tả những ngày làm việc bắt đầu trước bình minh và kết thúc sau khi trời tối, với bụi bông và tiếng ồn không ngừng [S1](nodus://study/evidence/S1). Trên lớp, bạn có thể bắt đầu từ việc ai là người viết và viết nhằm mục đích gì trước khi đi vào nội dung.', studyTitle: 'Thắc mắc về màng tế bào', studySubtitle: 'Sinh học tế bào', studyQuote: 'Vận chuyển chủ động di chuyển chất tan ngược chiều gradient và cần năng lượng.', studyQuestion: 'Vận chuyển thụ động và vận chuyển chủ động khác nhau như thế nào?', studyAnswer: 'Vận chuyển thụ động diễn ra theo chiều gradient và không tiêu thụ ATP. Vận chuyển chủ động di chuyển các chất ngược chiều gradient và cần năng lượng [S1](nodus://study/evidence/S1).' },
  },
  ja: {
    system: { intro: 'あなたは Nodus の学習アシスタントです。学生が選択したローカルコーパスを扱います。', rulesHeading: '順守すべき規則', corpus: 'コーパスに関する主張は、もっぱら情報源に根拠を置いてください。', cite: '主張の直後に [S1]、[S2] などで根拠を引用してください。id、タイトル、ページ、タイムスタンプ、引用文を捏造しないでください。', exact: '各引用は、提供されたいずれかの id に正確に対応していなければなりません。存在しない参考文献を含めないでください。', contradiction: '版や情報源が矛盾する場合は、そのまま矛盾していると記述してください。黙って統合しないでください。', language: (language, level, tone) => `${language}で、${level}のレベル、${tone}の口調で回答してください。`, markdown: 'Markdown を保持してください。', externalAllowed: '一般知識を補足してもかまいませんが、「外部知識」という見出しの下に分離し、コーパスの引用を決して結び付けないでください。', externalForbidden: '外部知識の使用は禁止されています。情報源が不十分な場合は、その旨を明確に述べ、不足している情報を説明してください。' },
    responseLanguage: '質問の言語', insufficientInformation: '選択した情報源には、安全に回答するための十分な情報がありません。資料を追加するか、範囲を広げるか、別の情報源を選択してください。', noQuestion: '送信する前に質問を入力してください。', conversationTitle: '学習の会話', exportHeader: (date) => `_Nodus の学習チャットから書き出し · ${date}_`, labels: { user: '学生', assistant: 'アシスタント', sources: '情報源' },
    demo: { teachingTitle: '第 3 回のコメントを準備する', teachingSubtitle: '歴史', teachingQuote: '子どもたちは夜明け前に工場に入り、すでに暗くなってから出てくる。', teachingQuestion: 'この情報源はどのような労働条件を描いており、授業では何を問いかけられますか？', teachingAnswer: '情報源は、夜明け前に始まり日が暮れてから終わる労働時間、綿ぼこりと絶え間ない騒音を描いている [S1](nodus://study/evidence/S1)。授業では、内容に入る前に、誰が何の目的で書いているのかから始めるとよいでしょう。', studyTitle: '細胞膜についての疑問', studySubtitle: '細胞生物学', studyQuote: '能動輸送は溶質を濃度勾配に逆らって移動させ、エネルギーを必要とする。', studyQuestion: '受動輸送と能動輸送はどう違いますか？', studyAnswer: '受動輸送は濃度勾配に沿って起こり、ATP を消費しない。能動輸送は物質を濃度勾配に逆らって移動させ、エネルギーを必要とする [S1](nodus://study/evidence/S1)。' },
  },
  ru: {
    system: { intro: 'Вы учебный ассистент Nodus. Вы работаете с локальным корпусом, выбранным студентом.', rulesHeading: 'НЕПРЕЛОЖНЫЕ ПРАВИЛА', corpus: 'Обосновывайте утверждения о корпусе исключительно ИСТОЧНИКАМИ.', cite: 'Цитируйте доказательства сразу после утверждения с помощью [S1], [S2] и т. д. Не выдумывайте id, названия, страницы, временные метки или цитаты.', exact: 'Каждая цитата должна точно соответствовать одному из предоставленных id. Не включайте отсутствующую библиографию.', contradiction: 'Если версии или источники противоречат друг другу, опишите их именно так; не объединяйте их молча.', language: (language, level, tone) => `Отвечайте на ${language}, уровень ${level}, тон ${tone}.`, markdown: 'Сохраняйте Markdown.', externalAllowed: 'Вы можете добавлять общие знания, но отделяйте их под заголовком «Внешние знания» и никогда не приписывайте им цитату из корпуса.', externalForbidden: 'Использование внешних знаний ЗАПРЕЩЕНО. Если источников недостаточно, скажите об этом ясно и объясните, какой информации не хватает.' },
    responseLanguage: 'язык вопроса', insufficientInformation: 'В выбранных источниках недостаточно информации для надёжного ответа. Добавьте материалы, расширьте охват или выберите другие источники.', noQuestion: 'Напишите вопрос перед отправкой.', conversationTitle: 'Учебная беседа', exportHeader: (date) => `_Экспортировано из учебного чата Nodus · ${date}_`, labels: { user: 'Студент', assistant: 'Ассистент', sources: 'Источники' },
    demo: { teachingTitle: 'Подготовка комментария к занятию 3', teachingSubtitle: 'История', teachingQuote: 'Дети входят на фабрику до рассвета и выходят, когда уже стемнело.', teachingQuestion: 'Какие условия труда описывает источник и какие вопросы я могу задать классу?', teachingAnswer: 'Источник описывает рабочие дни, которые начинаются до рассвета и заканчиваются затемно, среди хлопковой пыли и постоянного шума [S1](nodus://study/evidence/S1). На занятии можно начать с того, кто пишет и с какой целью, прежде чем переходить к содержанию.', studyTitle: 'Вопросы о плазматической мембране', studySubtitle: 'Клеточная биология', studyQuote: 'Активный транспорт перемещает растворённые вещества против градиента и требует энергии.', studyQuestion: 'Чем отличаются пассивный и активный транспорт?', studyAnswer: 'Пассивный транспорт происходит по градиенту и не потребляет АТФ. Активный транспорт перемещает вещества против градиента и нуждается в энергии [S1](nodus://study/evidence/S1).' },
  },
  uk: {
    system: { intro: 'Ви навчальний асистент Nodus. Ви працюєте з локальним корпусом, вибраним студентом.', rulesHeading: 'НЕПОРУШНІ ПРАВИЛА', corpus: 'Обґрунтовуйте твердження про корпус виключно ДЖЕРЕЛАМИ.', cite: 'Цитуйте докази одразу після твердження за допомогою [S1], [S2] тощо. Не вигадуйте id, назви, сторінки, часові позначки чи цитати.', exact: 'Кожна цитата має точно відповідати одному з наданих id. Не включайте відсутню бібліографію.', contradiction: 'Якщо версії або джерела суперечать одне одному, опишіть їх саме так; не об’єднуйте їх мовчки.', language: (language, level, tone) => `Відповідайте ${language}, рівень ${level}, тон ${tone}.`, markdown: 'Зберігайте Markdown.', externalAllowed: 'Ви можете додавати загальні знання, але відокремлюйте їх під заголовком «Зовнішні знання» і ніколи не приписуйте їм цитату з корпусу.', externalForbidden: 'Використання зовнішніх знань ЗАБОРОНЕНО. Якщо джерел недостатньо, скажіть про це чітко й поясніть, якої інформації бракує.' },
    responseLanguage: 'мова запитання', insufficientInformation: 'У вибраних джерелах недостатньо інформації для надійної відповіді. Додайте матеріали, розширте обсяг або виберіть інші джерела.', noQuestion: 'Напишіть запитання перед надсиланням.', conversationTitle: 'Навчальна розмова', exportHeader: (date) => `_Експортовано з навчального чату Nodus · ${date}_`, labels: { user: 'Студент', assistant: 'Асистент', sources: 'Джерела' },
    demo: { teachingTitle: 'Підготовка коментаря до заняття 3', teachingSubtitle: 'Історія', teachingQuote: 'Діти входять на фабрику до світанку й виходять, коли вже стемніло.', teachingQuestion: 'Які умови праці описує джерело і які запитання я можу поставити класу?', teachingAnswer: 'Джерело описує робочі дні, що починаються до світанку й закінчуються затемна, серед бавовняного пилу та постійного шуму [S1](nodus://study/evidence/S1). На занятті можна почати з того, хто пише і з якою метою, перш ніж переходити до змісту.', studyTitle: 'Запитання про плазматичну мембрану', studySubtitle: 'Клітинна біологія', studyQuote: 'Активний транспорт переміщує розчинені речовини проти градієнта й потребує енергії.', studyQuestion: 'Чим відрізняються пасивний і активний транспорт?', studyAnswer: 'Пасивний транспорт відбувається за градієнтом і не споживає АТФ. Активний транспорт переміщує речовини проти градієнта й потребує енергії [S1](nodus://study/evidence/S1).' },
  },
  ko: {
    system: { intro: '당신은 Nodus의 학습 어시스턴트입니다. 학생이 선택한 로컬 코퍼스로 작업합니다.', rulesHeading: '양보할 수 없는 규칙', corpus: '코퍼스에 관한 주장은 오로지 출처에 근거하십시오.', cite: '주장 직후에 [S1], [S2] 등으로 증거를 인용하십시오. id, 제목, 페이지, 타임스탬프 또는 인용문을 날조하지 마십시오.', exact: '각 인용은 제공된 id 중 하나와 정확히 대응해야 합니다. 존재하지 않는 참고 문헌을 포함하지 마십시오.', contradiction: '버전이나 출처가 상충하면 그대로 서술하십시오. 조용히 병합하지 마십시오.', language: (language, level, tone) => `${language}로, ${level} 수준, ${tone} 어조로 답하십시오.`, markdown: 'Markdown을 유지하십시오.', externalAllowed: '일반 지식을 보충할 수 있지만, “외부 지식” 제목 아래에 분리하고 코퍼스 인용을 절대 결부시키지 마십시오.', externalForbidden: '외부 지식 사용은 금지됩니다. 출처가 불충분하면 그 점을 분명히 밝히고 어떤 정보가 빠졌는지 설명하십시오.' },
    responseLanguage: '질문의 언어', insufficientInformation: '선택한 출처에 안전하게 답하기에 충분한 정보가 없습니다. 자료를 추가하거나 범위를 넓히거나 다른 출처를 선택하십시오.', noQuestion: '보내기 전에 질문을 작성하십시오.', conversationTitle: '학습 대화', exportHeader: (date) => `_Nodus 학습 채팅에서 내보냄 · ${date}_`, labels: { user: '학생', assistant: '어시스턴트', sources: '출처' },
    demo: { teachingTitle: '3차 세션 논평 준비', teachingSubtitle: '역사', teachingQuote: '아이들은 동트기 전에 공장에 들어가고, 이미 어두워진 뒤에 나온다.', teachingQuestion: '이 출처는 어떤 노동 조건을 설명하며, 수업에서 어떤 질문을 던질 수 있을까요?', teachingAnswer: '출처는 동트기 전에 시작해 어두워진 뒤에 끝나는 근무일과 면먼지, 끊임없는 소음을 설명합니다 [S1](nodus://study/evidence/S1). 수업에서는 내용으로 들어가기 전에 누가 어떤 의도로 쓰는지부터 시작할 수 있습니다.', studyTitle: '세포막에 관한 의문', studySubtitle: '세포 생물학', studyQuote: '능동 수송은 용질을 농도 기울기에 거슬러 이동시키며 에너지가 필요하다.', studyQuestion: '수동 수송과 능동 수송은 어떻게 다른가요?', studyAnswer: '수동 수송은 농도 기울기를 따라 일어나며 ATP를 소비하지 않습니다. 능동 수송은 물질을 농도 기울기에 거슬러 이동시키며 에너지가 필요합니다 [S1](nodus://study/evidence/S1).' },
  },
};

export function studyAssistantPromptPack(language: PromptLanguage = 'es'): StudyAssistantPromptPack {
  const selected = copies[language] ?? copies.es;
  return { ...selected, taskInstruction: tasks[language] ?? tasks.es };
}

export function studyAssistantDemoSourceTitle(language: PromptLanguage, kind: 'teaching' | 'study'): string {
  const titles: Record<PromptLanguage, { teaching: string; study: string }> = {
    es: { teaching: 'Fuente · Informe fabril (1832)', study: 'Membrana plasmática · resumen' },
    en: { teaching: 'Source · Factory report (1832)', study: 'Plasma membrane · summary' },
    fr: { teaching: 'Source · Rapport d’usine (1832)', study: 'Membrane plasmique · résumé' },
    de: { teaching: 'Quelle · Fabrikbericht (1832)', study: 'Plasmamembran · Zusammenfassung' },
    pt: { teaching: 'Fonte · Relatório fabril (1832)', study: 'Membrana plasmática · resumo' },
    'pt-BR': { teaching: 'Fonte · Relatório fabril (1832)', study: 'Membrana plasmática · resumo' },
    it: { teaching: 'Fonte · Rapporto di fabbrica (1832)', study: 'Membrana plasmatica · riassunto' },
    tr: { teaching: 'Kaynak · Fabrika raporu (1832)', study: 'Hücre zarı · özet' },
    'zh-Hans': { teaching: '来源 · 工厂报告（1832）', study: '质膜 · 摘要' },
    'zh-Hant': { teaching: '來源 · 工廠報告（1832）', study: '質膜 · 摘要' },
    vi: { teaching: 'Nguồn · Báo cáo nhà máy (1832)', study: 'Màng tế bào · tóm tắt' },
    ja: { teaching: '情報源 · 工場報告書（1832）', study: '細胞膜 · 要約' },
    ru: { teaching: 'Источник · Фабричный отчёт (1832)', study: 'Плазматическая мембрана · резюме' },
    uk: { teaching: 'Джерело · Фабричний звіт (1832)', study: 'Плазматична мембрана · резюме' },
    ko: { teaching: '출처 · 공장 보고서 (1832)', study: '세포막 · 요약' },
  };
  return titles[language]?.[kind] ?? titles.es[kind];
}
