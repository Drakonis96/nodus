import type { PromptLanguage } from './types';
import type { ExamQuestionType, ExamLanguage } from './teachingExams';
import type { RubricLanguage } from './teachingRubrics';

export interface TeachingExamPromptPack {
  languageNames: Record<ExamLanguage, string>;
  typeLabels: Record<ExamQuestionType, { label: string; description: string }>;
  scopeHints: Partial<Record<ExamQuestionType, string>>;
  shapeFor(type: ExamQuestionType, optionCount: number): string;
  systemRole: string;
  systemLanguage: string;
  systemJson: string;
  systemFormat: string;
  systemEvidence: string;
  systemNoEvidence: string;
  userQuestionType: string;
  userTeacherInstruction: string;
  userAvoid: string;
  userMaterials: string;
  userExactJson: string;
  trueFalseLabels: { true: string; false: string };
}

export interface TeachingRubricPromptPack {
  languageNames: Record<RubricLanguage, string>;
  descriptorRules: string;
  systemRole: string;
  systemLanguage: string;
  systemJson: string;
  systemDescriptorOutput: string;
  taskSystemRole: string;
  taskSystemLanguage: string;
  taskSystemJson: string;
  independentCriteria: string;
  rubricComplete: string;
  criterion: string;
  level: string;
  levelsPosition(index: number, count: number): string;
  teacherInstruction: string;
  writeCell: string;
  task: string;
  attachedTask: string;
  sourceMaterial: string;
  sourceSearchFallback: string;
  exactCounts(criteriaCount: number, levelCount: number): string;
  weighted: string;
  exactJson: string;
  jsonFormat(weighted: boolean): string;
  descriptorCount(levelCount: number): string;
  criterionFallback: string;
  rubricFallback: string;
}

export interface TeachingPromptPack {
  exam: TeachingExamPromptPack;
  rubric: TeachingRubricPromptPack;
}

type ExamLabels = Record<ExamQuestionType, { label: string; description: string }>;

const ES_EXAM_LABELS: ExamLabels = {
  section: { label: 'Enunciado de sección', description: 'Texto, caso o imagen común del que cuelgan varias preguntas.' },
  short_essay: { label: 'Desarrollo corto', description: 'Respuesta argumentada breve, de unas pocas líneas.' },
  medium_essay: { label: 'Desarrollo intermedio', description: 'Respuesta argumentada de media página.' },
  long_essay: { label: 'Desarrollo largo', description: 'Tema a desarrollar con una página completa de espacio.' },
  short_answer: { label: 'Respuesta breve', description: 'Pregunta directa que se responde en una línea.' },
  definition: { label: 'Definición', description: 'Definir un término o concepto clave.' },
  multiple_choice: { label: 'Cuestionario', description: 'Pregunta con varias opciones; eliges cuántas.' },
  true_false: { label: 'Verdadero o falso', description: 'Afirmación que el alumnado marca como verdadera o falsa.' },
  matching: { label: 'Relacionar con flechas', description: 'Dos columnas que se unen con flechas.' },
  ordering: { label: 'Ordenar elementos', description: 'Elementos que se numeran en el orden correcto.' },
  fill_blank: { label: 'Completar huecos', description: 'Texto con huecos que hay que rellenar.' },
  image_comment: { label: 'Comentario de imagen', description: 'Imagen que el alumnado debe comentar o identificar.' },
  problem: { label: 'Problema o caso práctico', description: 'Supuesto práctico que exige resolución razonada.' },
};

const EN_EXAM_LABELS: ExamLabels = {
  section: { label: 'Section prompt', description: 'Shared text, case, or image from which several questions stem.' },
  short_essay: { label: 'Short essay', description: 'A brief reasoned answer of a few lines.' },
  medium_essay: { label: 'Medium essay', description: 'A reasoned answer of half a page.' },
  long_essay: { label: 'Long essay', description: 'A topic to develop with a full page of space.' },
  short_answer: { label: 'Short answer', description: 'A direct question answered in one line.' },
  definition: { label: 'Definition', description: 'Define a key term or concept.' },
  multiple_choice: { label: 'Multiple choice', description: 'A question with several options; you choose how many.' },
  true_false: { label: 'True or false', description: 'A statement that students mark as true or false.' },
  matching: { label: 'Matching', description: 'Two columns joined with arrows.' },
  ordering: { label: 'Ordering', description: 'Items numbered in the correct order.' },
  fill_blank: { label: 'Fill in the blanks', description: 'Text with blanks to fill in.' },
  image_comment: { label: 'Image comment', description: 'An image that students must comment on or identify.' },
  problem: { label: 'Problem or practical case', description: 'A practical case requiring a reasoned solution.' },
};

const FR_EXAM_LABELS: ExamLabels = {
  section: { label: 'Énoncé de section', description: 'Texte, cas ou image commun dont dépendent plusieurs questions.' },
  short_essay: { label: 'Développement court', description: 'Réponse argumentée brève, de quelques lignes.' },
  medium_essay: { label: 'Développement intermédiaire', description: 'Réponse argumentée d’une demi-page.' },
  long_essay: { label: 'Développement long', description: 'Sujet à développer avec une page entière d’espace.' },
  short_answer: { label: 'Réponse courte', description: 'Question directe à laquelle on répond en une ligne.' },
  definition: { label: 'Définition', description: 'Définir un terme ou concept clé.' },
  multiple_choice: { label: 'QCM', description: 'Question à plusieurs choix ; vous choisissez leur nombre.' },
  true_false: { label: 'Vrai ou faux', description: 'Affirmation que les élèves marquent comme vraie ou fausse.' },
  matching: { label: 'Relier par des flèches', description: 'Deux colonnes à relier par des flèches.' },
  ordering: { label: 'Ordonner des éléments', description: 'Éléments à numéroter dans le bon ordre.' },
  fill_blank: { label: 'Compléter les blancs', description: 'Texte comportant des blancs à remplir.' },
  image_comment: { label: 'Commentaire d’image', description: 'Image que les élèves doivent commenter ou identifier.' },
  problem: { label: 'Problème ou cas pratique', description: 'Cas pratique qui exige une résolution raisonnée.' },
};

const DE_EXAM_LABELS: ExamLabels = {
  section: { label: 'Abschnittsaufgabe', description: 'Gemeinsamer Text, Fall oder Bild, von dem mehrere Fragen abhängen.' },
  short_essay: { label: 'Kurze Ausarbeitung', description: 'Kurze begründete Antwort von wenigen Zeilen.' },
  medium_essay: { label: 'Mittlere Ausarbeitung', description: 'Begründete Antwort von einer halben Seite.' },
  long_essay: { label: 'Lange Ausarbeitung', description: 'Thema mit Platz für eine ganze Seite.' },
  short_answer: { label: 'Kurze Antwort', description: 'Direkte Frage, die in einer Zeile beantwortet wird.' },
  definition: { label: 'Definition', description: 'Einen Schlüsselbegriff oder ein Schlüsselkonzept definieren.' },
  multiple_choice: { label: 'Multiple Choice', description: 'Frage mit mehreren Optionen; Sie wählen deren Anzahl.' },
  true_false: { label: 'Richtig oder falsch', description: 'Aussage, die die Lernenden als richtig oder falsch markieren.' },
  matching: { label: 'Zuordnen', description: 'Zwei Spalten, die mit Pfeilen verbunden werden.' },
  ordering: { label: 'Elemente ordnen', description: 'Elemente, die in der richtigen Reihenfolge nummeriert werden.' },
  fill_blank: { label: 'Lücken ausfüllen', description: 'Text mit auszufüllenden Lücken.' },
  image_comment: { label: 'Bildkommentar', description: 'Bild, das die Lernenden kommentieren oder identifizieren sollen.' },
  problem: { label: 'Problem oder praktischer Fall', description: 'Praktischer Fall, der eine begründete Lösung erfordert.' },
};

const PT_EXAM_LABELS: ExamLabels = {
  section: { label: 'Enunciado de secção', description: 'Texto, caso ou imagem comum de que dependem várias perguntas.' },
  short_essay: { label: 'Desenvolvimento curto', description: 'Resposta argumentada breve, de poucas linhas.' },
  medium_essay: { label: 'Desenvolvimento intermédio', description: 'Resposta argumentada de meia página.' },
  long_essay: { label: 'Desenvolvimento longo', description: 'Tema a desenvolver com uma página inteira de espaço.' },
  short_answer: { label: 'Resposta breve', description: 'Pergunta direta a que se responde numa linha.' },
  definition: { label: 'Definição', description: 'Definir um termo ou conceito-chave.' },
  multiple_choice: { label: 'Escolha múltipla', description: 'Pergunta com várias opções; escolhe quantas.' },
  true_false: { label: 'Verdadeiro ou falso', description: 'Afirmação que os alunos assinalam como verdadeira ou falsa.' },
  matching: { label: 'Relacionar com setas', description: 'Duas colunas que se unem com setas.' },
  ordering: { label: 'Ordenar elementos', description: 'Elementos numerados pela ordem correta.' },
  fill_blank: { label: 'Preencher lacunas', description: 'Texto com lacunas para preencher.' },
  image_comment: { label: 'Comentário de imagem', description: 'Imagem que os alunos devem comentar ou identificar.' },
  problem: { label: 'Problema ou caso prático', description: 'Caso prático que exige uma resolução fundamentada.' },
};

