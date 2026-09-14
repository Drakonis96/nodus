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
};
for (const [language, values] of Object.entries(dropTranslations)) translations[language].push(...values);
export const RESEARCH_ATTACHMENT_TRANSLATIONS = Object.fromEntries(Object.entries(translations).map(([language, values]) => [language, Object.fromEntries(keys.map((key, index) => [key, values[index]]))]));
