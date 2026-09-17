import type { AppLanguage } from '@shared/types';
import { uiText, type UiTranslations } from '@shared/uiLanguage';

export type ToolkitDialogKey =
  | 'allFiles'
  | 'compatibleFiles'
  | 'addFiles'
  | 'outputFolder'
  | 'saveTranslation'
  | 'exportTranscript'
  | 'exportTranscripts'
  | 'addOcrFiles'
  | 'pdfAndImages'
  | 'importPresentation'
  | 'pdfAndPresentations'
  | 'presentations'
  | 'importPowerPointNotes'
  | 'exportPresenterNotes'
  | 'downloadPresentation'
  | 'importTxtNotes'
  | 'text'
  | 'downloadAppPackage'
  | 'zipPackage'
  | 'selectProtectDocuments'
  | 'compatiblePdfAndImages'
  | 'saveProtectedCopy'
  | 'saveForSharing'
  | 'downloadProtectedCopy';

const COPY: Record<ToolkitDialogKey, UiTranslations> = {
  allFiles: { es: 'Todos los archivos', en: 'All files', fr: 'Tous les fichiers', de: 'Alle Dateien', pt: 'Todos os ficheiros', 'pt-BR': 'Todos os arquivos', it: 'Tutti i file', tr: 'Tüm dosyalar', 'zh-CN': '所有文件' },
  compatibleFiles: { es: 'Archivos compatibles', en: 'Compatible files', fr: 'Fichiers compatibles', de: 'Kompatible Dateien', pt: 'Ficheiros compatíveis', 'pt-BR': 'Arquivos compatíveis', it: 'File compatibili', tr: 'Uyumlu dosyalar', 'zh-CN': '兼容文件' },
  addFiles: { es: 'Añadir archivos', en: 'Add files', fr: 'Ajouter des fichiers', de: 'Dateien hinzufügen', pt: 'Adicionar ficheiros', 'pt-BR': 'Adicionar arquivos', it: 'Aggiungi file', tr: 'Dosya ekle', 'zh-CN': '添加文件' },
  outputFolder: { es: 'Carpeta de salida', en: 'Output folder', fr: 'Dossier de sortie', de: 'Ausgabeordner', pt: 'Pasta de saída', 'pt-BR': 'Pasta de saída', it: 'Cartella di output', tr: 'Çıktı klasörü', 'zh-CN': '输出文件夹' },
  saveTranslation: { es: 'Guardar traducción', en: 'Save translation', fr: 'Enregistrer la traduction', de: 'Übersetzung speichern', pt: 'Guardar tradução', 'pt-BR': 'Salvar tradução', it: 'Salva traduzione', tr: 'Çeviriyi kaydet', 'zh-CN': '保存翻译' },
  exportTranscript: { es: 'Exportar transcripción', en: 'Export transcript', fr: 'Exporter la transcription', de: 'Transkription exportieren', pt: 'Exportar transcrição', 'pt-BR': 'Exportar transcrição', it: 'Esporta trascrizione', tr: 'Metin aktarımını dışa aktar', 'zh-CN': '导出转录文本' },
  exportTranscripts: { es: 'Exportar transcripciones', en: 'Export transcripts', fr: 'Exporter les transcriptions', de: 'Transkriptionen exportieren', pt: 'Exportar transcrições', 'pt-BR': 'Exportar transcrições', it: 'Esporta trascrizioni', tr: 'Metin aktarımlarını dışa aktar', 'zh-CN': '导出转录文本' },
  addOcrFiles: { es: 'Añadir PDF o imágenes para OCR', en: 'Add PDFs or images for OCR', fr: 'Ajouter des PDF ou des images pour l’OCR', de: 'PDFs oder Bilder für OCR hinzufügen', pt: 'Adicionar PDF ou imagens para OCR', 'pt-BR': 'Adicionar PDFs ou imagens para OCR', it: 'Aggiungi PDF o immagini per OCR', tr: 'OCR için PDF veya görsel ekle', 'zh-CN': '添加用于OCR的PDF或图片' },
  pdfAndImages: { es: 'PDF e imágenes', en: 'PDFs and images', fr: 'PDF et images', de: 'PDFs und Bilder', pt: 'PDF e imagens', 'pt-BR': 'PDFs e imagens', it: 'PDF e immagini', tr: 'PDF ve görseller', 'zh-CN': 'PDF和图片' },
  importPresentation: { es: 'Importar PDF o presentación', en: 'Import PDF or presentation', fr: 'Importer un PDF ou une présentation', de: 'PDF oder Präsentation importieren', pt: 'Importar PDF ou apresentação', 'pt-BR': 'Importar PDF ou apresentação', it: 'Importa PDF o presentazione', tr: 'PDF veya sunum içe aktar', 'zh-CN': '导入PDF或演示文稿' },
  pdfAndPresentations: { es: 'PDF y presentaciones', en: 'PDFs and presentations', fr: 'PDF et présentations', de: 'PDFs und Präsentationen', pt: 'PDF e apresentações', 'pt-BR': 'PDFs e apresentações', it: 'PDF e presentazioni', tr: 'PDF ve sunumlar', 'zh-CN': 'PDF和演示文稿' },
  presentations: { es: 'Presentaciones', en: 'Presentations', fr: 'Présentations', de: 'Präsentationen', pt: 'Apresentações', 'pt-BR': 'Apresentações', it: 'Presentazioni', tr: 'Sunumlar', 'zh-CN': '演示文稿' },
  importPowerPointNotes: { es: 'Importar notas desde PowerPoint', en: 'Import notes from PowerPoint', fr: 'Importer les notes depuis PowerPoint', de: 'Notizen aus PowerPoint importieren', pt: 'Importar notas do PowerPoint', 'pt-BR': 'Importar notas do PowerPoint', it: 'Importa note da PowerPoint', tr: 'PowerPoint’tan notları içe aktar', 'zh-CN': '从PowerPoint导入备注' },
  exportPresenterNotes: { es: 'Exportar notas del presentador', en: 'Export presenter notes', fr: 'Exporter les notes du présentateur', de: 'Präsentationsnotizen exportieren', pt: 'Exportar notas do apresentador', 'pt-BR': 'Exportar notas do apresentador', it: 'Esporta note del relatore', tr: 'Sunucu notlarını dışa aktar', 'zh-CN': '导出演讲者备注' },
  downloadPresentation: { es: 'Descargar presentación', en: 'Download presentation', fr: 'Télécharger la présentation', de: 'Präsentation herunterladen', pt: 'Transferir apresentação', 'pt-BR': 'Baixar apresentação', it: 'Scarica presentazione', tr: 'Sunumu indir', 'zh-CN': '下载演示文稿' },
  importTxtNotes: { es: 'Importar notas desde TXT', en: 'Import notes from TXT', fr: 'Importer les notes depuis un TXT', de: 'Notizen aus TXT importieren', pt: 'Importar notas de TXT', 'pt-BR': 'Importar notas de TXT', it: 'Importa note da TXT', tr: 'TXT’den notları içe aktar', 'zh-CN': '从TXT导入备注' },
  text: { es: 'Texto', en: 'Text', fr: 'Texte', de: 'Text', pt: 'Texto', 'pt-BR': 'Texto', it: 'Testo', tr: 'Metin', 'zh-CN': '文本' },
  downloadAppPackage: { es: 'Descargar paquete de la app', en: 'Download app package', fr: 'Télécharger le paquet de l’app', de: 'App-Paket herunterladen', pt: 'Transferir pacote da app', 'pt-BR': 'Baixar pacote do app', it: 'Scarica pacchetto dell’app', tr: 'Uygulama paketini indir', 'zh-CN': '下载应用包' },
  zipPackage: { es: 'Paquete ZIP', en: 'ZIP package', fr: 'Paquet ZIP', de: 'ZIP-Paket', pt: 'Pacote ZIP', 'pt-BR': 'Pacote ZIP', it: 'Pacchetto ZIP', tr: 'ZIP paketi', 'zh-CN': 'ZIP包' },
  selectProtectDocuments: { es: 'Seleccionar documentos para Nodus Protect', en: 'Select documents for Nodus Protect', fr: 'Sélectionner des documents pour Nodus Protect', de: 'Dokumente für Nodus Protect auswählen', pt: 'Selecionar documentos para o Nodus Protect', 'pt-BR': 'Selecionar documentos para o Nodus Protect', it: 'Seleziona documenti per Nodus Protect', tr: 'Nodus Protect için belge seç', 'zh-CN': '选择用于Nodus Protect的文档' },
  compatiblePdfAndImages: { es: 'PDF e imágenes compatibles', en: 'Compatible PDFs and images', fr: 'PDF et images compatibles', de: 'Kompatible PDFs und Bilder', pt: 'PDF e imagens compatíveis', 'pt-BR': 'PDFs e imagens compatíveis', it: 'PDF e immagini compatibili', tr: 'Uyumlu PDF ve görseller', 'zh-CN': '兼容的PDF和图片' },
  saveProtectedCopy: { es: 'Guardar copia protegida', en: 'Save protected copy', fr: 'Enregistrer la copie protégée', de: 'Geschützte Kopie speichern', pt: 'Guardar cópia protegida', 'pt-BR': 'Salvar cópia protegida', it: 'Salva copia protetta', tr: 'Korumalı kopyayı kaydet', 'zh-CN': '保存受保护的副本' },
  saveForSharing: { es: 'Guardar para compartir', en: 'Save for sharing', fr: 'Enregistrer pour partager', de: 'Zum Teilen speichern', pt: 'Guardar para partilhar', 'pt-BR': 'Salvar para compartilhar', it: 'Salva per condividere', tr: 'Paylaşmak için kaydet', 'zh-CN': '保存以共享' },
  downloadProtectedCopy: { es: 'Descargar copia protegida', en: 'Download protected copy', fr: 'Télécharger la copie protégée', de: 'Geschützte Kopie herunterladen', pt: 'Transferir cópia protegida', 'pt-BR': 'Baixar cópia protegida', it: 'Scarica copia protetta', tr: 'Korumalı kopyayı indir', 'zh-CN': '下载受保护的副本' },
};

export function toolkitDialogText(key: ToolkitDialogKey, language: AppLanguage): string {
  return uiText(language, COPY[key]);
}

export function toolkitDialogTranslations(): Record<ToolkitDialogKey, UiTranslations> {
  return COPY;
}