const PT_BR_EXAM_LABELS: ExamLabels = {
  section: { label: 'Enunciado de seção', description: 'Texto, caso ou imagem comum do qual dependem várias questões.' },
  short_essay: { label: 'Desenvolvimento curto', description: 'Resposta argumentada breve, de poucas linhas.' },
  medium_essay: { label: 'Desenvolvimento intermediário', description: 'Resposta argumentada de meia página.' },
  long_essay: { label: 'Desenvolvimento longo', description: 'Tema a desenvolver com espaço para uma página inteira.' },
  short_answer: { label: 'Resposta curta', description: 'Pergunta direta respondida em uma linha.' },
  definition: { label: 'Definição', description: 'Defina um termo ou conceito-chave.' },
  multiple_choice: { label: 'Múltipla escolha', description: 'Questão com várias opções; você escolhe quantas.' },
  true_false: { label: 'Verdadeiro ou falso', description: 'Afirmação que os alunos marcam como verdadeira ou falsa.' },
  matching: { label: 'Relacionar com setas', description: 'Duas colunas unidas por setas.' },
  ordering: { label: 'Ordenar elementos', description: 'Elementos numerados na ordem correta.' },
  fill_blank: { label: 'Preencher lacunas', description: 'Texto com lacunas para preencher.' },
  image_comment: { label: 'Comentário de imagem', description: 'Imagem que os alunos devem comentar ou identificar.' },
  problem: { label: 'Problema ou caso prático', description: 'Caso prático que exige uma resolução fundamentada.' },
};

const IT_EXAM_LABELS: ExamLabels = {
  section: { label: 'Traccia di sezione', description: 'Testo, caso o immagine comune da cui dipendono più domande.' },
  short_essay: { label: 'Svolgimento breve', description: 'Breve risposta argomentata di poche righe.' },
  medium_essay: { label: 'Svolgimento intermedio', description: 'Risposta argomentata di mezza pagina.' },
  long_essay: { label: 'Svolgimento lungo', description: 'Argomento da sviluppare con lo spazio di una pagina intera.' },
  short_answer: { label: 'Risposta breve', description: 'Domanda diretta a cui rispondere in una riga.' },
  definition: { label: 'Definizione', description: 'Definire un termine o concetto chiave.' },
  multiple_choice: { label: 'Scelta multipla', description: 'Domanda con più opzioni; scegli quante inserirne.' },
  true_false: { label: 'Vero o falso', description: 'Affermazione che gli studenti indicano come vera o falsa.' },
  matching: { label: 'Collegare con frecce', description: 'Due colonne da unire con frecce.' },
  ordering: { label: 'Ordinare elementi', description: 'Elementi da numerare nell’ordine corretto.' },
  fill_blank: { label: 'Completare gli spazi', description: 'Testo con spazi vuoti da riempire.' },
  image_comment: { label: 'Commento d’immagine', description: 'Immagine da commentare o identificare.' },
  problem: { label: 'Problema o caso pratico', description: 'Caso pratico che richiede una soluzione motivata.' },
};

const TR_EXAM_LABELS: ExamLabels = {
  section: { label: 'Bölüm yönergesi', description: 'Birden çok sorunun dayandığı ortak metin, vaka veya görsel.' },
  short_essay: { label: 'Kısa kompozisyon', description: 'Birkaç satırlık kısa, gerekçeli yanıt.' },
  medium_essay: { label: 'Orta uzunlukta kompozisyon', description: 'Yarım sayfalık gerekçeli yanıt.' },
  long_essay: { label: 'Uzun kompozisyon', description: 'Tam bir sayfalık alanda geliştirilecek konu.' },
  short_answer: { label: 'Kısa yanıt', description: 'Tek satırda yanıtlanan doğrudan soru.' },
  definition: { label: 'Tanım', description: 'Önemli bir terimi veya kavramı tanımlama.' },
  multiple_choice: { label: 'Çoktan seçmeli', description: 'Birden çok seçenekli soru; kaç seçenek olacağını siz belirlersiniz.' },
  true_false: { label: 'Doğru veya yanlış', description: 'Öğrencilerin doğru ya da yanlış olarak işaretlediği ifade.' },
  matching: { label: 'Oklarla eşleştirme', description: 'Oklarla birleştirilen iki sütun.' },
  ordering: { label: 'Ögeleri sıralama', description: 'Doğru sırada numaralandırılacak ögeler.' },
  fill_blank: { label: 'Boşluk doldurma', description: 'Doldurulacak boşluklar içeren metin.' },
  image_comment: { label: 'Görsel yorumu', description: 'Öğrencilerin yorumlaması veya tanımlaması gereken görsel.' },
  problem: { label: 'Problem veya uygulamalı vaka', description: 'Gerekçeli çözüm gerektiren uygulamalı vaka.' },
};

const examLanguageNames: Record<PromptLanguage, Record<ExamLanguage, string>> = {
  es: { es: 'español', en: 'inglés', fr: 'francés', de: 'alemán', pt: 'portugués de Portugal', 'pt-BR': 'portugués de Brasil', it: 'italiano', tr: 'turco' },
  en: { es: 'Spanish', en: 'English', fr: 'French', de: 'German', pt: 'European Portuguese', 'pt-BR': 'Brazilian Portuguese', it: 'Italian', tr: 'Turkish' },
  fr: { es: 'espagnol', en: 'anglais', fr: 'français', de: 'allemand', pt: 'portugais du Portugal', 'pt-BR': 'portugais du Brésil', it: 'italien', tr: 'turc' },
  de: { es: 'Spanisch', en: 'Englisch', fr: 'Französisch', de: 'Deutsch', pt: 'Portugiesisch (Portugal)', 'pt-BR': 'Portugiesisch (Brasilien)', it: 'Italienisch', tr: 'Türkisch' },
  pt: { es: 'espanhol', en: 'inglês', fr: 'francês', de: 'alemão', pt: 'português de Portugal', 'pt-BR': 'português do Brasil', it: 'italiano', tr: 'turco' },
  'pt-BR': { es: 'espanhol', en: 'inglês', fr: 'francês', de: 'alemão', pt: 'português de Portugal', 'pt-BR': 'português do Brasil', it: 'italiano', tr: 'turco' },
  it: { es: 'spagnolo', en: 'inglese', fr: 'francese', de: 'tedesco', pt: 'portoghese europeo', 'pt-BR': 'portoghese brasiliano', it: 'italiano', tr: 'turco' },
  tr: { es: 'İspanyolca', en: 'İngilizce', fr: 'Fransızca', de: 'Almanca', pt: 'Avrupa Portekizcesi', 'pt-BR': 'Brezilya Portekizcesi', it: 'İtalyanca', tr: 'Türkçe' },
};

