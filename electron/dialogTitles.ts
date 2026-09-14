// Native file-dialog titles for the main process, in every interface language.
//
// The app is authored in Spanish, so a hardcoded `title:` in a native
// open/save picker call stays Spanish for readers of the other eight languages. `electron/toolkit/dialogI18n.ts` already solves this
// for the Toolkit dialogs; this catalogue is the shared home for the rest, and
// `dialogTitle(key)` reads the active UI language from Settings on every call so
// a language change takes effect without restart.
//
// Brand names (Nodus, Zotero, Nodi, GEDCOM, CSV, Deep Research, Notion,
// whisper-cli, Nodus Bookmarks) are identifiers and stay verbatim.
import type { AppLanguage } from '@shared/types';
import { uiText } from '@shared/uiLanguage';

export type DialogTitleLanguage = AppLanguage;

export type DialogTitleKey =
  // Study vault (electron/ipc/academic.ts)
  | 'selectWhisperCli'
  | 'exportStudyStyles'
  | 'importStudyStyles'
  | 'downloadMaterial'
  | 'addStudyMaterials'
  | 'addMaterialsFolder'
  | 'selectMaterialsFolder'
  | 'selectStudyMaterials'
  | 'replaceMaterialFile'
  | 'downloadAnnotatedMaterial'
  | 'addClassRecordings'
  | 'exportStudyConversation'
  | 'exportQuestionBank'
  | 'importQuestionBank'
  | 'exportStudyTest'
  | 'exportStudyCalendar'
  | 'importChapter'
  | 'exportSyncPackage'
  | 'importSyncPackage'
  | 'exportStudyDiagnostic'
  | 'exportFlashcards'
  | 'importQuestions'
  | 'importFlashcards'
  // Databases (electron/ipc/databases.ts)
  | 'exportChart'
  | 'downloadAttachment'
  | 'importCsv'
  | 'importNotionExport'
  | 'exportDatabase'
  | 'exportDeepResearchReport'
  | 'attachFiles'
  | 'chooseBulkUploadFolder'
  | 'chooseBulkUploadFiles'
  // Teaching vault (electron/ipc/teaching.ts)
  | 'downloadActa'
  | 'downloadReportCard'
  | 'chooseTaskInstructions'
  | 'downloadRubric'
  | 'addLogoToLibrary'
  | 'downloadExam'
  | 'chooseLogo'
  | 'chooseQuestionImage'
  // Primary sources (electron/ipc/primarySources.ts)
  | 'addPrimarySources'
  | 'savePreservedFileCopy'
  | 'saveResearchPackage'
  | 'validateResearchPackage'
  | 'restorePackageAsNewVault'
  // Worldbuilding (electron/ipc/worldbuilding.ts)
  | 'addImage'
  | 'chooseMapImage'
  | 'exportCharacterSheet'
  | 'addCharacterImage'
  // Genealogy archive (electron/ipc/archive.ts)
  | 'addToEvidenceArchive'
  | 'attachFilesToGenealogyEntry'
  | 'replaceAttachmentFile'
  // Records (electron/ipc/records.ts)
  | 'choosePortrait'
  | 'importGedcom'
  | 'exportGedcom'
  // Browser (electron/ipc/browser.ts)
  | 'importNodusBookmarks'
  | 'exportNodusBookmarks'
  // Platform (electron/ipc/platform.ts)
  | 'saveAudio'
  // Pages (electron/ipc/pages.ts)
  | 'chooseImage'
  | 'chooseAudio'
  | 'chooseVideo'
  | 'chooseFile'
  // Main IPC (electron/ipc.ts)
  | 'chooseBackupFolder'
  | 'importSkillPackageDirectory'
  | 'exportSkillPackageDirectory'
  | 'saveCapabilityFile'
  | 'saveRecoveryKit'
  // Exports (electron/export/*.ts)
  | 'exportNodusLibrary'
  | 'importNodusLibrary'
  | 'exportManuscript'
  | 'exportProject'
  | 'exportChapter'
  | 'exportWorldBible'
  | 'exportNotes'
  | 'exportCoverageMap'
  | 'exportStudy'
  | 'exportReport'
  | 'exportAuthorSynthesis'
  | 'downloadReports'
  // Dialog filter labels that are user-visible in the native picker
  | 'plainText'
  | 'zipArchive';

