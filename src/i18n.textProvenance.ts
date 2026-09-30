// Translations for the text-provenance notes in the work status window (WorkStatusModal.tsx):
// pages recovered by OCR, missing text, and pages the OCR page cap left out.
const KEYS = [
  '{n} páginas recuperadas por OCR',
  '{n} páginas sin procesar por el límite de OCR ({cap} páginas): súbelo en Ajustes y vuelve a extraer el texto',
  '{n} páginas sin procesar por el límite de OCR: súbelo en Ajustes y vuelve a extraer el texto',
  '{n} páginas sin texto recuperado',
  'La extracción por OCR no se completó. Reintenta la extracción del texto.',
] as const;

function table(values: readonly string[]): Record<string, string> {
  if (values.length !== KEYS.length) throw new Error('Text-provenance translations are incomplete.');
  return Object.fromEntries(KEYS.map((key, index) => [key, values[index]]));
}

export const TEXT_PROVENANCE_TRANSLATIONS = {
  en: table(['{n} pages recovered by OCR', '{n} pages not processed because of the OCR page limit ({cap} pages): raise it in Settings and re-extract the text', '{n} pages not processed because of the OCR page limit: raise it in Settings and re-extract the text', '{n} pages without recovered text', 'OCR extraction did not complete. Retry text extraction.']),
  fr: table(['{n} pages récupérées par OCR', '{n} pages non traitées à cause de la limite OCR ({cap} pages) : augmentez-la dans Réglages et ré-extrayez le texte', '{n} pages non traitées à cause de la limite OCR : augmentez-la dans Réglages et ré-extrayez le texte', '{n} pages sans texte récupéré', 'L’extraction OCR ne s’est pas terminée. Relancez l’extraction du texte.']),
  de: table(['{n} Seiten per OCR wiederhergestellt', '{n} Seiten wegen des OCR-Seitenlimits ({cap} Seiten) nicht verarbeitet: in den Einstellungen erhöhen und den Text neu extrahieren', '{n} Seiten wegen des OCR-Seitenlimits nicht verarbeitet: in den Einstellungen erhöhen und den Text neu extrahieren', '{n} Seiten ohne wiederhergestellten Text', 'Die OCR-Textextraktion wurde nicht abgeschlossen. Starten Sie die Textextraktion erneut.']),
  it: table(['{n} pagine recuperate tramite OCR', '{n} pagine non elaborate per il limite OCR ({cap} pagine): aumentalo nelle Impostazioni ed estrai di nuovo il testo', '{n} pagine non elaborate per il limite OCR: aumentalo nelle Impostazioni ed estrai di nuovo il testo', '{n} pagine senza testo recuperato', 'L’estrazione OCR non è stata completata. Riprova a estrarre il testo.']),
  pt: table(['{n} páginas recuperadas por OCR', '{n} páginas não processadas devido ao limite de OCR ({cap} páginas): aumente-o nas Definições e volte a extrair o texto', '{n} páginas não processadas devido ao limite de OCR: aumente-o nas Definições e volte a extrair o texto', '{n} páginas sem texto recuperado', 'A extração por OCR não foi concluída. Volte a extrair o texto.']),
  'pt-BR': table(['{n} páginas recuperadas por OCR', '{n} páginas não processadas por causa do limite de OCR ({cap} páginas): aumente-o nas Configurações e extraia o texto novamente', '{n} páginas não processadas por causa do limite de OCR: aumente-o nas Configurações e extraia o texto novamente', '{n} páginas sem texto recuperado', 'A extração por OCR não foi concluída. Tente extrair o texto novamente.']),
  ja: table(['{n} ページのテキストを OCR で復元', 'OCR のページ上限（{cap} ページ）のため {n} ページが未処理です。設定で上限を上げ、テキストを再抽出してください', 'OCR のページ上限のため {n} ページが未処理です。設定で上限を上げ、テキストを再抽出してください', '{n} ページのテキストを復元できませんでした', 'OCR によるテキスト抽出が完了しませんでした。テキスト抽出を再試行してください。']),
  ko: table(['OCR로 {n}페이지의 텍스트 복구', 'OCR 페이지 한도({cap}페이지) 때문에 {n}페이지가 처리되지 않았습니다. 설정에서 한도를 올리고 텍스트를 다시 추출하세요', 'OCR 페이지 한도 때문에 {n}페이지가 처리되지 않았습니다. 설정에서 한도를 올리고 텍스트를 다시 추출하세요', '{n}페이지의 텍스트를 복구하지 못했습니다', 'OCR 텍스트 추출이 완료되지 않았습니다. 텍스트 추출을 다시 시도하세요.']),
  tr: table(['{n} sayfanın metni OCR ile kurtarıldı', 'OCR sayfa sınırı ({cap} sayfa) nedeniyle {n} sayfa işlenmedi: Ayarlar’da sınırı yükseltip metni yeniden çıkarın', 'OCR sayfa sınırı nedeniyle {n} sayfa işlenmedi: Ayarlar’da sınırı yükseltip metni yeniden çıkarın', '{n} sayfanın metni kurtarılamadı', 'OCR ile metin çıkarma tamamlanmadı. Metni çıkarmayı yeniden deneyin.']),
  'zh-CN': table(['已通过 OCR 恢复 {n} 页文本', '因 OCR 页数上限（{cap} 页），{n} 页未处理：请在设置中提高上限并重新提取文本', '因 OCR 页数上限，{n} 页未处理：请在设置中提高上限并重新提取文本', '{n} 页未恢复出文本', 'OCR 文本提取未完成。请重试文本提取。']),
  'zh-TW': table(['已透過 OCR 復原 {n} 頁文字', '因 OCR 頁數上限（{cap} 頁），{n} 頁未處理：請在設定中提高上限並重新擷取文字', '因 OCR 頁數上限，{n} 頁未處理：請在設定中提高上限並重新擷取文字', '{n} 頁未復原出文字', 'OCR 文字擷取未完成。請重試文字擷取。']),
} as const;