/* eslint-disable no-useless-escape -- the JSON examples intentionally show quoted keys inside template literals. */
function examShape(type: ExamQuestionType, optionCount: number, language: PromptLanguage): string {
  const phrase = {
    es: { section: 'texto, fuente o caso práctico común, listo para imprimir', statement: 'afirmación que se evalúa como verdadera o falsa', brief: 'justificación breve', prompt: 'enunciado', solution: 'por qué esa es la correcta', pair: 'elemento correspondiente', criterion: 'criterio de corrección', order: 'orden correcto', words: 'palabras que completan cada hueco, en orden', image: 'enunciado que pide comentar la imagen', caption: 'pie de imagen sugerido', imageSolution: 'qué debe aparecer en un buen comentario', term: 'término o concepto que hay que definir', definition: 'definición de referencia', practical: 'supuesto práctico completo con los datos necesarios', resolution: 'resolución razonada', model: 'respuesta modelo o criterios de corrección' },
    en: { section: 'shared text, source, or practical case, ready to print', statement: 'statement evaluated as true or false', brief: 'brief justification', prompt: 'prompt', solution: 'why that option is correct', pair: 'corresponding element', criterion: 'marking criterion', order: 'correct order', words: 'words that complete each blank, in order', image: 'prompt asking for a comment on the image', caption: 'suggested image caption', imageSolution: 'what a good comment should contain', term: 'term or concept to define', definition: 'reference definition', practical: 'complete practical case with the necessary data', resolution: 'reasoned solution', model: 'model answer or marking criteria' },
    fr: { section: 'texte, source ou cas pratique commun, prêt à imprimer', statement: 'affirmation à évaluer comme vraie ou fausse', brief: 'justification brève', prompt: 'énoncé', solution: 'pourquoi cette réponse est correcte', pair: 'élément correspondant', criterion: 'critère de correction', order: 'ordre correct', words: 'mots qui complètent chaque blanc, dans l’ordre', image: 'énoncé demandant de commenter l’image', caption: 'légende d’image suggérée', imageSolution: 'ce qui doit figurer dans un bon commentaire', term: 'terme ou concept à définir', definition: 'définition de référence', practical: 'cas pratique complet avec les données nécessaires', resolution: 'résolution raisonnée', model: 'réponse modèle ou critères de correction' },
    de: { section: 'gemeinsamer Text, Quelle oder praktischer Fall, druckfertig', statement: 'Aussage, die als richtig oder falsch bewertet wird', brief: 'kurze Begründung', prompt: 'Aufgabenstellung', solution: 'warum diese Antwort richtig ist', pair: 'zugehöriges Element', criterion: 'Bewertungskriterium', order: 'richtige Reihenfolge', words: 'Wörter, die jede Lücke in der richtigen Reihenfolge ausfüllen', image: 'Aufgabenstellung zum Kommentieren des Bildes', caption: 'vorgeschlagene Bildunterschrift', imageSolution: 'was ein guter Kommentar enthalten muss', term: 'zu definierender Begriff oder Konzept', definition: 'Referenzdefinition', practical: 'vollständiger praktischer Fall mit den nötigen Angaben', resolution: 'begründete Lösung', model: 'Musterantwort oder Bewertungskriterien' },
    pt: { section: 'texto, fonte ou caso prático comum, pronto a imprimir', statement: 'afirmação avaliada como verdadeira ou falsa', brief: 'justificação breve', prompt: 'enunciado', solution: 'por que razão essa é a correta', pair: 'elemento correspondente', criterion: 'critério de correção', order: 'ordem correta', words: 'palavras que completam cada lacuna, pela ordem', image: 'enunciado que pede o comentário da imagem', caption: 'legenda de imagem sugerida', imageSolution: 'o que deve constar num bom comentário', term: 'termo ou conceito a definir', definition: 'definição de referência', practical: 'caso prático completo com os dados necessários', resolution: 'resolução fundamentada', model: 'resposta-modelo ou critérios de correção' },
    'pt-BR': { section: 'texto, fonte ou caso prático comum, pronto para imprimir', statement: 'afirmação avaliada como verdadeira ou falsa', brief: 'justificativa breve', prompt: 'enunciado', solution: 'por que essa é a correta', pair: 'elemento correspondente', criterion: 'critério de correção', order: 'ordem correta', words: 'palavras que completam cada lacuna, na ordem', image: 'enunciado que pede o comentário da imagem', caption: 'legenda de imagem sugerida', imageSolution: 'o que deve aparecer em um bom comentário', term: 'termo ou conceito a definir', definition: 'definição de referência', practical: 'caso prático completo com os dados necessários', resolution: 'resolução fundamentada', model: 'resposta-modelo ou critérios de correção' },
    it: { section: 'testo, fonte o caso pratico comune, pronto per la stampa', statement: 'affermazione da valutare come vera o falsa', brief: 'breve giustificazione', prompt: 'traccia', solution: 'perché questa è la risposta corretta', pair: 'elemento corrispondente', criterion: 'criterio di correzione', order: 'ordine corretto', words: 'parole che completano ogni spazio, nell’ordine', image: 'traccia che chiede di commentare l’immagine', caption: 'didascalia suggerita', imageSolution: 'cosa deve contenere un buon commento', term: 'termine o concetto da definire', definition: 'definizione di riferimento', practical: 'caso pratico completo con i dati necessari', resolution: 'soluzione motivata', model: 'risposta modello o criteri di correzione' },
    tr: { section: 'yazdırmaya hazır ortak metin, kaynak veya uygulamalı vaka', statement: 'doğru veya yanlış olarak değerlendirilecek ifade', brief: 'kısa gerekçe', prompt: 'yönerge', solution: 'bu seçeneğin neden doğru olduğu', pair: 'karşılık gelen öge', criterion: 'puanlama ölçütü', order: 'doğru sıra', words: 'her boşluğu sırayla tamamlayan sözcükler', image: 'görseli yorumlamayı isteyen yönerge', caption: 'önerilen görsel başlığı', imageSolution: 'iyi bir yorumda bulunması gerekenler', term: 'tanımlanacak terim veya kavram', definition: 'başvuru tanımı', practical: 'gerekli verileri içeren eksiksiz uygulamalı vaka', resolution: 'gerekçeli çözüm', model: 'örnek yanıt veya puanlama ölçütleri' },
  }[language];
  switch (type) {
    case 'section': return `{\"prompt\": \"${phrase.section}\", \"solution\": \"\"}\n- ${language === 'es' ? 'NO formules ninguna pregunta: esto es solo el material del que colgarán varias preguntas.' : language === 'en' ? 'Do NOT formulate a question: this is only the material from which several questions will hang.' : language === 'fr' ? 'NE formulez AUCUNE question : il s’agit uniquement du support auquel plusieurs questions seront rattachées.' : language === 'de' ? 'Formulieren Sie KEINE Frage: Dies ist nur das Material, an das mehrere Fragen angehängt werden.' : language === 'it' ? 'NON formulare alcuna domanda: questo è solo il materiale da cui dipenderanno più domande.' : language === 'tr' ? 'Soru OLUŞTURMAYIN: bu yalnızca birden çok sorunun dayanacağı materyaldir.' : language === 'pt-BR' ? 'NÃO formule nenhuma pergunta: este é apenas o material ao qual várias questões serão vinculadas.' : 'NÃO formules nenhuma pergunta: este é apenas o material a que várias perguntas ficarão ligadas.'}\n- ${language === 'es' ? 'Entre 80 y 200 palabras, autocontenido y comprensible sin contexto adicional.' : language === 'en' ? 'Between 80 and 200 words, self-contained and understandable without additional context.' : language === 'fr' ? 'Entre 80 et 200 mots, autonome et compréhensible sans contexte supplémentaire.' : language === 'de' ? 'Zwischen 80 und 200 Wörtern, in sich geschlossen und ohne weiteren Kontext verständlich.' : language === 'it' ? 'Tra 80 e 200 parole, autonomo e comprensibile senza contesto aggiuntivo.' : language === 'tr' ? '80 ile 200 kelime arasında, kendi başına anlaşılır ve ek bağlam gerektirmeyen bir metin.' : language === 'pt-BR' ? 'Entre 80 e 200 palavras, autossuficiente e compreensível sem contexto adicional.' : 'Entre 80 e 200 palavras, autónomo e compreensível sem contexto adicional.'}`;
    case 'multiple_choice': return `{\"prompt\": \"${phrase.prompt}\", \"options\": [${Array.from({ length: optionCount }, (_, i) => `\"${language === 'es' ? 'opción' : language === 'en' ? 'option' : language === 'fr' ? 'option' : language === 'de' ? 'Option' : language === 'it' ? 'opzione' : language === 'tr' ? 'seçenek' : 'opção'} ${i + 1}\"`).join(', ')}], \"correctIndex\": 0, \"solution\": \"${phrase.solution}\"}\n- ${language === 'es' ? `Exactamente ${optionCount} opciones, todas verosímiles y mutuamente excluyentes.` : language === 'en' ? `Exactly ${optionCount} options, all plausible and mutually exclusive.` : language === 'fr' ? `${optionCount} options exactement, toutes plausibles et mutuellement exclusives.` : language === 'de' ? `Genau ${optionCount} Optionen, alle plausibel und sich gegenseitig ausschließend.` : language === 'it' ? `Esattamente ${optionCount} opzioni, tutte plausibili e mutuamente esclusive.` : language === 'tr' ? `Tam olarak ${optionCount} seçenek; hepsi makul ve birbirini dışlayan seçenekler olmalıdır.` : language === 'pt-BR' ? `Exatamente ${optionCount} opções, todas plausíveis e mutuamente excludentes.` : `Exatamente ${optionCount} opções, todas plausíveis e mutuamente exclusivas.`}\n- ${language === 'es' ? '\"correctIndex\" es el índice (empezando en 0) de la única opción correcta.' : language === 'en' ? '\"correctIndex\" is the zero-based index of the only correct option.' : language === 'fr' ? '\"correctIndex\" est l’indice (à partir de 0) de l’unique option correcte.' : language === 'de' ? '\"correctIndex\" ist der bei 0 beginnende Index der einzigen richtigen Option.' : language === 'it' ? '\"correctIndex\" è l’indice (a partire da 0) dell’unica opzione corretta.' : language === 'tr' ? '\"correctIndex\", yalnızca doğru seçeneğin 0’dan başlayan dizinidir.' : language === 'pt-BR' ? '\"correctIndex\" é o índice (começando em 0) da única opção correta.' : '\"correctIndex\" é o índice (a começar em 0) da única opção correta.'}`;
    case 'true_false': return `{\"prompt\": \"${phrase.statement}\", \"correct\": true, \"solution\": \"${phrase.brief}\"}\n- ${language === 'es' ? '\"prompt\" debe ser una AFIRMACIÓN, nunca una pregunta.' : language === 'en' ? '\"prompt\" must be a STATEMENT, never a question.' : language === 'fr' ? '\"prompt\" doit être une AFFIRMATION, jamais une question.' : language === 'de' ? '\"prompt\" muss eine AUSSAGE sein, niemals eine Frage.' : language === 'it' ? '\"prompt\" deve essere un’AFFERMAZIONE, mai una domanda.' : language === 'tr' ? '\"prompt\" bir soru değil, bir İFADE olmalıdır.' : language === 'pt-BR' ? '\"prompt\" deve ser uma AFIRMAÇÃO, nunca uma pergunta.' : '\"prompt\" deve ser uma AFIRMAÇÃO, nunca uma pergunta.'}`;
    case 'matching': return `{\"prompt\": \"${language === 'es' ? 'instrucción para relacionar' : language === 'en' ? 'matching instruction' : language === 'fr' ? 'consigne pour relier' : language === 'de' ? 'Anweisung zum Zuordnen' : language === 'it' ? 'istruzione per collegare' : language === 'tr' ? 'eşleştirme yönergesi' : 'instrução para relacionar'}\", \"pairs\": [{\"left\": \"${language === 'es' ? 'elemento' : language === 'en' ? 'element' : language === 'fr' ? 'élément' : language === 'de' ? 'Element' : language === 'it' ? 'elemento' : language === 'tr' ? 'ög e' : 'elemento'}\", \"right\": \"${phrase.pair}\"}], \"solution\": \"${phrase.criterion}\"}\n- ${language === 'es' ? 'Entre 4 y 6 parejas inequívocas.' : language === 'en' ? 'Between 4 and 6 unambiguous pairs.' : language === 'fr' ? 'Entre 4 et 6 paires sans ambiguïté.' : language === 'de' ? 'Zwischen 4 und 6 eindeutige Paare.' : language === 'it' ? 'Tra 4 e 6 coppie inequivocabili.' : language === 'tr' ? '4 ile 6 arasında açıkça eşleşen çift.' : language === 'pt-BR' ? 'Entre 4 e 6 pares inequívocos.' : 'Entre 4 e 6 pares inequívocos.'}`;
    case 'ordering': return `{\"prompt\": \"${language === 'es' ? 'instrucción para ordenar' : language === 'en' ? 'ordering instruction' : language === 'fr' ? 'consigne pour ordonner' : language === 'de' ? 'Anweisung zum Ordnen' : language === 'it' ? 'istruzione per ordinare' : language === 'tr' ? 'sıralama yönergesi' : 'instrução para ordenar'}\", \"items\": [\"${language === 'es' ? 'elemento' : language === 'en' ? 'item' : language === 'fr' ? 'élément' : language === 'de' ? 'Element' : language === 'it' ? 'elemento' : language === 'tr' ? 'öge' : 'elemento'} 1\", \"${language === 'es' ? 'elemento' : language === 'en' ? 'item' : language === 'fr' ? 'élément' : language === 'de' ? 'Element' : language === 'it' ? 'elemento' : language === 'tr' ? 'öge' : 'elemento'} 2\"], \"solution\": \"${phrase.order}\"}\n- ${language === 'es' ? 'Entre 4 y 6 elementos, en "items" ya en el ORDEN CORRECTO (la app los barajará al imprimir).' : language === 'en' ? 'Between 4 and 6 items, already in CORRECT ORDER in "items" (the app will shuffle them when printing).' : language === 'fr' ? 'Entre 4 et 6 éléments, déjà dans le BON ORDRE dans "items" (l’application les mélangera à l’impression).' : language === 'de' ? 'Zwischen 4 und 6 Elemente in "items" bereits in der RICHTIGEN REIHENFOLGE (die App mischt sie beim Drucken).' : language === 'it' ? 'Tra 4 e 6 elementi, già nell’ORDINE CORRETTO in "items" (l’app li mescolerà durante la stampa).' : language === 'tr' ? '"items" içinde 4 ile 6 öge zaten DOĞRU SIRADA olmalıdır (uygulama yazdırırken karıştırır).' : language === 'pt-BR' ? 'Entre 4 e 6 elementos, já na ORDEM CORRETA em "items" (o aplicativo os embaralhará ao imprimir).' : 'Entre 4 e 6 elementos, já na ORDEM CORRETA em "items" (a aplicação baralhá-los-á ao imprimir).'}`;
    case 'fill_blank': return `{\"prompt\": \"${language === 'es' ? 'texto con huecos marcados como ______' : language === 'en' ? 'text with blanks marked ______' : language === 'fr' ? 'texte avec des blancs marqués ______' : language === 'de' ? 'Text mit durch ______ markierten Lücken' : language === 'it' ? 'testo con spazi segnati da ______' : language === 'tr' ? '______ ile işaretlenmiş boşluklar içeren metin' : language === 'pt-BR' ? 'texto com lacunas marcadas como ______' : 'texto com lacunas marcadas como ______'}\", \"solution\": \"${phrase.words}\"}\n- ${language === 'es' ? 'Entre 2 y 5 huecos marcados con ______ (guiones bajos).' : language === 'en' ? 'Between 2 and 5 blanks marked with ______ (underscores).' : language === 'fr' ? 'Entre 2 et 5 blancs marqués par ______ (traits de soulignement).' : language === 'de' ? 'Zwischen 2 und 5 mit ______ (Unterstrichen) markierten Lücken.' : language === 'it' ? 'Tra 2 e 5 spazi segnati da ______ (trattini bassi).' : language === 'tr' ? '______ (alt çizgi) ile işaretlenmiş 2 ile 5 arasında boşluk.' : language === 'pt-BR' ? 'Entre 2 e 5 lacunas marcadas com ______ (sublinhados).' : 'Entre 2 e 5 lacunas marcadas com ______ (sublinhados).'}`;
    case 'image_comment': return `{\"prompt\": \"${phrase.image}\", \"imageCaption\": \"${phrase.caption}\", \"solution\": \"${phrase.imageSolution}\"}\n- ${language === 'es' ? 'No describas una imagen concreta: el enunciado debe funcionar con la imagen que el profesor insertará.' : language === 'en' ? 'Do not describe a specific image: the prompt must work with the image the teacher will insert.' : language === 'fr' ? 'Ne décrivez pas une image précise : l’énoncé doit fonctionner avec l’image que l’enseignant insérera.' : language === 'de' ? 'Beschreiben Sie kein bestimmtes Bild: Die Aufgabe muss mit dem Bild funktionieren, das die Lehrkraft einfügt.' : language === 'it' ? 'Non descrivere un’immagine concreta: la traccia deve funzionare con l’immagine che l’insegnante inserirà.' : language === 'tr' ? 'Belirli bir görseli betimlemeyin: yönerge, öğretmenin ekleyeceği görselle çalışmalıdır.' : language === 'pt-BR' ? 'Não descreva uma imagem específica: o enunciado deve funcionar com a imagem que o professor inserirá.' : 'Não descrevas uma imagem concreta: o enunciado deve funcionar com a imagem que o professor irá inserir.'}`;
    case 'definition': return `{\"prompt\": \"${phrase.term}\", \"solution\": \"${phrase.definition}\"}`;
    case 'problem': return `{\"prompt\": \"${phrase.practical}\", \"solution\": \"${phrase.resolution}\"}`;
    default: return `{\"prompt\": \"${phrase.prompt}\", \"solution\": \"${phrase.model}\"}`;
  }
}
/* eslint-enable no-useless-escape */

