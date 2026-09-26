import type { PromptLanguage } from './types';
const messages: Record<PromptLanguage, string> = {
  es: 'La evidencia disponible no permite responder con respaldo suficiente. Revisa las fuentes seleccionadas, el texto accesible y los documentos pendientes. No se han completado las afirmaciones que no pudieron verificarse.',
  en: 'The available evidence cannot support a sufficient answer. Review the selected sources, accessible text and pending documents. Claims that could not be verified have been omitted.',
  fr: 'Les preuves disponibles ne permettent pas de répondre de manière suffisamment étayée. Vérifiez les sources sélectionnées, le texte accessible et les documents en attente. Les affirmations invérifiables ont été omises.',
  de: 'Die verfügbaren Belege reichen für eine fundierte Antwort nicht aus. Prüfen Sie die ausgewählten Quellen, zugänglichen Texte und ausstehenden Dokumente. Nicht überprüfbare Aussagen wurden ausgelassen.',
  pt: 'A evidência disponível não permite uma resposta suficientemente fundamentada. Reveja as fontes selecionadas, o texto acessível e os documentos pendentes. Foram omitidas as afirmações que não puderam ser verificadas.',
  'pt-BR': 'As evidências disponíveis não permitem uma resposta suficientemente fundamentada. Revise as fontes selecionadas, o texto acessível e os documentos pendentes. As afirmações que não puderam ser verificadas foram omitidas.',
  it: 'Le prove disponibili non consentono una risposta sufficientemente fondata. Controlla le fonti selezionate, il testo accessibile e i documenti in attesa. Le affermazioni non verificabili sono state omesse.',
  tr: 'Mevcut kanıtlar yeterince desteklenen bir yanıt için yetersiz. Seçilen kaynakları, erişilebilir metinleri ve bekleyen belgeleri gözden geçirin. Doğrulanamayan iddialar çıkarıldı.',
  'zh-Hans': '现有证据不足以支持回答。请检查所选来源、可访问的文本和待处理文档。无法核实的陈述已省略。',
  'zh-Hant': '現有證據不足以支持回答。請檢查所選來源、可存取的文字和待處理文件。無法核實的陳述已省略。',
  ja: '利用可能な証拠では十分な根拠のある回答を作成できません。選択した出典、読めるテキスト、未処理の文書を確認してください。検証できない主張は省略しました。',
  ko: '현재 증거로는 충분한 근거가 있는 답변을 제공할 수 없습니다. 선택한 출처, 접근 가능한 텍스트와 대기 중인 문서를 확인하세요. 검증할 수 없는 주장은 생략했습니다.',
  vi: 'Bằng chứng hiện có chưa đủ để trả lời có căn cứ. Hãy xem lại các nguồn đã chọn, văn bản có thể truy cập và tài liệu đang chờ xử lý. Các nhận định không thể xác minh đã được lược bỏ.',
  ru: 'Доступных доказательств недостаточно для обоснованного ответа. Проверьте выбранные источники, доступные тексты и ожидающие обработки документы. Непроверенные утверждения исключены.',
  uk: 'Доступних доказів недостатньо для обґрунтованої відповіді. Перевірте вибрані джерела, доступні тексти й документи, що очікують обробки. Неперевірені твердження вилучено.',
};
export const researchEvidenceLimitation = (language: PromptLanguage): string => messages[language];
const consistencyMessages: Record<PromptLanguage, string> = {
  es: 'No se pudo comprobar la coherencia interna del informe; trátalo como un borrador sin verificar.',
  en: 'The report\'s internal consistency could not be checked; treat it as an unverified draft.',
  fr: 'La cohérence interne du rapport n\'a pas pu être vérifiée ; traitez-le comme un brouillon non vérifié.',
  de: 'Die innere Widerspruchsfreiheit des Berichts konnte nicht geprüft werden; behandeln Sie ihn als ungeprüften Entwurf.',
  pt: 'Não foi possível verificar a coerência interna do relatório; trate-o como um rascunho não verificado.',
  'pt-BR': 'Não foi possível verificar a coerência interna do relatório; trate-o como um rascunho não verificado.',
  it: 'Non è stato possibile verificare la coerenza interna del rapporto; consideralo una bozza non verificata.',
  tr: 'Raporun iç tutarlılığı denetlenemedi; doğrulanmamış bir taslak olarak değerlendirin.',
  'zh-Hans': '无法检查报告的内部一致性；请将其视为未经核实的草稿。',
  'zh-Hant': '無法檢查報告的內部一致性；請將其視為未經核實的草稿。',
  ja: 'レポートの内部整合性を確認できませんでした。未検証の草稿として扱ってください。',
  ko: '보고서의 내부 일관성을 확인할 수 없었습니다. 검증되지 않은 초안으로 취급하세요.',
  vi: 'Không thể kiểm tra tính nhất quán nội bộ của báo cáo; hãy coi đây là bản nháp chưa được xác minh.',
  ru: 'Не удалось проверить внутреннюю согласованность отчёта; считайте его непроверенным черновиком.',
  uk: 'Не вдалося перевірити внутрішню узгодженість звіту; вважайте його неперевіреною чернеткою.',
};
export const researchConsistencyUnverified = (language: PromptLanguage): string => consistencyMessages[language];

