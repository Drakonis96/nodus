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