const rubricLanguageNames: Record<PromptLanguage, Record<RubricLanguage, string>> = examLanguageNames;

const RULES: Record<PromptLanguage, string> = {
  es: 'Describe conductas OBSERVABLES y evaluables, no actitudes internas. Mantén la estructura paralela entre niveles: cambia el GRADO de calidad, no el tema ni la redacción. Un solo aspecto por criterio; si mezclas dos, sepáralos en criterios distintos. Evita negaciones vagas ("no está mal") y cuantificadores imprecisos ("algunos", "bastante"); concreta cantidad o alcance cuando proceda. Describe calidad, no frecuencia de entrega ni esfuerzo.',
  en: 'Describe OBSERVABLE and assessable behaviours, not internal attitudes. Keep a parallel structure across levels: change the DEGREE of quality, not the topic or wording. One aspect per criterion; if you combine two, split them into separate criteria. Avoid vague negations ("not bad") and imprecise quantifiers ("some", "quite a lot"); specify quantity or scope when appropriate. Describe quality, not submission frequency or effort.',
  fr: 'Décrivez des comportements OBSERVABLES et évaluables, pas des attitudes internes. Maintenez une structure parallèle entre les niveaux : changez le DEGRÉ de qualité, pas le sujet ni la formulation. Un seul aspect par critère ; si vous en mélangez deux, séparez-les en critères distincts. Évitez les négations vagues (« pas mal ») et les quantificateurs imprécis (« certains », « assez ») ; précisez la quantité ou la portée si nécessaire. Décrivez la qualité, pas la fréquence de remise ni l’effort.',
  de: 'Beschreiben Sie BEOBACHTBARES und bewertbares Verhalten, keine inneren Einstellungen. Behalten Sie eine parallele Struktur zwischen den Stufen bei: Ändern Sie den QUALITÄTSGRAD, nicht Thema oder Formulierung. Ein Aspekt pro Kriterium; wenn Sie zwei verbinden, teilen Sie sie in getrennte Kriterien. Vermeiden Sie vage Verneinungen („nicht schlecht“) und ungenaue Quantifizierer („einige“, „ziemlich“); konkretisieren Sie Menge oder Umfang, wenn angebracht. Beschreiben Sie Qualität, nicht Abgabehäufigkeit oder Aufwand.',
  pt: 'Descreve comportamentos OBSERVÁVEIS e avaliáveis, não atitudes internas. Mantém uma estrutura paralela entre níveis: altera o GRAU de qualidade, não o tema nem a redação. Um só aspeto por critério; se misturares dois, separa-os em critérios distintos. Evita negações vagas («não está mal») e quantificadores imprecisos («alguns», «bastante»); concretiza a quantidade ou o alcance quando adequado. Descreve qualidade, não frequência de entrega nem esforço.',
  'pt-BR': 'Descreva comportamentos OBSERVÁVEIS e avaliáveis, não atitudes internas. Mantenha uma estrutura paralela entre os níveis: mude o GRAU de qualidade, não o tema nem a redação. Um único aspecto por critério; se misturar dois, separe-os em critérios distintos. Evite negações vagas ("não está ruim") e quantificadores imprecisos ("alguns", "bastante"); especifique a quantidade ou o alcance quando apropriado. Descreva qualidade, não frequência de entrega nem esforço.',
  it: 'Descrivi comportamenti OSSERVABILI e valutabili, non atteggiamenti interiori. Mantieni una struttura parallela tra i livelli: cambia il GRADO di qualità, non l’argomento né la formulazione. Un solo aspetto per criterio; se ne mescoli due, separali in criteri distinti. Evita negazioni vaghe («non male») e quantificatori imprecisi («alcuni», «abbastanza»); specifica quantità o portata quando opportuno. Descrivi la qualità, non la frequenza di consegna né l’impegno.',
  tr: 'İç tutumları değil, GÖZLEMLENEBİLİR ve değerlendirilebilir davranışları açıklayın. Düzeyler arasında paralel yapıyı koruyun: konu veya ifadeyi değil, kalite DERECESİNİ değiştirin. Her ölçüt tek bir yön içersin; iki yönü birleştiriyorsanız ayrı ölçütlere ayırın. Belirsiz olumsuzlamalardan ("kötü değil") ve kesin olmayan nicelik belirteçlerinden ("bazı", "oldukça") kaçının; gerektiğinde miktarı veya kapsamı somutlaştırın. Teslim sıklığını veya çabayı değil, kaliteyi açıklayın.',
};

