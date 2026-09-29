// Translations for the text-provenance notes in the work status window (WorkStatusModal.tsx):
// pages read by OCR, and pages the OCR page cap left out.
const KEYS = [
  'escaneado: {n} páginas leídas por OCR',
  '{n} páginas sin procesar por el límite de OCR ({cap} páginas): súbelo en Ajustes y vuelve a extraer el texto',
] as const;

function table(values: readonly string[]): Record<string, string> {
  if (values.length !== KEYS.length) throw new Error('Text-provenance translations are incomplete.');
  return Object.fromEntries(KEYS.map((key, index) => [key, values[index]]));
}

export const TEXT_PROVENANCE_TRANSLATIONS = {
  en: table(['scanned: {n} pages read by OCR', '{n} pages not processed because of the OCR page limit ({cap} pages): raise it in Settings and re-extract the text']),
  fr: table(['numérisé : {n} pages lues par OCR', '{n} pages non traitées à cause de la limite OCR ({cap} pages) : augmentez-la dans Réglages et ré-extrayez le texte']),
  de: table(['gescannt: {n} Seiten per OCR gelesen', '{n} Seiten wegen des OCR-Seitenlimits ({cap} Seiten) nicht verarbeitet: in den Einstellungen erhöhen und den Text neu extrahieren']),
  it: table(['scansionato: {n} pagine lette con OCR', '{n} pagine non elaborate per il limite OCR ({cap} pagine): aumentalo nelle Impostazioni ed estrai di nuovo il testo']),
  pt: table(['digitalizado: {n} páginas lidas por OCR', '{n} páginas não processadas devido ao limite de OCR ({cap} páginas): aumente-o nas Definições e volte a extrair o texto']),
  'pt-BR': table(['digitalizado: {n} páginas lidas por OCR', '{n} páginas não processadas por causa do limite de OCR ({cap} páginas): aumente-o nas Configurações e extraia o texto novamente']),
  ja: table(['スキャン: {n} ページを OCR で読み取り', 'OCR のページ上限（{cap} ページ）のため {n} ページが未処理です。設定で上限を上げ、テキストを再抽出してください']),
  ko: table(['스캔됨: {n}페이지를 OCR로 읽음', 'OCR 페이지 한도({cap}페이지) 때문에 {n}페이지가 처리되지 않았습니다. 설정에서 한도를 올리고 텍스트를 다시 추출하세요']),
  tr: table(['taranmış: {n} sayfa OCR ile okundu', 'OCR sayfa sınırı ({cap} sayfa) nedeniyle {n} sayfa işlenmedi: Ayarlar’da sınırı yükseltip metni yeniden çıkarın']),
  'zh-CN': table(['扫描件：{n} 页经 OCR 识别', '因 OCR 页数上限（{cap} 页），{n} 页未处理：请在设置中提高上限并重新提取文本']),
  'zh-TW': table(['掃描檔：{n} 頁經 OCR 辨識', '因 OCR 頁數上限（{cap} 頁），{n} 頁未處理：請在設定中提高上限並重新擷取文字']),
} as const;
