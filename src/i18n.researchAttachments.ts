/** Research chat file controls. Extraction failures are surfaced by the IPC error boundary. */
const keys = ['Añadir archivos', 'Archivos adjuntos', 'Quitar adjunto', 'Preparando archivos…', 'Analiza los archivos adjuntos.', 'Sin lector', 'Visión', 'Documento', 'y todo su historial de mensajes y archivos adjuntos. Esta acción no se puede deshacer.'];
const translations: Record<string, string[]> = {
  en: ['Add files', 'Attachments', 'Remove attachment', 'Preparing files…', 'Analyze the attached files.', 'No reader', 'Vision', 'Document', 'and all its messages and attached files. This action cannot be undone.'],
  fr: ['Ajouter des fichiers', 'Pièces jointes', 'Retirer la pièce jointe', 'Préparation des fichiers…', 'Analyse les fichiers joints.', 'Sans lecteur', 'Vision', 'Document', 'et tous ses messages et fichiers joints. Cette action est irréversible.'],
  de: ['Dateien hinzufügen', 'Anhänge', 'Anhang entfernen', 'Dateien werden vorbereitet…', 'Analysiere die angehängten Dateien.', 'Kein Leser', 'Bilderkennung', 'Dokument', 'und alle Nachrichten und angehängten Dateien. Diese Aktion kann nicht rückgängig gemacht werden.'],
  pt: ['Adicionar ficheiros', 'Anexos', 'Remover anexo', 'A preparar ficheiros…', 'Analisa os ficheiros anexados.', 'Sem leitor', 'Visão', 'Documento', 'e todas as suas mensagens e ficheiros anexados. Esta ação não pode ser anulada.'],
  'pt-BR': ['Adicionar arquivos', 'Anexos', 'Remover anexo', 'Preparando arquivos…', 'Analise os arquivos anexados.', 'Sem leitor', 'Visão', 'Documento', 'e todas as suas mensagens e arquivos anexados. Esta ação não pode ser desfeita.'],
  it: ['Aggiungi file', 'Allegati', 'Rimuovi allegato', 'Preparazione dei file…', 'Analizza i file allegati.', 'Nessun lettore', 'Visione', 'Documento', 'e tutti i suoi messaggi e file allegati. Questa azione non può essere annullata.'],
  tr: ['Dosya ekle', 'Ekler', 'Eki kaldır', 'Dosyalar hazırlanıyor…', 'Ekli dosyaları analiz et.', 'Okuyucu yok', 'Görü', 'Belge', 've tüm mesajları ve ekli dosyaları. Bu işlem geri alınamaz.'],
  'zh-CN': ["添加文件","附件","移除附件","正在准备文件…","分析附加的文件。","无阅读器","视觉","文档","以及其所有消息和附件。此操作无法撤销。"],
  'zh-TW': ["新增檔案","附件","移除附件","正在準備檔案…","分析附加的檔案。","無閱讀器","視覺","文件","以及其所有訊息和附件。此操作無法撤銷。"],
  ko: ["파일 추가", "첨부파일", "첨부파일 삭제", "파일 준비 중…", "첨부파일을 분석해 보세요.", "리더 없음", "비전", "문서", "모든 메시지와 첨부 파일. 이 작업은 취소할 수 없습니다."],
  ja: ["ファイルを追加する", "添付ファイル", "添付ファイルを削除する", "ファイルを準備しています…", "添付ファイルを解析します。", "リーダーがいません", "ビジョン", "書類", "およびそのすべてのメッセージと添付ファイル。この操作は元に戻すことができません。"],
};
keys.push('Suelta los archivos para adjuntarlos', 'No se pudieron leer los archivos arrastrados. Usa el botón + para añadirlos.');
const dropTranslations: Record<string, string[]> = {
  en: ['Drop files to attach them', 'Could not read the dropped files. Use the + button to add them.'],
  fr: ['Déposez les fichiers pour les joindre', 'Impossible de lire les fichiers déposés. Utilisez le bouton + pour les ajouter.'],
  de: ['Dateien zum Anhängen ablegen', 'Die abgelegten Dateien konnten nicht gelesen werden. Verwende die Schaltfläche +, um sie hinzuzufügen.'],
  pt: ['Larga os ficheiros para os anexar', 'Não foi possível ler os ficheiros arrastados. Usa o botão + para os adicionar.'],
  'pt-BR': ['Solte os arquivos para anexá-los', 'Não foi possível ler os arquivos arrastados. Use o botão + para adicioná-los.'],
  it: ['Rilascia i file per allegarli', 'Impossibile leggere i file trascinati. Usa il pulsante + per aggiungerli.'],
  tr: ['Eklemek için dosyaları bırakın', 'Bırakılan dosyalar okunamadı. Eklemek için + düğmesini kullanın.'],
  'zh-CN': ["拖放文件以添加为附件","无法读取拖入的文件。请使用 + 按钮添加它们。"],
  'zh-TW': ["拖放檔案以新增為附件","無法讀取拖入的檔案。請使用 + 按鈕新增它們。"],
  ko: ["첨부할 파일을 드롭하세요.", "삭제된 파일을 읽을 수 없습니다. + 버튼을 사용하여 추가하세요."],
  ja: ["ファイルをドロップして添付します", "ドロップされたファイルを読み取ることができませんでした。 + ボタンを使用して追加します。"],
};
for (const [language, values] of Object.entries(dropTranslations)) translations[language].push(...values);
export const RESEARCH_ATTACHMENT_TRANSLATIONS = Object.fromEntries(Object.entries(translations).map(([language, values]) => [language, Object.fromEntries(keys.map((key, index) => [key, values[index]]))]));