function rubricJsonFormat(language: PromptLanguage, weighted: boolean): string {
  const p = {
    es: ['título de la rúbrica', 'una frase sobre qué evalúa', 'nombre del nivel más alto', 'nombre del nivel más bajo', 'nombre del criterio', 'qué se observa', 'descriptor del nivel más alto', 'descriptor del nivel más bajo'],
    en: ['rubric title', 'one sentence about what it assesses', 'highest-level name', 'lowest-level name', 'criterion name', 'what is observed', 'highest-level descriptor', 'lowest-level descriptor'],
    fr: ['titre de la rubrique', 'une phrase sur ce qui est évalué', 'nom du niveau le plus élevé', 'nom du niveau le plus faible', 'nom du critère', 'ce qui est observé', 'descripteur du niveau le plus élevé', 'descripteur du niveau le plus faible'],
    de: ['Titel der Rubrik', 'ein Satz darüber, was bewertet wird', 'Name der höchsten Stufe', 'Name der niedrigsten Stufe', 'Kriteriumsname', 'was beobachtet wird', 'Deskriptor der höchsten Stufe', 'Deskriptor der niedrigsten Stufe'],
    pt: ['título da rubrica', 'uma frase sobre o que avalia', 'nome do nível mais alto', 'nome do nível mais baixo', 'nome do critério', 'o que é observado', 'descritor do nível mais alto', 'descritor do nível mais baixo'],
    'pt-BR': ['título da rubrica', 'uma frase sobre o que avalia', 'nome do nível mais alto', 'nome do nível mais baixo', 'nome do critério', 'o que é observado', 'descritor do nível mais alto', 'descritor do nível mais baixo'],
    it: ['titolo della rubrica', 'una frase su ciò che valuta', 'nome del livello più alto', 'nome del livello più basso', 'nome del criterio', 'ciò che si osserva', 'descrittore del livello più alto', 'descrittore del livello più basso'],
    tr: ['rubrik başlığı', 'neyi değerlendirdiğine dair bir cümle', 'en yüksek düzeyin adı', 'en düşük düzeyin adı', 'ölçüt adı', 'gözlemlenen şey', 'en yüksek düzey açıklaması', 'en düşük düzey açıklaması'],
  }[language];
  return `{
  "title": "${p[0]}",
  "description": "${p[1]}",
  "levels": ["${p[2]}", "…", "${p[3]}"],
  "criteria": [
    { "name": "${p[4]}", "description": "${p[5]}"${weighted ? ', "weight": 25' : ''}, "descriptors": ["${p[6]}", "…", "${p[7]}"] }
  ]
}`;
}

