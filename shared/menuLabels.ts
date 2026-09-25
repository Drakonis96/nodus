import { uiText, type UiTranslations } from './uiLanguage';

/**
 * Native menu labels built in the main process.
 *
 * Electron builds the right-click menus (the text-field Cut/Copy/Paste and the whole browser
 * context menu) in the main process, where the renderer's i18n tables are not importable. Those
 * menus used to be handed a `t` that only walked `message`/`error` payload fields, so every label
 * reached the OS in its Spanish source form regardless of the selected language — an English
 * window showed "Cortar / Copiar / Pegar". The keys here are those Spanish source strings, so the
 * call sites keep their natural spelling; `menuLabel` resolves them for the current UI language.
 */
export const MENU_LABELS: Record<string, UiTranslations> = {
  Cortar: { es: 'Cortar', en: 'Cut', fr: 'Couper', de: 'Ausschneiden', pt: 'Cortar', 'pt-BR': 'Recortar', it: 'Taglia', tr: 'Kes', 'zh-CN': '剪切', 'zh-TW': '剪下', ja: '切り取り', ko: '잘라내기' },
  Copiar: { es: 'Copiar', en: 'Copy', fr: 'Copier', de: 'Kopieren', pt: 'Copiar', 'pt-BR': 'Copiar', it: 'Copia', tr: 'Kopyala', 'zh-CN': '复制', 'zh-TW': '複製', ja: 'コピー', ko: '복사' },
  Pegar: { es: 'Pegar', en: 'Paste', fr: 'Coller', de: 'Einfügen', pt: 'Colar', 'pt-BR': 'Colar', it: 'Incolla', tr: 'Yapıştır', 'zh-CN': '粘贴', 'zh-TW': '貼上', ja: '貼り付け', ko: '붙여넣기' },
  Atrás: { es: 'Atrás', en: 'Back', fr: 'Précédent', de: 'Zurück', pt: 'Anterior', 'pt-BR': 'Voltar', it: 'Indietro', tr: 'Geri', 'zh-CN': '后退', 'zh-TW': '上一頁', ja: '戻る', ko: '뒤로' },
  Adelante: { es: 'Adelante', en: 'Forward', fr: 'Suivant', de: 'Vorwärts', pt: 'Avançar', 'pt-BR': 'Avançar', it: 'Avanti', tr: 'İleri', 'zh-CN': '前进', 'zh-TW': '下一頁', ja: '進む', ko: '앞으로' },
  Recargar: { es: 'Recargar', en: 'Reload', fr: 'Recharger', de: 'Neu laden', pt: 'Recarregar', 'pt-BR': 'Recarregar', it: 'Ricarica', tr: 'Yenile', 'zh-CN': '重新加载', 'zh-TW': '重新載入', ja: '再読み込み', ko: '새로고침' },
  'Abrir enlace en una pestaña nueva': { es: 'Abrir enlace en una pestaña nueva', en: 'Open link in new tab', fr: 'Ouvrir le lien dans un nouvel onglet', de: 'Link in neuem Tab öffnen', pt: 'Abrir link num novo separador', 'pt-BR': 'Abrir link em nova aba', it: 'Apri link in una nuova scheda', tr: 'Bağlantıyı yeni sekmede aç', 'zh-CN': '在新标签页中打开链接', 'zh-TW': '在新分頁中開啟連結', ja: 'リンクを新しいタブで開く', ko: '새 탭에서 링크 열기' },
  'Abrir enlace en el navegador del sistema': { es: 'Abrir enlace en el navegador del sistema', en: 'Open link in system browser', fr: 'Ouvrir le lien dans le navigateur du système', de: 'Link im Systembrowser öffnen', pt: 'Abrir link no navegador do sistema', 'pt-BR': 'Abrir link no navegador do sistema', it: 'Apri link nel browser di sistema', tr: 'Bağlantıyı sistem tarayıcısında aç', 'zh-CN': '在系统浏览器中打开链接', 'zh-TW': '在系統瀏覽器中開啟連結', ja: 'システムブラウザーでリンクを開く', ko: '시스템 브라우저에서 링크 열기' },
  'Abrir la selección en una pestaña nueva': { es: 'Abrir la selección en una pestaña nueva', en: 'Open selection in new tab', fr: 'Ouvrir la sélection dans un nouvel onglet', de: 'Auswahl in neuem Tab öffnen', pt: 'Abrir a seleção num novo separador', 'pt-BR': 'Abrir a seleção em nova aba', it: 'Apri selezione in una nuova scheda', tr: 'Seçimi yeni sekmede aç', 'zh-CN': '在新标签页中打开所选内容', 'zh-TW': '在新分頁中開啟選取範圍', ja: '選択範囲を新しいタブで開く', ko: '새 탭에서 선택 항목 열기' },
  'Buscar «{q}»': { es: 'Buscar «{q}»', en: 'Search “{q}”', fr: 'Rechercher « {q} »', de: 'Nach „{q}“ suchen', pt: 'Pesquisar «{q}»', 'pt-BR': 'Pesquisar «{q}»', it: 'Cerca «{q}»', tr: '«{q}» ara', 'zh-CN': '搜索“{q}”', 'zh-TW': '搜尋「{q}」', ja: '「{q}」を検索', ko: '“{q}” 검색' },
  'Citar con Nodi': { es: 'Citar con Nodi', en: 'Quote with Nodi', fr: 'Citer avec Nodi', de: 'Mit Nodi zitieren', pt: 'Citar com Nodi', 'pt-BR': 'Citar com Nodi', it: 'Cita con Nodi', tr: 'Nodi ile alıntıla', 'zh-CN': '用 Nodi 引用', 'zh-TW': '用 Nodi 引用', ja: 'Nodi で引用', ko: 'Nodi로 인용' },
  'Copiar dirección del enlace': { es: 'Copiar dirección del enlace', en: 'Copy link address', fr: 'Copier l’adresse du lien', de: 'Linkadresse kopieren', pt: 'Copiar endereço do link', 'pt-BR': 'Copiar endereço do link', it: 'Copia indirizzo del link', tr: 'Bağlantı adresini kopyala', 'zh-CN': '复制链接地址', 'zh-TW': '複製連結位址', ja: 'リンクのアドレスをコピー', ko: '링크 주소 복사' },
  'Preguntar a Nodi sobre esta página': { es: 'Preguntar a Nodi sobre esta página', en: 'Ask Nodi about this page', fr: 'Demander à Nodi à propos de cette page', de: 'Nodi zu dieser Seite fragen', pt: 'Perguntar ao Nodi sobre esta página', 'pt-BR': 'Perguntar ao Nodi sobre esta página', it: 'Chiedi a Nodi di questa pagina', tr: 'Bu sayfayı Nodi’ye sor', 'zh-CN': '向 Nodi 询问此页面', 'zh-TW': '向 Nodi 詢問此頁面', ja: 'このページについて Nodi に聞く', ko: 'Nodi에게 이 페이지 묻기' },
  'Añadir a la Biblioteca': { es: 'Añadir a la Biblioteca', en: 'Add to Library', fr: 'Ajouter à la bibliothèque', de: 'Zur Bibliothek hinzufügen', pt: 'Adicionar à Biblioteca', 'pt-BR': 'Adicionar à Biblioteca', it: 'Aggiungi alla Libreria', tr: 'Kitaplığa ekle', 'zh-CN': '添加到资料库', 'zh-TW': '加入資料庫', ja: 'ライブラリに追加', ko: '라이브러리에 추가' },
  'Añadir marcador': { es: 'Añadir marcador', en: 'Add bookmark', fr: 'Ajouter un signet', de: 'Lesezeichen hinzufügen', pt: 'Adicionar marcador', 'pt-BR': 'Adicionar favorito', it: 'Aggiungi segnalibro', tr: 'Yer imi ekle', 'zh-CN': '添加书签', 'zh-TW': '新增書籤', ja: 'ブックマークを追加', ko: '북마크 추가' },
};

/** Resolve a native menu label for the current UI language; unknown keys pass through. */
export function menuLabel(key: string, language: unknown): string {
  const entry = MENU_LABELS[key];
  return entry ? uiText(language, entry) : key;
}