const coverageMessages: Record<PromptLanguage, string> = {
  "es": "El informe no desarrolla todas las proposiciones del plan con evidencia verificada. Revisa las omisiones antes de utilizarlo como respuesta completa.",
  "en": "The report does not develop every planned proposition with verified evidence. Review the omissions before using it as a complete answer.",
  "fr": "Le rapport ne développe pas toutes les propositions du plan avec des preuves vérifiées. Examinez les omissions avant de le considérer comme une réponse complète.",
  "de": "Der Bericht behandelt nicht alle geplanten Aussagen mit überprüften Belegen. Prüfen Sie die Auslassungen, bevor Sie ihn als vollständige Antwort verwenden.",
  "it": "Il rapporto non sviluppa tutte le proposizioni del piano con prove verificate. Esamina le omissioni prima di usarlo come risposta completa.",
  "pt": "O relatório não desenvolve todas as proposições do plano com evidência verificada. Reveja as omissões antes de o usar como resposta completa.",
  "pt-BR": "O relatório não desenvolve todas as proposições do plano com evidências verificadas. Revise as omissões antes de usá-lo como resposta completa.",
  "tr": "Rapor, plandaki tüm önermeleri doğrulanmış kanıtlarla geliştirmiyor. Tam bir yanıt olarak kullanmadan önce eksikleri gözden geçirin.",
  "zh-Hans": "报告未以经核实的证据展开计划中的所有命题。将其作为完整回答使用前，请检查遗漏。",
  "zh-Hant": "報告未以經核實的證據展開計畫中的所有命題。將其作為完整回答使用前，請檢查遺漏。",
  "ja": "計画されたすべての命題が検証済みの証拠で展開されているわけではありません。完全な回答として使用する前に欠落を確認してください。",
  "ko": "보고서가 계획의 모든 명제를 검증된 근거로 설명하지는 않습니다. 완전한 답변으로 사용하기 전에 누락을 확인하세요.",
  "vi": "Báo cáo chưa triển khai mọi luận điểm trong kế hoạch bằng bằng chứng đã xác minh. Hãy xem lại các phần thiếu trước khi dùng làm câu trả lời đầy đủ.",
  "ru": "Отчёт раскрывает не все положения плана на основе проверенных доказательств. Проверьте пропуски, прежде чем использовать его как полный ответ.",
  "uk": "Звіт розкриває не всі положення плану на основі перевірених доказів. Перегляньте пропуски, перш ніж використовувати його як повну відповідь."
};
export const researchCoverageIncomplete = (language: PromptLanguage): string => coverageMessages[language];