function makeExamPack(language: PromptLanguage, labels: ExamLabels): TeachingExamPromptPack {
  const phrase = {
    es: ['Eres un docente experto que redacta preguntas de examen claras, inequívocas y evaluables.', 'Redacta la pregunta ÍNTEGRAMENTE en', 'Devuelve solo JSON válido con la forma indicada, sin texto adicional ni markdown.', 'No numeres la pregunta ni añadas la puntuación: la aplicación se encarga del formato.', 'Basa la pregunta en los MATERIALES aportados. Si los materiales no cubren lo pedido, redáctala igualmente pero sin inventar datos concretos atribuidos a ellos.', 'No hay materiales de referencia: redacta la pregunta con conocimiento general de la materia.', 'TIPO DE PREGUNTA', 'INSTRUCCIÓN DEL PROFESOR', 'EVITA repetir esta pregunta anterior, propón algo claramente distinto:', 'MATERIALES DE LA ASIGNATURA:', 'FORMATO JSON EXACTO'],
    en: ['You are an expert teacher who writes clear, unambiguous, assessable exam questions.', 'Write the question ENTIRELY in', 'Return valid JSON only in the indicated shape, with no additional text or markdown.', 'Do not number the question or add points: the application handles formatting.', 'Base the question on the supplied MATERIALS. If the materials do not cover the request, write it anyway but do not invent concrete data attributed to them.', 'There are no reference materials: write the question using general knowledge of the subject.', 'QUESTION TYPE', 'TEACHER INSTRUCTION', 'AVOID repeating this previous question; propose something clearly different:', 'SUBJECT MATERIALS:', 'EXACT JSON FORMAT'],
    fr: ['Vous êtes un enseignant expert qui rédige des questions d’examen claires, sans ambiguïté et évaluables.', 'Rédigez la question ENTIÈREMENT en', 'Retournez uniquement un JSON valide dans la forme indiquée, sans texte supplémentaire ni Markdown.', 'Ne numérotez pas la question et n’ajoutez pas le barème : l’application se charge du formatage.', 'Fondez la question sur les MATÉRIAUX fournis. S’ils ne couvrent pas la demande, rédigez-la quand même sans inventer de données concrètes qui leur seraient attribuées.', 'Il n’y a pas de matériaux de référence : rédigez la question à partir des connaissances générales de la matière.', 'TYPE DE QUESTION', 'CONSIGNE DE L’ENSEIGNANT', 'ÉVITEZ de répéter cette question précédente ; proposez quelque chose de clairement différent :', 'MATÉRIAUX DE LA MATIÈRE :', 'FORMAT JSON EXACT'],
    de: ['Sie sind eine erfahrene Lehrkraft, die klare, eindeutige und bewertbare Prüfungsfragen formuliert.', 'Formulieren Sie die Frage VOLLSTÄNDIG auf', 'Geben Sie ausschließlich gültiges JSON in der angegebenen Form aus, ohne zusätzlichen Text oder Markdown.', 'Nummerieren Sie die Frage nicht und fügen Sie keine Punkte hinzu: Die Anwendung übernimmt die Formatierung.', 'Stützen Sie die Frage auf die bereitgestellten MATERIALIEN. Wenn diese die Anfrage nicht abdecken, formulieren Sie sie trotzdem, aber erfinden Sie keine konkreten ihnen zugeschriebenen Daten.', 'Es gibt keine Referenzmaterialien: Formulieren Sie die Frage mit allgemeinem Fachwissen.', 'FRAGENTYP', 'ANWEISUNG DER LEHRKRAFT', 'VERMEIDEN Sie eine Wiederholung der vorherigen Frage; schlagen Sie etwas deutlich anderes vor:', 'FACHMATERIALIEN:', 'EXAKTES JSON-FORMAT'],
    pt: ['És um docente especialista que redige perguntas de exame claras, inequívocas e avaliáveis.', 'Redige a pergunta INTEGRALMENTE em', 'Devolve apenas JSON válido na forma indicada, sem texto adicional nem Markdown.', 'Não numeres a pergunta nem acrescentes a pontuação: a aplicação trata da formatação.', 'Baseia a pergunta nos MATERIAIS fornecidos. Se não abrangerem o pedido, redige-a na mesma, mas não inventes dados concretos atribuídos aos materiais.', 'Não há materiais de referência: redige a pergunta com conhecimento geral da disciplina.', 'TIPO DE PERGUNTA', 'INSTRUÇÃO DO DOCENTE', 'EVITA repetir esta pergunta anterior; propõe algo claramente diferente:', 'MATERIAIS DA DISCIPLINA:', 'FORMATO JSON EXATO'],
    'pt-BR': ['Você é um professor especialista que redige questões de prova claras, inequívocas e avaliáveis.', 'Redija a questão INTEIRAMENTE em', 'Retorne somente JSON válido no formato indicado, sem texto adicional nem Markdown.', 'Não numere a questão nem acrescente a pontuação: o aplicativo cuida da formatação.', 'Baseie a questão nos MATERIAIS fornecidos. Se eles não cobrirem o pedido, redija-a mesmo assim, mas não invente dados concretos atribuídos a eles.', 'Não há materiais de referência: redija a questão com conhecimento geral da matéria.', 'TIPO DE QUESTÃO', 'INSTRUÇÃO DO PROFESSOR', 'EVITE repetir esta questão anterior; proponha algo claramente diferente:', 'MATERIAIS DA DISCIPLINA:', 'FORMATO JSON EXATO'],
    it: ['Sei un docente esperto che redige domande d’esame chiare, inequivocabili e valutabili.', 'Redigi la domanda INTERAMENTE in', 'Restituisci solo JSON valido nella forma indicata, senza testo aggiuntivo né Markdown.', 'Non numerare la domanda né aggiungere il punteggio: la formattazione è gestita dall’applicazione.', 'Basa la domanda sui MATERIALI forniti. Se non coprono la richiesta, redigila comunque senza inventare dati concreti attribuiti a essi.', 'Non ci sono materiali di riferimento: redigi la domanda usando le conoscenze generali della materia.', 'TIPO DI DOMANDA', 'ISTRUZIONE DEL DOCENTE', 'EVITA di ripetere questa domanda precedente; proponi qualcosa di chiaramente diverso:', 'MATERIALI DELLA MATERIA:', 'FORMATO JSON ESATTO'],
    tr: ['Açık, kesin ve değerlendirilebilir sınav soruları yazan uzman bir öğretmensiniz.', 'Soruyu TAMAMEN şu dilde yazın:', 'Belirtilen biçimde yalnızca geçerli JSON döndürün; ek metin veya Markdown eklemeyin.', 'Soruyu numaralandırmayın ve puan eklemeyin: biçimlendirmeyi uygulama yapar.', 'Soruyu sağlanan MATERYALLERE dayandırın. Materyaller isteneni kapsamıyorsa yine de yazın, ancak onlara atfedilen somut veriler uydurmayın.', 'Başvuru materyali yok: soruyu konuya ilişkin genel bilginizle yazın.', 'SORU TÜRÜ', 'ÖĞRETMENİN YÖNERGESİ', 'Önceki soruyu TEKRARLAMAYIN; açıkça farklı bir öneri sunun:', 'DERS MATERYALLERİ:', 'KESİN JSON BİÇİMİ'],
  }[language];
  return {
    languageNames: examLanguageNames[language], typeLabels: labels, scopeHints: {
      short_essay: ({ es: 'Debe poder responderse en unas 5 líneas.', en: 'It should be answerable in about 5 lines.', fr: 'La réponse doit tenir en environ 5 lignes.', de: 'Die Antwort sollte in etwa 5 Zeilen möglich sein.', pt: 'Deve poder ser respondido em cerca de 5 linhas.', 'pt-BR': 'Deve poder ser respondida em cerca de 5 linhas.', it: 'Dovrebbe poter essere svolta in circa 5 righe.', tr: 'Yaklaşık 5 satırda yanıtlanabilmelidir.' } as Record<PromptLanguage, string>)[language],
      medium_essay: ({ es: 'Debe poder responderse en media página.', en: 'It should be answerable in half a page.', fr: 'La réponse doit tenir sur une demi-page.', de: 'Die Antwort sollte auf eine halbe Seite passen.', pt: 'Deve poder ser respondido em meia página.', 'pt-BR': 'Deve poder ser respondida em meia página.', it: 'Dovrebbe poter essere svolta in mezza pagina.', tr: 'Yarım sayfada yanıtlanabilmelidir.' } as Record<PromptLanguage, string>)[language],
      long_essay: ({ es: 'Es un tema para desarrollar en una página completa.', en: 'It is a topic to develop over a full page.', fr: 'C’est un sujet à développer sur une page entière.', de: 'Es handelt sich um ein Thema für eine ganze Seite.', pt: 'É um tema a desenvolver numa página inteira.', 'pt-BR': 'É um tema para desenvolver em uma página inteira.', it: 'È un argomento da sviluppare su una pagina intera.', tr: 'Tam bir sayfada geliştirilecek bir konudur.' } as Record<PromptLanguage, string>)[language],
      short_answer: ({ es: 'Debe poder responderse en una sola línea.', en: 'It should be answerable in a single line.', fr: 'La réponse doit tenir sur une seule ligne.', de: 'Die Antwort sollte in einer einzigen Zeile möglich sein.', pt: 'Deve poder ser respondido numa só linha.', 'pt-BR': 'Deve poder ser respondida em uma única linha.', it: 'Dovrebbe poter essere svolta in una sola riga.', tr: 'Tek satırda yanıtlanabilmelidir.' } as Record<PromptLanguage, string>)[language],
    },
    shapeFor: (type, count) => examShape(type, count, language), systemRole: phrase[0], systemLanguage: phrase[1], systemJson: phrase[2], systemFormat: phrase[3], systemEvidence: phrase[4], systemNoEvidence: phrase[5], userQuestionType: phrase[6], userTeacherInstruction: phrase[7], userAvoid: phrase[8], userMaterials: phrase[9], userExactJson: phrase[10], trueFalseLabels: ({ es: { true: 'Verdadero', false: 'Falso' }, en: { true: 'True', false: 'False' }, fr: { true: 'Vrai', false: 'Faux' }, de: { true: 'Richtig', false: 'Falsch' }, pt: { true: 'Verdadeiro', false: 'Falso' }, 'pt-BR': { true: 'Verdadeiro', false: 'Falso' }, it: { true: 'Vero', false: 'Falso' }, tr: { true: 'Doğru', false: 'Yanlış' } } as Record<PromptLanguage, { true: string; false: string }>)[language],
  };
}

