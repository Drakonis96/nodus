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