export const DIALOG_TITLE_COPY: Record<DialogTitleKey, Record<AppLanguage, string>> = {
  selectWhisperCli: { es: 'Seleccionar whisper-cli', en: 'Select whisper-cli', fr: 'Sélectionner whisper-cli', de: 'whisper-cli auswählen', pt: 'Selecionar whisper-cli', 'pt-BR': 'Selecionar whisper-cli', it: 'Seleziona whisper-cli', tr: 'whisper-cli seç', 'zh-CN': '选择 whisper-cli' },
  exportStudyStyles: { es: 'Exportar estilos de estudio', en: 'Export study styles', fr: 'Exporter les styles d’étude', de: 'Lernstile exportieren', pt: 'Exportar estilos de estudo', 'pt-BR': 'Exportar estilos de estudo', it: 'Esporta stili di studio', tr: 'Çalışma stillerini dışa aktar', 'zh-CN': '导出学习样式' },
  importStudyStyles: { es: 'Importar estilos de estudio', en: 'Import study styles', fr: 'Importer les styles d’étude', de: 'Lernstile importieren', pt: 'Importar estilos de estudo', 'pt-BR': 'Importar estilos de estudo', it: 'Importa stili di studio', tr: 'Çalışma stillerini içe aktar', 'zh-CN': '导入学习样式' },
  downloadMaterial: { es: 'Descargar material', en: 'Download material', fr: 'Télécharger le support', de: 'Material herunterladen', pt: 'Transferir material', 'pt-BR': 'Baixar material', it: 'Scarica materiale', tr: 'Materyali indir', 'zh-CN': '下载资料' },
  addStudyMaterials: { es: 'Añadir materiales de estudio', en: 'Add study materials', fr: 'Ajouter des supports d’étude', de: 'Lernmaterialien hinzufügen', pt: 'Adicionar materiais de estudo', 'pt-BR': 'Adicionar materiais de estudo', it: 'Aggiungi materiali di studio', tr: 'Çalışma materyalleri ekle', 'zh-CN': '添加学习资料' },
  addMaterialsFolder: { es: 'Añadir carpeta de materiales', en: 'Add materials folder', fr: 'Ajouter un dossier de supports', de: 'Materialordner hinzufügen', pt: 'Adicionar pasta de materiais', 'pt-BR': 'Adicionar pasta de materiais', it: 'Aggiungi cartella materiali', tr: 'Materyal klasörü ekle', 'zh-CN': '添加资料文件夹' },
  selectMaterialsFolder: { es: 'Seleccionar carpeta de materiales', en: 'Select materials folder', fr: 'Sélectionner le dossier de supports', de: 'Materialordner auswählen', pt: 'Selecionar pasta de materiais', 'pt-BR': 'Selecionar pasta de materiais', it: 'Seleziona cartella materiali', tr: 'Materyal klasörünü seç', 'zh-CN': '选择资料文件夹' },
  selectStudyMaterials: { es: 'Seleccionar materiales de estudio', en: 'Select study materials', fr: 'Sélectionner des supports d’étude', de: 'Lernmaterialien auswählen', pt: 'Selecionar materiais de estudo', 'pt-BR': 'Selecionar materiais de estudo', it: 'Seleziona materiali di studio', tr: 'Çalışma materyallerini seç', 'zh-CN': '选择学习资料' },
  replaceMaterialFile: { es: 'Sustituir fichero del material', en: 'Replace material file', fr: 'Remplacer le fichier du support', de: 'Materialdatei ersetzen', pt: 'Substituir ficheiro do material', 'pt-BR': 'Substituir arquivo do material', it: 'Sostituisci file del materiale', tr: 'Materyal dosyasını değiştir', 'zh-CN': '替换资料文件' },
  downloadAnnotatedMaterial: { es: 'Descargar material anotado', en: 'Download annotated material', fr: 'Télécharger le support annoté', de: 'Annotiertes Material herunterladen', pt: 'Transferir material anotado', 'pt-BR': 'Baixar material anotado', it: 'Scarica materiale annotato', tr: 'Açıklamalı materyali indir', 'zh-CN': '下载带批注的资料' },
  addClassRecordings: { es: 'Añadir grabaciones de clase', en: 'Add class recordings', fr: 'Ajouter des enregistrements de cours', de: 'Kursaufnahmen hinzufügen', pt: 'Adicionar gravações de aula', 'pt-BR': 'Adicionar gravações de aula', it: 'Aggiungi registrazioni delle lezioni', tr: 'Ders kayıtları ekle', 'zh-CN': '添加课堂录音' },
  exportStudyConversation: { es: 'Exportar conversación de estudio', en: 'Export study conversation', fr: 'Exporter la conversation d’étude', de: 'Lerngespräch exportieren', pt: 'Exportar conversa de estudo', 'pt-BR': 'Exportar conversa de estudo', it: 'Esporta conversazione di studio', tr: 'Çalışma sohbetini dışa aktar', 'zh-CN': '导出学习对话' },
  exportQuestionBank: { es: 'Exportar banco de preguntas', en: 'Export question bank', fr: 'Exporter la banque de questions', de: 'Fragenkatalog exportieren', pt: 'Exportar banco de perguntas', 'pt-BR': 'Exportar banco de questões', it: 'Esporta banca dati di domande', tr: 'Soru bankasını dışa aktar', 'zh-CN': '导出题库' },
  importQuestionBank: { es: 'Importar banco de preguntas', en: 'Import question bank', fr: 'Importer la banque de questions', de: 'Fragenkatalog importieren', pt: 'Importar banco de perguntas', 'pt-BR': 'Importar banco de questões', it: 'Importa banca dati di domande', tr: 'Soru bankasını içe aktar', 'zh-CN': '导入题库' },
  exportStudyTest: { es: 'Exportar test de estudio', en: 'Export study test', fr: 'Exporter le test d’étude', de: 'Lerntest exportieren', pt: 'Exportar teste de estudo', 'pt-BR': 'Exportar teste de estudo', it: 'Esporta test di studio', tr: 'Çalışma testini dışa aktar', 'zh-CN': '导出学习测试' },
  exportStudyCalendar: { es: 'Exportar calendario de estudio', en: 'Export study calendar', fr: 'Exporter le calendrier d’étude', de: 'Lernkalender exportieren', pt: 'Exportar calendário de estudo', 'pt-BR': 'Exportar calendário de estudo', it: 'Esporta calendario di studio', tr: 'Çalışma takvimini dışa aktar', 'zh-CN': '导出学习日历' },
  importChapter: { es: 'Importar capítulo', en: 'Import chapter', fr: 'Importer un chapitre', de: 'Kapitel importieren', pt: 'Importar capítulo', 'pt-BR': 'Importar capítulo', it: 'Importa capitolo', tr: 'Bölüm içe aktar', 'zh-CN': '导入章节' },
  exportSyncPackage: { es: 'Exportar paquete de sincronización', en: 'Export sync package', fr: 'Exporter le paquet de synchronisation', de: 'Synchronisierungspaket exportieren', pt: 'Exportar pacote de sincronização', 'pt-BR': 'Exportar pacote de sincronização', it: 'Esporta pacchetto di sincronizzazione', tr: 'Eşitleme paketini dışa aktar', 'zh-CN': '导出同步包' },
  importSyncPackage: { es: 'Importar paquete de sincronización', en: 'Import sync package', fr: 'Importer le paquet de synchronisation', de: 'Synchronisierungspaket importieren', pt: 'Importar pacote de sincronização', 'pt-BR': 'Importar pacote de sincronização', it: 'Importa pacchetto di sincronizzazione', tr: 'Eşitleme paketini içe aktar', 'zh-CN': '导入同步包' },
  exportStudyDiagnostic: { es: 'Exportar diagnóstico del vault de estudio', en: 'Export study vault diagnostic', fr: 'Exporter le diagnostic du coffre d’étude', de: 'Diagnose des Lernarchivs exportieren', pt: 'Exportar diagnóstico do arquivo de estudo', 'pt-BR': 'Exportar diagnóstico do vault de estudo', it: 'Esporta diagnostica del vault di studio', tr: 'Çalışma kasası tanılamasını dışa aktar', 'zh-CN': '导出学习资料库诊断信息' },
  exportFlashcards: { es: 'Exportar flashcards', en: 'Export flashcards', fr: 'Exporter les cartes mémoire', de: 'Lernkarten exportieren', pt: 'Exportar flashcards', 'pt-BR': 'Exportar flashcards', it: 'Esporta flashcard', tr: 'Bilgi kartlarını dışa aktar', 'zh-CN': '导出闪卡' },
  importQuestions: { es: 'Importar preguntas', en: 'Import questions', fr: 'Importer des questions', de: 'Fragen importieren', pt: 'Importar perguntas', 'pt-BR': 'Importar questões', it: 'Importa domande', tr: 'Soruları içe aktar', 'zh-CN': '导入题目' },
  importFlashcards: { es: 'Importar flashcards', en: 'Import flashcards', fr: 'Importer des cartes mémoire', de: 'Lernkarten importieren', pt: 'Importar flashcards', 'pt-BR': 'Importar flashcards', it: 'Importa flashcard', tr: 'Bilgi kartlarını içe aktar', 'zh-CN': '导入闪卡' },

  exportChart: { es: 'Exportar gráfico', en: 'Export chart', fr: 'Exporter le graphique', de: 'Diagramm exportieren', pt: 'Exportar gráfico', 'pt-BR': 'Exportar gráfico', it: 'Esporta grafico', tr: 'Grafiği dışa aktar', 'zh-CN': '导出图表' },
  downloadAttachment: { es: 'Descargar adjunto', en: 'Download attachment', fr: 'Télécharger la pièce jointe', de: 'Anhang herunterladen', pt: 'Transferir anexo', 'pt-BR': 'Baixar anexo', it: 'Scarica allegato', tr: 'Eki indir', 'zh-CN': '下载附件' },
  importCsv: { es: 'Importar CSV', en: 'Import CSV', fr: 'Importer un CSV', de: 'CSV importieren', pt: 'Importar CSV', 'pt-BR': 'Importar CSV', it: 'Importa CSV', tr: 'CSV içe aktar', 'zh-CN': '导入 CSV' },
  importNotionExport: { es: 'Importar exportación de Notion', en: 'Import Notion export', fr: 'Importer une exportation Notion', de: 'Notion-Export importieren', pt: 'Importar exportação do Notion', 'pt-BR': 'Importar exportação do Notion', it: 'Importa esportazione Notion', tr: 'Notion dışa aktarımını içe aktar', 'zh-CN': '导入 Notion 导出文件' },
  exportDatabase: { es: 'Exportar base de datos', en: 'Export database', fr: 'Exporter la base de données', de: 'Datenbank exportieren', pt: 'Exportar base de dados', 'pt-BR': 'Exportar banco de dados', it: 'Esporta database', tr: 'Veritabanını dışa aktar', 'zh-CN': '导出数据库' },
  exportDeepResearchReport: { es: 'Exportar informe de Deep Research', en: 'Export Deep Research report', fr: 'Exporter le rapport Deep Research', de: 'Deep-Research-Bericht exportieren', pt: 'Exportar relatório de Deep Research', 'pt-BR': 'Exportar relatório de Deep Research', it: 'Esporta report Deep Research', tr: 'Deep Research raporunu dışa aktar', 'zh-CN': '导出 Deep Research 报告' },
  attachFiles: { es: 'Adjuntar archivos', en: 'Attach files', fr: 'Joindre des fichiers', de: 'Dateien anhängen', pt: 'Anexar ficheiros', 'pt-BR': 'Anexar arquivos', it: 'Allega file', tr: 'Dosya iliştir', 'zh-CN': '附加文件' },
  chooseBulkUploadFolder: { es: 'Elegir una carpeta para subida masiva', en: 'Choose a folder for bulk upload', fr: 'Choisir un dossier pour l’import groupé', de: 'Ordner für Massenupload auswählen', pt: 'Escolher uma pasta para envio em massa', 'pt-BR': 'Escolher uma pasta para upload em massa', it: 'Scegli una cartella per il caricamento massivo', tr: 'Toplu yükleme için klasör seç', 'zh-CN': '选择批量上传文件夹' },
  chooseBulkUploadFiles: { es: 'Elegir archivos para subida masiva', en: 'Choose files for bulk upload', fr: 'Choisir des fichiers pour l’import groupé', de: 'Dateien für Massenupload auswählen', pt: 'Escolher ficheiros para envio em massa', 'pt-BR': 'Escolher arquivos para upload em massa', it: 'Scegli file per il caricamento massivo', tr: 'Toplu yükleme için dosya seç', 'zh-CN': '选择批量上传文件' },

  downloadActa: { es: 'Descargar acta', en: 'Download class record', fr: 'Télécharger le procès-verbal', de: 'Klassenprotokoll herunterladen', pt: 'Transferir ata da turma', 'pt-BR': 'Baixar ata da turma', it: 'Scarica verbale di classe', tr: 'Sınıf tutanağını indir', 'zh-CN': '下载班级记录' },
  downloadReportCard: { es: 'Descargar boletín', en: 'Download report card', fr: 'Télécharger le bulletin', de: 'Zeugnis herunterladen', pt: 'Transferir boletim', 'pt-BR': 'Baixar boletim', it: 'Scarica pagella', tr: 'Karne indir', 'zh-CN': '下载成绩单' },
  chooseTaskInstructions: { es: 'Elegir el documento con las instrucciones de la tarea', en: 'Choose the document with the task instructions', fr: 'Choisir le document avec les consignes de la tâche', de: 'Dokument mit den Aufgabenstellungen auswählen', pt: 'Escolher o documento com as instruções da tarefa', 'pt-BR': 'Escolher o documento com as instruções da tarefa', it: 'Scegli il documento con le istruzioni dell’attività', tr: 'Görev yönergelerini içeren belgeyi seç', 'zh-CN': '选择包含任务说明的文档' },
  downloadRubric: { es: 'Descargar rúbrica', en: 'Download rubric', fr: 'Télécharger la grille d’évaluation', de: 'Bewertungsraster herunterladen', pt: 'Transferir grelha de avaliação', 'pt-BR': 'Baixar rubrica', it: 'Scarica rubrica', tr: 'Değerlendirme ölçeğini indir', 'zh-CN': '下载评分量规' },
  addLogoToLibrary: { es: 'Añadir logotipo a la biblioteca', en: 'Add logo to the library', fr: 'Ajouter un logo à la bibliothèque', de: 'Logo zur Bibliothek hinzufügen', pt: 'Adicionar logótipo à biblioteca', 'pt-BR': 'Adicionar logotipo à biblioteca', it: 'Aggiungi logo alla libreria', tr: 'Logoyu kitaplığa ekle', 'zh-CN': '将徽标添加到资料库' },
  downloadExam: { es: 'Descargar examen', en: 'Download exam', fr: 'Télécharger l’examen', de: 'Prüfung herunterladen', pt: 'Transferir exame', 'pt-BR': 'Baixar exame', it: 'Scarica esame', tr: 'Sınavı indir', 'zh-CN': '下载考试' },
  chooseLogo: { es: 'Elegir logotipo', en: 'Choose logo', fr: 'Choisir un logo', de: 'Logo auswählen', pt: 'Escolher logótipo', 'pt-BR': 'Escolher logotipo', it: 'Scegli logo', tr: 'Logo seç', 'zh-CN': '选择徽标' },
  chooseQuestionImage: { es: 'Elegir imagen de la pregunta', en: 'Choose question image', fr: 'Choisir l’image de la question', de: 'Bild für die Frage auswählen', pt: 'Escolher imagem da pergunta', 'pt-BR': 'Escolher imagem da questão', it: 'Scegli immagine della domanda', tr: 'Soru görselini seç', 'zh-CN': '选择题目图片' },

  addPrimarySources: { es: 'Añadir fuentes primarias', en: 'Add primary sources', fr: 'Ajouter des sources primaires', de: 'Primärquellen hinzufügen', pt: 'Adicionar fontes primárias', 'pt-BR': 'Adicionar fontes primárias', it: 'Aggiungi fonti primarie', tr: 'Birincil kaynak ekle', 'zh-CN': '添加原始资料' },
  savePreservedFileCopy: { es: 'Guardar copia del archivo preservado', en: 'Save a copy of the preserved file', fr: 'Enregistrer une copie du fichier préservé', de: 'Kopie der erhaltenen Datei speichern', pt: 'Guardar cópia do ficheiro preservado', 'pt-BR': 'Salvar cópia do arquivo preservado', it: 'Salva copia del file conservato', tr: 'Korunan dosyanın bir kopyasını kaydet', 'zh-CN': '保存已保存文件的副本' },
  saveResearchPackage: { es: 'Guardar paquete de investigación', en: 'Save research package', fr: 'Enregistrer le paquet de recherche', de: 'Forschungspaket speichern', pt: 'Guardar pacote de investigação', 'pt-BR': 'Salvar pacote de pesquisa', it: 'Salva pacchetto di ricerca', tr: 'Araştırma paketini kaydet', 'zh-CN': '保存研究包' },
  validateResearchPackage: { es: 'Validar paquete de investigación', en: 'Validate research package', fr: 'Valider le paquet de recherche', de: 'Forschungspaket validieren', pt: 'Validar pacote de investigação', 'pt-BR': 'Validar pacote de pesquisa', it: 'Convalida pacchetto di ricerca', tr: 'Araştırma paketini doğrula', 'zh-CN': '校验研究包' },
  restorePackageAsNewVault: { es: 'Restaurar paquete como vault nuevo', en: 'Restore package as a new vault', fr: 'Restaurer le paquet comme nouveau coffre', de: 'Paket als neues Archiv wiederherstellen', pt: 'Restaurar pacote como novo arquivo', 'pt-BR': 'Restaurar pacote como novo vault', it: 'Ripristina pacchetto come nuovo vault', tr: 'Paketi yeni kasa olarak geri yükle', 'zh-CN': '将包恢复为新资料库' },

  addImage: { es: 'Añadir imagen', en: 'Add image', fr: 'Ajouter une image', de: 'Bild hinzufügen', pt: 'Adicionar imagem', 'pt-BR': 'Adicionar imagem', it: 'Aggiungi immagine', tr: 'Görsel ekle', 'zh-CN': '添加图片' },
  chooseMapImage: { es: 'Elegir la imagen del mapa', en: 'Choose the map image', fr: 'Choisir l’image de la carte', de: 'Kartenbild auswählen', pt: 'Escolher a imagem do mapa', 'pt-BR': 'Escolher a imagem do mapa', it: 'Scegli l’immagine della mappa', tr: 'Harita görselini seç', 'zh-CN': '选择地图图片' },
  exportCharacterSheet: { es: 'Exportar ficha del personaje', en: 'Export character sheet', fr: 'Exporter la fiche du personnage', de: 'Charakterbogen exportieren', pt: 'Exportar ficha do personagem', 'pt-BR': 'Exportar ficha do personagem', it: 'Esporta scheda del personaggio', tr: 'Karakter sayfasını dışa aktar', 'zh-CN': '导出角色档案' },
  addCharacterImage: { es: 'Añadir imagen del personaje', en: 'Add character image', fr: 'Ajouter une image du personnage', de: 'Charakterbild hinzufügen', pt: 'Adicionar imagem do personagem', 'pt-BR': 'Adicionar imagem do personagem', it: 'Aggiungi immagine del personaggio', tr: 'Karakter görseli ekle', 'zh-CN': '添加角色图片' },

  addToEvidenceArchive: { es: 'Añadir al archivo de evidencias', en: 'Add to the evidence archive', fr: 'Ajouter aux archives de preuves', de: 'Zum Belegarchiv hinzufügen', pt: 'Adicionar ao arquivo de evidências', 'pt-BR': 'Adicionar ao arquivo de evidências', it: 'Aggiungi all’archivio delle prove', tr: 'Kanı arşivine ekle', 'zh-CN': '添加到证据档案' },
  attachFilesToGenealogyEntry: { es: 'Adjuntar archivos a la entrada genealógica', en: 'Attach files to the genealogy entry', fr: 'Joindre des fichiers à l’entrée généalogique', de: 'Dateien an den Genealogie-Eintrag anhängen', pt: 'Anexar ficheiros à entrada genealógica', 'pt-BR': 'Anexar arquivos à entrada genealógica', it: 'Allega file alla voce genealogica', tr: 'Şecere kaydına dosya iliştir', 'zh-CN': '将文件附加到族谱条目' },
  replaceAttachmentFile: { es: 'Reemplazar el archivo adjunto', en: 'Replace the attached file', fr: 'Remplacer le fichier joint', de: 'Angehängte Datei ersetzen', pt: 'Substituir o ficheiro anexado', 'pt-BR': 'Substituir o arquivo anexado', it: 'Sostituisci il file allegato', tr: 'Ekli dosyayı değiştir', 'zh-CN': '替换附加文件' },

  choosePortrait: { es: 'Elegir retrato', en: 'Choose portrait', fr: 'Choisir un portrait', de: 'Porträt auswählen', pt: 'Escolher retrato', 'pt-BR': 'Escolher retrato', it: 'Scegli ritratto', tr: 'Portre seç', 'zh-CN': '选择肖像' },
  importGedcom: { es: 'Importar GEDCOM', en: 'Import GEDCOM', fr: 'Importer un GEDCOM', de: 'GEDCOM importieren', pt: 'Importar GEDCOM', 'pt-BR': 'Importar GEDCOM', it: 'Importa GEDCOM', tr: 'GEDCOM içe aktar', 'zh-CN': '导入 GEDCOM' },
  exportGedcom: { es: 'Exportar GEDCOM', en: 'Export GEDCOM', fr: 'Exporter un GEDCOM', de: 'GEDCOM exportieren', pt: 'Exportar GEDCOM', 'pt-BR': 'Exportar GEDCOM', it: 'Esporta GEDCOM', tr: 'GEDCOM dışa aktar', 'zh-CN': '导出 GEDCOM' },

  importNodusBookmarks: { es: 'Importar Nodus Bookmarks', en: 'Import Nodus Bookmarks', fr: 'Importer Nodus Bookmarks', de: 'Nodus Bookmarks importieren', pt: 'Importar Nodus Bookmarks', 'pt-BR': 'Importar Nodus Bookmarks', it: 'Importa Nodus Bookmarks', tr: 'Nodus Bookmarks içe aktar', 'zh-CN': '导入 Nodus 书签' },
  exportNodusBookmarks: { es: 'Exportar Nodus Bookmarks', en: 'Export Nodus Bookmarks', fr: 'Exporter Nodus Bookmarks', de: 'Nodus Bookmarks exportieren', pt: 'Exportar Nodus Bookmarks', 'pt-BR': 'Exportar Nodus Bookmarks', it: 'Esporta Nodus Bookmarks', tr: 'Nodus Bookmarks dışa aktar', 'zh-CN': '导出 Nodus 书签' },

  saveAudio: { es: 'Guardar audio', en: 'Save audio', fr: 'Enregistrer l’audio', de: 'Audio speichern', pt: 'Guardar áudio', 'pt-BR': 'Salvar áudio', it: 'Salva audio', tr: 'Sesi kaydet', 'zh-CN': '保存音频' },

  chooseImage: { es: 'Elegir imagen', en: 'Choose image', fr: 'Choisir une image', de: 'Bild auswählen', pt: 'Escolher imagem', 'pt-BR': 'Escolher imagem', it: 'Scegli immagine', tr: 'Görsel seç', 'zh-CN': '选择图片' },
  chooseAudio: { es: 'Elegir audio', en: 'Choose audio', fr: 'Choisir un fichier audio', de: 'Audio auswählen', pt: 'Escolher áudio', 'pt-BR': 'Escolher áudio', it: 'Scegli audio', tr: 'Ses seç', 'zh-CN': '选择音频' },
  chooseVideo: { es: 'Elegir vídeo', en: 'Choose video', fr: 'Choisir une vidéo', de: 'Video auswählen', pt: 'Escolher vídeo', 'pt-BR': 'Escolher vídeo', it: 'Scegli video', tr: 'Video seç', 'zh-CN': '选择视频' },
  chooseFile: { es: 'Elegir archivo', en: 'Choose file', fr: 'Choisir un fichier', de: 'Datei auswählen', pt: 'Escolher ficheiro', 'pt-BR': 'Escolher arquivo', it: 'Scegli file', tr: 'Dosya seç', 'zh-CN': '选择文件' },

  chooseBackupFolder: { es: 'Elegir carpeta para copias automáticas', en: 'Choose folder for automatic backups', fr: 'Choisir le dossier des sauvegardes automatiques', de: 'Ordner für automatische Sicherungen auswählen', pt: 'Escolher pasta para cópias automáticas', 'pt-BR': 'Escolher pasta para backups automáticos', it: 'Scegli cartella per i backup automatici', tr: 'Otomatik yedekler için klasör seç', 'zh-CN': '选择自动备份文件夹' },
  importSkillPackageDirectory: { es: 'Importar carpeta del paquete de habilidades', en: 'Import skill package directory', fr: 'Importer le dossier du paquet de compétences', de: 'Verzeichnis des Skill-Pakets importieren', pt: 'Importar pasta do pacote de competências', 'pt-BR': 'Importar pasta do pacote de habilidades', it: 'Importa cartella del pacchetto di abilità', tr: 'Yetenek paketi klasörünü içe aktar', 'zh-CN': '导入技能包文件夹' },
  exportSkillPackageDirectory: { es: 'Exportar el paquete de habilidades a una carpeta', en: 'Export skill package into a directory', fr: 'Exporter le paquet de compétences vers un dossier', de: 'Skill-Paket in ein Verzeichnis exportieren', pt: 'Exportar o pacote de competências para uma pasta', 'pt-BR': 'Exportar o pacote de habilidades para uma pasta', it: 'Esporta il pacchetto di abilità in una cartella', tr: 'Yetenek paketini bir klasöre dışa aktar', 'zh-CN': '将技能包导出到文件夹' },
  saveCapabilityFile: { es: 'Guardar archivo de capacidad', en: 'Save capability file', fr: 'Enregistrer le fichier de capacité', de: 'Fähigkeitsdatei speichern', pt: 'Guardar ficheiro de capacidade', 'pt-BR': 'Salvar arquivo de capacidade', it: 'Salva file di capacità', tr: 'Yetenek dosyasını kaydet', 'zh-CN': '保存能力文件' },
  saveRecoveryKit: { es: 'Guardar kit de recuperación', en: 'Save recovery kit', fr: 'Enregistrer le kit de récupération', de: 'Wiederherstellungskit speichern', pt: 'Guardar kit de recuperação', 'pt-BR': 'Salvar kit de recuperação', it: 'Salva kit di ripristino', tr: 'Kurtarma kitini kaydet', 'zh-CN': '保存恢复工具包' },

  exportNodusLibrary: { es: 'Exportar biblioteca Nodus', en: 'Export Nodus library', fr: 'Exporter la bibliothèque Nodus', de: 'Nodus-Bibliothek exportieren', pt: 'Exportar biblioteca Nodus', 'pt-BR': 'Exportar biblioteca Nodus', it: 'Esporta libreria Nodus', tr: 'Nodus kitaplığını dışa aktar', 'zh-CN': '导出 Nodus 文献库' },
  importNodusLibrary: { es: 'Importar biblioteca Nodus', en: 'Import Nodus library', fr: 'Importer la bibliothèque Nodus', de: 'Nodus-Bibliothek importieren', pt: 'Importar biblioteca Nodus', 'pt-BR': 'Importar biblioteca Nodus', it: 'Importa libreria Nodus', tr: 'Nodus kitaplığını içe aktar', 'zh-CN': '导入 Nodus 文献库' },
  exportManuscript: { es: 'Exportar el manuscrito', en: 'Export the manuscript', fr: 'Exporter le manuscrit', de: 'Manuskript exportieren', pt: 'Exportar o manuscrito', 'pt-BR': 'Exportar o manuscrito', it: 'Esporta il manoscritto', tr: 'El yazmasını dışa aktar', 'zh-CN': '导出书稿' },
  exportProject: { es: 'Exportar proyecto', en: 'Export project', fr: 'Exporter le projet', de: 'Projekt exportieren', pt: 'Exportar projeto', 'pt-BR': 'Exportar projeto', it: 'Esporta progetto', tr: 'Projeyi dışa aktar', 'zh-CN': '导出项目' },
  exportChapter: { es: 'Exportar capítulo', en: 'Export chapter', fr: 'Exporter le chapitre', de: 'Kapitel exportieren', pt: 'Exportar capítulo', 'pt-BR': 'Exportar capítulo', it: 'Esporta capitolo', tr: 'Bölümü dışa aktar', 'zh-CN': '导出章节' },
  exportWorldBible: { es: 'Exportar la biblia del mundo', en: 'Export the world bible', fr: 'Exporter la bible du monde', de: 'Weltbibel exportieren', pt: 'Exportar a bíblia do mundo', 'pt-BR': 'Exportar a bíblia do mundo', it: 'Esporta la bibbia del mondo', tr: 'Dünya kitabını dışa aktar', 'zh-CN': '导出世界设定集' },
  exportNotes: { es: 'Exportar notas', en: 'Export notes', fr: 'Exporter les notes', de: 'Notizen exportieren', pt: 'Exportar notas', 'pt-BR': 'Exportar notas', it: 'Esporta note', tr: 'Notları dışa aktar', 'zh-CN': '导出笔记' },
  exportCoverageMap: { es: 'Exportar mapa de cobertura', en: 'Export coverage map', fr: 'Exporter la carte de couverture', de: 'Abdeckungskarte exportieren', pt: 'Exportar mapa de cobertura', 'pt-BR': 'Exportar mapa de cobertura', it: 'Esporta mappa di copertura', tr: 'Kapsam haritasını dışa aktar', 'zh-CN': '导出覆盖图' },
  exportStudy: { es: 'Exportar estudio', en: 'Export study', fr: 'Exporter l’étude', de: 'Studie exportieren', pt: 'Exportar estudo', 'pt-BR': 'Exportar estudo', it: 'Esporta studio', tr: 'Çalışmayı dışa aktar', 'zh-CN': '导出学习库' },
  exportReport: { es: 'Exportar informe', en: 'Export report', fr: 'Exporter le rapport', de: 'Bericht exportieren', pt: 'Exportar relatório', 'pt-BR': 'Exportar relatório', it: 'Esporta report', tr: 'Raporu dışa aktar', 'zh-CN': '导出报告' },
  exportAuthorSynthesis: { es: 'Exportar síntesis de autores', en: 'Export author synthesis', fr: 'Exporter la synthèse des auteurs', de: 'Autorensynthese exportieren', pt: 'Exportar síntese de autores', 'pt-BR': 'Exportar síntese de autores', it: 'Esporta sintesi degli autori', tr: 'Yazar sentezini dışa aktar', 'zh-CN': '导出作者综述' },
  downloadReports: { es: 'Descargar informes', en: 'Download reports', fr: 'Télécharger les rapports', de: 'Berichte herunterladen', pt: 'Transferir relatórios', 'pt-BR': 'Baixar relatórios', it: 'Scarica report', tr: 'Raporları indir', 'zh-CN': '下载报告' },

  plainText: { es: 'Texto plano', en: 'Plain text', fr: 'Texte brut', de: 'Nur Text', pt: 'Texto simples', 'pt-BR': 'Texto simples', it: 'Testo semplice', tr: 'Düz metin', 'zh-CN': '纯文本' },
  zipArchive: { es: 'Archivo ZIP', en: 'ZIP archive', fr: 'Archive ZIP', de: 'ZIP-Archiv', pt: 'Ficheiro ZIP', 'pt-BR': 'Arquivo ZIP', it: 'Archivio ZIP', tr: 'ZIP arşivi', 'zh-CN': 'ZIP 压缩包' },
};

/**
 * Resolve a native dialog title in the given interface language.
 *
 * The language is passed in rather than read from Settings here, mirroring
 * `toolkitDialogText`: this module stays free of the database chain, so tests that
 * bundle a single ipc module can load it without the whole Electron surface. The
 * catalogue is total over `AppLanguage`, so the `es` tail is only a belt-and-braces
 * fallback.
 */
export function dialogTitle(key: DialogTitleKey, language: AppLanguage): string {
  return uiText(language, DIALOG_TITLE_COPY[key]) || DIALOG_TITLE_COPY[key].es;
}