function makeRubricPack(language: PromptLanguage): TeachingRubricPromptPack {
  const text = {
    es: { role: 'Eres un docente experto en evaluación por criterios que redacta descriptores de rúbrica.', lang: 'Escribe ÍNTEGRAMENTE en', json: 'Devuelve SOLO el texto del descriptor pedido: una o dos frases, sin comillas, sin el nombre del nivel ni del criterio, sin markdown.', complete: 'RÚBRICA COMPLETA (para que el nuevo descriptor encaje con los demás):', criterion: 'CRITERIO:', level: 'NIVEL A REDACTAR:', teacher: 'INDICACIÓN DEL PROFESOR:', cell: 'Redacta el descriptor de ESA casilla.', taskRole: 'Eres un docente experto en evaluación que diseña rúbricas analíticas.', taskLang: 'Redacta TODO en', taskJson: 'Devuelve solo JSON válido, sin markdown ni texto adicional.', task: 'TAREA A EVALUAR:', attached: 'la tarea descrita en el documento adjunto', material: 'INSTRUCCIONES / MATERIAL DE LA TAREA:', exact: 'Genera EXACTAMENTE', weighted: 'Asigna a cada criterio un "weight" en porcentaje; los pesos deben sumar 100.', exactFormat: 'FORMATO JSON EXACTO:', descriptors: '"descriptors" debe tener exactamente', criterionFallback: 'Criterio', rubricFallback: 'Rúbrica' },
    en: { role: 'You are an expert teacher in criterion-based assessment who writes rubric descriptors.', lang: 'Write ENTIRELY in', json: 'Return ONLY the requested descriptor text: one or two sentences, without quotation marks, the level or criterion name, or markdown.', complete: 'COMPLETE RUBRIC (so the new descriptor fits with the others):', criterion: 'CRITERION:', level: 'LEVEL TO WRITE:', teacher: 'TEACHER INSTRUCTION:', cell: 'Write the descriptor for THAT cell.', taskRole: 'You are an expert assessment teacher who designs analytic rubrics.', taskLang: 'Write EVERYTHING in', taskJson: 'Return valid JSON only, with no markdown or additional text.', task: 'TASK TO ASSESS:', attached: 'the task described in the attached document', material: 'TASK INSTRUCTIONS / MATERIAL:', exact: 'Generate EXACTLY', weighted: 'Assign each criterion a percentage "weight"; the weights must sum to 100.', exactFormat: 'EXACT JSON FORMAT:', descriptors: '"descriptors" must contain exactly', criterionFallback: 'Criterion', rubricFallback: 'Rubric' },
    fr: { role: 'Vous êtes un enseignant expert en évaluation critériée qui rédige des descripteurs de rubrique.', lang: 'Écrivez ENTIÈREMENT en', json: 'Retournez UNIQUEMENT le texte du descripteur demandé : une ou deux phrases, sans guillemets, sans le nom du niveau ou du critère, sans Markdown.', complete: 'RUBRIQUE COMPLÈTE (pour que le nouveau descripteur s’accorde avec les autres) :', criterion: 'CRITÈRE :', level: 'NIVEAU À RÉDIGER :', teacher: 'CONSIGNE DE L’ENSEIGNANT :', cell: 'Rédigez le descripteur de CETTE case.', taskRole: 'Vous êtes un enseignant expert en évaluation qui conçoit des rubriques analytiques.', taskLang: 'Rédigez TOUT en', taskJson: 'Retournez uniquement un JSON valide, sans Markdown ni texte supplémentaire.', task: 'TÂCHE À ÉVALUER :', attached: 'la tâche décrite dans le document joint', material: 'INSTRUCTIONS / MATÉRIEL DE LA TÂCHE :', exact: 'Générez EXACTEMENT', weighted: 'Attribuez à chaque critère un « weight » en pourcentage ; la somme doit être égale à 100.', exactFormat: 'FORMAT JSON EXACT :', descriptors: '« descriptors » doit contenir exactement', criterionFallback: 'Critère', rubricFallback: 'Rubrique' },
    de: { role: 'Sie sind eine erfahrene Lehrkraft für kriteriumsbasierte Bewertung und formulieren Rubrikdeskriptoren.', lang: 'Schreiben Sie VOLLSTÄNDIG auf', json: 'Geben Sie AUSSCHLIESSLICH den verlangten Deskriptortext aus: ein oder zwei Sätze, ohne Anführungszeichen, Namen von Stufe oder Kriterium und ohne Markdown.', complete: 'VOLLSTÄNDIGE RUBRIK (damit der neue Deskriptor zu den anderen passt):', criterion: 'KRITERIUM:', level: 'ZU FORMULIERENDE STUFE:', teacher: 'ANWEISUNG DER LEHRKRAFT:', cell: 'Formulieren Sie den Deskriptor für DIESE Zelle.', taskRole: 'Sie sind eine erfahrene Lehrkraft für Bewertung und entwerfen analytische Rubriken.', taskLang: 'Schreiben Sie ALLES auf', taskJson: 'Geben Sie ausschließlich gültiges JSON ohne Markdown oder zusätzlichen Text aus.', task: 'ZU BEWERTENDE AUFGABE:', attached: 'die im angehängten Dokument beschriebene Aufgabe', material: 'ANWEISUNGEN / MATERIAL DER AUFGABE:', exact: 'Erzeugen Sie GENAU', weighted: 'Weisen Sie jedem Kriterium ein prozentuales „weight“ zu; die Summe muss 100 ergeben.', exactFormat: 'EXAKTES JSON-FORMAT:', descriptors: '„descriptors“ muss genau', criterionFallback: 'Kriterium', rubricFallback: 'Rubrik' },
    pt: { role: 'És um docente especialista em avaliação por critérios que redige descritores de rubricas.', lang: 'Escreve INTEGRALMENTE em', json: 'Devolve APENAS o texto do descritor pedido: uma ou duas frases, sem aspas, sem o nome do nível ou do critério, sem Markdown.', complete: 'RÚBRICA COMPLETA (para que o novo descritor se articule com os restantes):', criterion: 'CRITÉRIO:', level: 'NÍVEL A REDIGIR:', teacher: 'INDICAÇÃO DO DOCENTE:', cell: 'Redige o descritor dessa célula.', taskRole: 'És um docente especialista em avaliação que concebe rubricas analíticas.', taskLang: 'Redige TUDO em', taskJson: 'Devolve apenas JSON válido, sem Markdown nem texto adicional.', task: 'TAREFA A AVALIAR:', attached: 'a tarefa descrita no documento anexo', material: 'INSTRUÇÕES / MATERIAL DA TAREFA:', exact: 'Gera EXATAMENTE', weighted: 'Atribui a cada critério um "weight" em percentagem; os pesos devem somar 100.', exactFormat: 'FORMATO JSON EXATO:', descriptors: '"descriptors" deve conter exatamente', criterionFallback: 'Critério', rubricFallback: 'Rubrica' },
    'pt-BR': { role: 'Você é um professor especialista em avaliação por critérios que redige descritores de rubrica.', lang: 'Escreva INTEIRAMENTE em', json: 'Retorne SOMENTE o texto do descritor solicitado: uma ou duas frases, sem aspas, sem o nome do nível ou do critério, sem Markdown.', complete: 'RUBRICA COMPLETA (para que o novo descritor se encaixe nos demais):', criterion: 'CRITÉRIO:', level: 'NÍVEL A REDIGIR:', teacher: 'INSTRUÇÃO DO PROFESSOR:', cell: 'Redija o descritor dessa célula.', taskRole: 'Você é um professor especialista em avaliação que cria rubricas analíticas.', taskLang: 'Redija TUDO em', taskJson: 'Retorne somente JSON válido, sem Markdown nem texto adicional.', task: 'TAREFA A AVALIAR:', attached: 'a tarefa descrita no documento anexado', material: 'INSTRUÇÕES / MATERIAL DA TAREFA:', exact: 'Gere EXATAMENTE', weighted: 'Atribua a cada critério um "weight" em porcentagem; os pesos devem somar 100.', exactFormat: 'FORMATO JSON EXATO:', descriptors: '"descriptors" deve conter exatamente', criterionFallback: 'Critério', rubricFallback: 'Rubrica' },
    it: { role: 'Sei un docente esperto nella valutazione per criteri e redigi descrittori di rubrica.', lang: 'Scrivi INTERAMENTE in', json: 'Restituisci SOLO il testo del descrittore richiesto: una o due frasi, senza virgolette, senza il nome del livello o del criterio e senza Markdown.', complete: 'RUBRICA COMPLETA (per far sì che il nuovo descrittore sia coerente con gli altri):', criterion: 'CRITERIO:', level: 'LIVELLO DA REDIGERE:', teacher: 'ISTRUZIONE DEL DOCENTE:', cell: 'Redigi il descrittore di QUELLA cella.', taskRole: 'Sei un docente esperto di valutazione che progetta rubriche analitiche.', taskLang: 'Scrivi TUTTO in', taskJson: 'Restituisci solo JSON valido, senza Markdown né testo aggiuntivo.', task: 'COMPITO DA VALUTARE:', attached: 'il compito descritto nel documento allegato', material: 'ISTRUZIONI / MATERIALE DEL COMPITO:', exact: 'Genera ESATTAMENTE', weighted: 'Assegna a ogni criterio un "weight" in percentuale; i pesi devono sommare 100.', exactFormat: 'FORMATO JSON ESATTO:', descriptors: '"descriptors" deve contenere esattamente', criterionFallback: 'Criterio', rubricFallback: 'Rubrica' },
    tr: { role: 'Ölçüt temelli değerlendirmede uzman bir öğretmensiniz ve rubrik açıklamaları yazarsınız.', lang: 'TAMAMEN şu dilde yazın:', json: 'YALNIZCA istenen açıklama metnini döndürün: tırnak işareti, düzey veya ölçüt adı ve Markdown olmadan bir ya da iki cümle.', complete: 'TAM RUBRİK (yeni açıklamanın diğerleriyle uyumlu olması için):', criterion: 'ÖLÇÜT:', level: 'YAZILACAK DÜZEY:', teacher: 'ÖĞRETMENİN YÖNERGESİ:', cell: 'BU hücrenin açıklamasını yazın.', taskRole: 'Analitik rubrikler tasarlayan uzman bir değerlendirme öğretmenisiniz.', taskLang: 'HER ŞEYİ şu dilde yazın:', taskJson: 'Markdown veya ek metin olmadan yalnızca geçerli JSON döndürün.', task: 'DEĞERLENDİRİLECEK GÖREV:', attached: 'ekli belgede açıklanan görev', material: 'GÖREV TALİMATLARI / MATERYALİ:', exact: 'TAM OLARAK', weighted: 'Her ölçüte yüzde olarak bir "weight" atayın; ağırlıkların toplamı 100 olmalıdır.', exactFormat: 'KESİN JSON BİÇİMİ:', descriptors: '"descriptors" tam olarak şu kadar öğe içermelidir:', criterionFallback: 'Ölçüt', rubricFallback: 'Rubrik' },
  }[language];
  return {
    languageNames: rubricLanguageNames[language], descriptorRules: RULES[language], systemRole: text.role, systemLanguage: text.lang, systemJson: text.json, systemDescriptorOutput: text.json,
    taskSystemRole: text.taskRole, taskSystemLanguage: text.taskLang, taskSystemJson: text.taskJson,
    independentCriteria: ({ es: 'Los criterios deben ser independientes entre sí y cubrir la tarea sin solaparse.', en: 'Criteria must be independent of one another and cover the task without overlap.', fr: 'Les critères doivent être indépendants et couvrir la tâche sans se chevaucher.', de: 'Die Kriterien müssen unabhängig voneinander sein und die Aufgabe ohne Überschneidungen abdecken.', pt: 'Os critérios devem ser independentes entre si e abranger a tarefa sem sobreposição.', 'pt-BR': 'Os critérios devem ser independentes entre si e abranger a tarefa sem sobreposição.', it: 'I criteri devono essere indipendenti tra loro e coprire il compito senza sovrapporsi.', tr: 'Ölçütler birbirinden bağımsız olmalı ve görevi örtüşmeden kapsamalıdır.' } as Record<PromptLanguage, string>)[language],
    rubricComplete: text.complete, criterion: text.criterion, level: text.level,
    levelsPosition: (index, count) => ({ es: `Es ${index === 0 ? 'el nivel MÁS ALTO' : index === count - 1 ? 'el nivel MÁS BAJO' : `el nivel ${index + 1}`} de ${count} niveles, ordenados de mayor a menor desempeño.`, en: `It is ${index === 0 ? 'the HIGHEST level' : index === count - 1 ? 'the LOWEST level' : `level ${index + 1}`} of ${count} levels, ordered from highest to lowest performance.`, fr: `C’est ${index === 0 ? 'le niveau le PLUS ÉLEVÉ' : index === count - 1 ? 'le niveau le PLUS FAIBLE' : `le niveau ${index + 1}`} sur ${count}, classés du plus haut au plus bas.`, de: `Dies ist ${index === 0 ? 'die HÖCHSTE' : index === count - 1 ? 'die NIEDRIGSTE' : `Stufe ${index + 1}`} von ${count} Leistungsstufen, von hoch nach niedrig geordnet.`, pt: `É ${index === 0 ? 'o nível MAIS ALTO' : index === count - 1 ? 'o nível MAIS BAIXO' : `o nível ${index + 1}`} de ${count} níveis, ordenados do desempenho mais alto para o mais baixo.`, 'pt-BR': `É ${index === 0 ? 'o nível MAIS ALTO' : index === count - 1 ? 'o nível MAIS BAIXO' : `o nível ${index + 1}`} de ${count} níveis, ordenados do maior para o menor desempenho.`, it: `È ${index === 0 ? 'il livello PIÙ ALTO' : index === count - 1 ? 'il livello PIÙ BASSO' : `il livello ${index + 1}`} di ${count}, ordinati dalla prestazione più alta a quella più bassa.`, tr: `${count} düzey içinde en yüksekten en düşüğe sıralandığında ${index === 0 ? 'EN YÜKSEK' : index === count - 1 ? 'EN DÜŞÜK' : `${index + 1}.`} düzeydir.` } as Record<PromptLanguage, string>)[language],
    teacherInstruction: text.teacher, writeCell: text.cell, task: text.task, attachedTask: text.attached, sourceMaterial: text.material, sourceSearchFallback: ({ es: 'criterios de evaluación de la tarea', en: 'task assessment criteria', fr: 'critères d’évaluation de la tâche', de: 'Bewertungskriterien der Aufgabe', pt: 'critérios de avaliação da tarefa', 'pt-BR': 'critérios de avaliação da tarefa', it: 'criteri di valutazione del compito', tr: 'görevin değerlendirme ölçütleri' } as Record<PromptLanguage, string>)[language], exactCounts: (c, l) => ({ es: `Genera EXACTAMENTE ${c} criterios y ${l} niveles de desempeño, ordenados de MAYOR a MENOR.`, en: `Generate EXACTLY ${c} criteria and ${l} performance levels, ordered from HIGHEST to LOWEST.`, fr: `Générez EXACTEMENT ${c} critères et ${l} niveaux de performance, classés du PLUS ÉLEVÉ au PLUS FAIBLE.`, de: `Erzeugen Sie GENAU ${c} Kriterien und ${l} Leistungsstufen, von HOCH nach NIEDRIG geordnet.`, pt: `Gera EXATAMENTE ${c} critérios e ${l} níveis de desempenho, ordenados do MAIOR para o MENOR.`, 'pt-BR': `Gere EXATAMENTE ${c} critérios e ${l} níveis de desempenho, ordenados do MAIOR para o MENOR.`, it: `Genera ESATTAMENTE ${c} criteri e ${l} livelli di prestazione, ordinati dal PIÙ ALTO al PIÙ BASSO.`, tr: `TAM OLARAK ${c} ölçüt ve ${l} performans düzeyi üretin; en YÜKSEKTEN en DÜŞÜĞE sıralayın.` } as Record<PromptLanguage, string>)[language], weighted: text.weighted, exactJson: text.exactFormat, jsonFormat: (weighted) => rubricJsonFormat(language, weighted), descriptorCount: (l) => `${text.descriptors} ${l} ${language === 'es' ? 'elementos, en el MISMO orden que "levels".' : language === 'en' ? 'elements, in the SAME order as "levels".' : language === 'fr' ? 'éléments, dans le MÊME ordre que "levels".' : language === 'de' ? 'Elemente in derselben Reihenfolge wie "levels" enthalten.' : language === 'it' ? 'elementi, nello STESSO ordine di "levels".' : language === 'tr' ? 'öğeler içermeli ve "levels" ile AYNI sırada olmalıdır.' : 'elementos, na MESMA ordem que "levels".'}`, criterionFallback: text.criterionFallback, rubricFallback: text.rubricFallback,
  };
}

export const TEACHING_PROMPT_PACKS: Record<PromptLanguage, TeachingPromptPack> = {
  es: { exam: makeExamPack('es', ES_EXAM_LABELS), rubric: makeRubricPack('es') },
  en: { exam: makeExamPack('en', EN_EXAM_LABELS), rubric: makeRubricPack('en') },
  fr: { exam: makeExamPack('fr', FR_EXAM_LABELS), rubric: makeRubricPack('fr') },
  de: { exam: makeExamPack('de', DE_EXAM_LABELS), rubric: makeRubricPack('de') },
  pt: { exam: makeExamPack('pt', PT_EXAM_LABELS), rubric: makeRubricPack('pt') },
  'pt-BR': { exam: makeExamPack('pt-BR', PT_BR_EXAM_LABELS), rubric: makeRubricPack('pt-BR') },
  it: { exam: makeExamPack('it', IT_EXAM_LABELS), rubric: makeRubricPack('it') },
  tr: { exam: makeExamPack('tr', TR_EXAM_LABELS), rubric: makeRubricPack('tr') },
};

export function teachingPromptPack(language: PromptLanguage = 'es'): TeachingPromptPack {
  return TEACHING_PROMPT_PACKS[language] ?? TEACHING_PROMPT_PACKS.es;
}
