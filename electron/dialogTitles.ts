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
  | 'downloadAttendance'
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
  selectWhisperCli: { es: 'Seleccionar whisper-cli', en: 'Select whisper-cli', fr: 'Sélectionner whisper-cli', de: 'whisper-cli auswählen', pt: 'Selecionar whisper-cli', 'pt-BR': 'Selecionar whisper-cli', it: 'Seleziona whisper-cli', tr: 'whisper-cli seç', 'zh-CN': '选择 whisper-cli' ,
  'zh-TW': '選擇 whisper-cli',
  ko: "속삭임-cli 선택",
  ja: "ウィスパークリを選択します", },
  exportStudyStyles: { es: 'Exportar estilos de estudio', en: 'Export study styles', fr: 'Exporter les styles d’étude', de: 'Lernstile exportieren', pt: 'Exportar estilos de estudo', 'pt-BR': 'Exportar estilos de estudo', it: 'Esporta stili di studio', tr: 'Çalışma stillerini dışa aktar', 'zh-CN': '导出学习样式' ,
  'zh-TW': '匯出學習樣式',
  ko: "학습 스타일 내보내기",
  ja: "学習スタイルをエクスポートする", },
  importStudyStyles: { es: 'Importar estilos de estudio', en: 'Import study styles', fr: 'Importer les styles d’étude', de: 'Lernstile importieren', pt: 'Importar estilos de estudo', 'pt-BR': 'Importar estilos de estudo', it: 'Importa stili di studio', tr: 'Çalışma stillerini içe aktar', 'zh-CN': '导入学习样式' ,
  'zh-TW': '匯入學習樣式',
  ko: "학습 스타일 가져오기",
  ja: "学習スタイルをインポートする", },
  downloadMaterial: { es: 'Descargar material', en: 'Download material', fr: 'Télécharger le support', de: 'Material herunterladen', pt: 'Transferir material', 'pt-BR': 'Baixar material', it: 'Scarica materiale', tr: 'Materyali indir', 'zh-CN': '下载资料' ,
  'zh-TW': '下載資料',
  ko: "자료 다운로드",
  ja: "資料をダウンロードする", },
  addStudyMaterials: { es: 'Añadir materiales de estudio', en: 'Add study materials', fr: 'Ajouter des supports d’étude', de: 'Lernmaterialien hinzufügen', pt: 'Adicionar materiais de estudo', 'pt-BR': 'Adicionar materiais de estudo', it: 'Aggiungi materiali di studio', tr: 'Çalışma materyalleri ekle', 'zh-CN': '添加学习资料' ,
  'zh-TW': '新增學習資料',
  ko: "학습 자료 추가",
  ja: "学習教材を追加する", },
  addMaterialsFolder: { es: 'Añadir carpeta de materiales', en: 'Add materials folder', fr: 'Ajouter un dossier de supports', de: 'Materialordner hinzufügen', pt: 'Adicionar pasta de materiais', 'pt-BR': 'Adicionar pasta de materiais', it: 'Aggiungi cartella materiali', tr: 'Materyal klasörü ekle', 'zh-CN': '添加资料文件夹' ,
  'zh-TW': '新增資料資料夾',
  ko: "재료 폴더 추가",
  ja: "素材フォルダを追加", },
  selectMaterialsFolder: { es: 'Seleccionar carpeta de materiales', en: 'Select materials folder', fr: 'Sélectionner le dossier de supports', de: 'Materialordner auswählen', pt: 'Selecionar pasta de materiais', 'pt-BR': 'Selecionar pasta de materiais', it: 'Seleziona cartella materiali', tr: 'Materyal klasörünü seç', 'zh-CN': '选择资料文件夹' ,
  'zh-TW': '選擇資料資料夾',
  ko: "재료 폴더 선택",
  ja: "素材フォルダを選択", },
  selectStudyMaterials: { es: 'Seleccionar materiales de estudio', en: 'Select study materials', fr: 'Sélectionner des supports d’étude', de: 'Lernmaterialien auswählen', pt: 'Selecionar materiais de estudo', 'pt-BR': 'Selecionar materiais de estudo', it: 'Seleziona materiali di studio', tr: 'Çalışma materyallerini seç', 'zh-CN': '选择学习资料' ,
  'zh-TW': '選擇學習資料',
  ko: "학습자료 선택",
  ja: "教材を選ぶ", },
  replaceMaterialFile: { es: 'Sustituir fichero del material', en: 'Replace material file', fr: 'Remplacer le fichier du support', de: 'Materialdatei ersetzen', pt: 'Substituir ficheiro do material', 'pt-BR': 'Substituir arquivo do material', it: 'Sostituisci file del materiale', tr: 'Materyal dosyasını değiştir', 'zh-CN': '替换资料文件' ,
  'zh-TW': '替換資料檔案',
  ko: "재료 파일 교체",
  ja: "素材ファイルを差し替える", },
  downloadAnnotatedMaterial: { es: 'Descargar material anotado', en: 'Download annotated material', fr: 'Télécharger le support annoté', de: 'Annotiertes Material herunterladen', pt: 'Transferir material anotado', 'pt-BR': 'Baixar material anotado', it: 'Scarica materiale annotato', tr: 'Açıklamalı materyali indir', 'zh-CN': '下载带批注的资料' ,
  'zh-TW': '下載帶批註的資料',
  ko: "주석이 달린 자료 다운로드",
  ja: "注釈付き資料をダウンロードする", },
  addClassRecordings: { es: 'Añadir grabaciones de clase', en: 'Add class recordings', fr: 'Ajouter des enregistrements de cours', de: 'Kursaufnahmen hinzufügen', pt: 'Adicionar gravações de aula', 'pt-BR': 'Adicionar gravações de aula', it: 'Aggiungi registrazioni delle lezioni', tr: 'Ders kayıtları ekle', 'zh-CN': '添加课堂录音' ,
  'zh-TW': '新增課堂錄音',
  ko: "수업 녹음 추가",
  ja: "授業の録画を追加する", },
  exportStudyConversation: { es: 'Exportar conversación de estudio', en: 'Export study conversation', fr: 'Exporter la conversation d’étude', de: 'Lerngespräch exportieren', pt: 'Exportar conversa de estudo', 'pt-BR': 'Exportar conversa de estudo', it: 'Esporta conversazione di studio', tr: 'Çalışma sohbetini dışa aktar', 'zh-CN': '导出学习对话' ,
  'zh-TW': '匯出學習對話',
  ko: "연구 대화 내보내기",
  ja: "学習会話をエクスポートする", },
  exportQuestionBank: { es: 'Exportar banco de preguntas', en: 'Export question bank', fr: 'Exporter la banque de questions', de: 'Fragenkatalog exportieren', pt: 'Exportar banco de perguntas', 'pt-BR': 'Exportar banco de questões', it: 'Esporta banca dati di domande', tr: 'Soru bankasını dışa aktar', 'zh-CN': '导出题库' ,
  'zh-TW': '匯出題庫',
  ko: "문제은행 내보내기",
  ja: "質問バンクをエクスポートする", },
  importQuestionBank: { es: 'Importar banco de preguntas', en: 'Import question bank', fr: 'Importer la banque de questions', de: 'Fragenkatalog importieren', pt: 'Importar banco de perguntas', 'pt-BR': 'Importar banco de questões', it: 'Importa banca dati di domande', tr: 'Soru bankasını içe aktar', 'zh-CN': '导入题库' ,
  'zh-TW': '匯入題庫',
  ko: "문제은행 가져오기",
  ja: "質問バンクをインポートする", },
  exportStudyTest: { es: 'Exportar test de estudio', en: 'Export study test', fr: 'Exporter le test d’étude', de: 'Lerntest exportieren', pt: 'Exportar teste de estudo', 'pt-BR': 'Exportar teste de estudo', it: 'Esporta test di studio', tr: 'Çalışma testini dışa aktar', 'zh-CN': '导出学习测试' ,
  'zh-TW': '匯出學習測試',
  ko: "수출 연구 시험",
  ja: "学習テストのエクスポート", },
  exportStudyCalendar: { es: 'Exportar calendario de estudio', en: 'Export study calendar', fr: 'Exporter le calendrier d’étude', de: 'Lernkalender exportieren', pt: 'Exportar calendário de estudo', 'pt-BR': 'Exportar calendário de estudo', it: 'Esporta calendario di studio', tr: 'Çalışma takvimini dışa aktar', 'zh-CN': '导出学习日历' ,
  'zh-TW': '匯出學習日曆',
  ko: "학습 캘린더 내보내기",
  ja: "学習カレンダーをエクスポートする", },
  importChapter: { es: 'Importar capítulo', en: 'Import chapter', fr: 'Importer un chapitre', de: 'Kapitel importieren', pt: 'Importar capítulo', 'pt-BR': 'Importar capítulo', it: 'Importa capitolo', tr: 'Bölüm içe aktar', 'zh-CN': '导入章节' ,
  'zh-TW': '匯入章節',
  ko: "가져오기 장",
  ja: "インポートの章", },
  exportSyncPackage: { es: 'Exportar paquete de sincronización', en: 'Export sync package', fr: 'Exporter le paquet de synchronisation', de: 'Synchronisierungspaket exportieren', pt: 'Exportar pacote de sincronização', 'pt-BR': 'Exportar pacote de sincronização', it: 'Esporta pacchetto di sincronizzazione', tr: 'Eşitleme paketini dışa aktar', 'zh-CN': '导出同步包' ,
  'zh-TW': '匯出同步包',
  ko: "동기화 패키지 내보내기",
  ja: "同期パッケージをエクスポートする", },
  importSyncPackage: { es: 'Importar paquete de sincronización', en: 'Import sync package', fr: 'Importer le paquet de synchronisation', de: 'Synchronisierungspaket importieren', pt: 'Importar pacote de sincronização', 'pt-BR': 'Importar pacote de sincronização', it: 'Importa pacchetto di sincronizzazione', tr: 'Eşitleme paketini içe aktar', 'zh-CN': '导入同步包' ,
  'zh-TW': '匯入同步包',
  ko: "동기화 패키지 가져오기",
  ja: "同期パッケージをインポートする", },
  exportStudyDiagnostic: { es: 'Exportar diagnóstico del vault de estudio', en: 'Export study vault diagnostic', fr: 'Exporter le diagnostic du coffre d’étude', de: 'Diagnose des Lernarchivs exportieren', pt: 'Exportar diagnóstico do arquivo de estudo', 'pt-BR': 'Exportar diagnóstico do vault de estudo', it: 'Esporta diagnostica del vault di studio', tr: 'Çalışma kasası tanılamasını dışa aktar', 'zh-CN': '导出学习资料库诊断信息' ,
  'zh-TW': '匯出學習資料庫診斷資訊',
  ko: "연구 저장소 진단 내보내기",
  ja: "Study Vault 診断をエクスポートする", },
  exportFlashcards: { es: 'Exportar flashcards', en: 'Export flashcards', fr: 'Exporter les cartes mémoire', de: 'Lernkarten exportieren', pt: 'Exportar flashcards', 'pt-BR': 'Exportar flashcards', it: 'Esporta flashcard', tr: 'Bilgi kartlarını dışa aktar', 'zh-CN': '导出闪卡' ,
  'zh-TW': '匯出閃卡',
  ko: "플래시카드 내보내기",
  ja: "フラッシュカードをエクスポートする", },
  importQuestions: { es: 'Importar preguntas', en: 'Import questions', fr: 'Importer des questions', de: 'Fragen importieren', pt: 'Importar perguntas', 'pt-BR': 'Importar questões', it: 'Importa domande', tr: 'Soruları içe aktar', 'zh-CN': '导入题目' ,
  'zh-TW': '匯入題目',
  ko: "질문 가져오기",
  ja: "質問をインポートする", },
  importFlashcards: { es: 'Importar flashcards', en: 'Import flashcards', fr: 'Importer des cartes mémoire', de: 'Lernkarten importieren', pt: 'Importar flashcards', 'pt-BR': 'Importar flashcards', it: 'Importa flashcard', tr: 'Bilgi kartlarını içe aktar', 'zh-CN': '导入闪卡' ,
  'zh-TW': '匯入閃卡',
  ko: "플래시카드 가져오기",
  ja: "フラッシュカードをインポートする", },

  exportChart: { es: 'Exportar gráfico', en: 'Export chart', fr: 'Exporter le graphique', de: 'Diagramm exportieren', pt: 'Exportar gráfico', 'pt-BR': 'Exportar gráfico', it: 'Esporta grafico', tr: 'Grafiği dışa aktar', 'zh-CN': '导出图表' ,
  'zh-TW': '匯出圖表',
  ko: "차트 내보내기",
  ja: "チャートのエクスポート", },
  downloadAttachment: { es: 'Descargar adjunto', en: 'Download attachment', fr: 'Télécharger la pièce jointe', de: 'Anhang herunterladen', pt: 'Transferir anexo', 'pt-BR': 'Baixar anexo', it: 'Scarica allegato', tr: 'Eki indir', 'zh-CN': '下载附件' ,
  'zh-TW': '下載附件',
  ko: "첨부파일 다운로드",
  ja: "添付ファイルをダウンロードする", },
  importCsv: { es: 'Importar CSV', en: 'Import CSV', fr: 'Importer un CSV', de: 'CSV importieren', pt: 'Importar CSV', 'pt-BR': 'Importar CSV', it: 'Importa CSV', tr: 'CSV içe aktar', 'zh-CN': '导入 CSV' ,
  'zh-TW': '匯入 CSV',
  ko: "CSV 가져오기",
  ja: "CSVのインポート", },
  importNotionExport: { es: 'Importar exportación de Notion', en: 'Import Notion export', fr: 'Importer une exportation Notion', de: 'Notion-Export importieren', pt: 'Importar exportação do Notion', 'pt-BR': 'Importar exportação do Notion', it: 'Importa esportazione Notion', tr: 'Notion dışa aktarımını içe aktar', 'zh-CN': '导入 Notion 导出文件' ,
  'zh-TW': '匯入 Notion 匯出檔案',
  ko: "Notion 내보내기 가져오기",
  ja: "インポート Notion エクスポート", },
  exportDatabase: { es: 'Exportar base de datos', en: 'Export database', fr: 'Exporter la base de données', de: 'Datenbank exportieren', pt: 'Exportar base de dados', 'pt-BR': 'Exportar banco de dados', it: 'Esporta database', tr: 'Veritabanını dışa aktar', 'zh-CN': '导出数据库' ,
  'zh-TW': '匯出資料庫',
  ko: "데이터베이스 내보내기",
  ja: "データベースのエクスポート", },
  exportDeepResearchReport: { es: 'Exportar informe de Deep Research', en: 'Export Deep Research report', fr: 'Exporter le rapport Deep Research', de: 'Deep-Research-Bericht exportieren', pt: 'Exportar relatório de Deep Research', 'pt-BR': 'Exportar relatório de Deep Research', it: 'Esporta report Deep Research', tr: 'Deep Research raporunu dışa aktar', 'zh-CN': '导出 Deep Research 报告' ,
  'zh-TW': '匯出 Deep Research 報告',
  ko: "Deep Research 보고서 내보내기",
  ja: "Deep Researchレポートのエクスポート", },
  attachFiles: { es: 'Adjuntar archivos', en: 'Attach files', fr: 'Joindre des fichiers', de: 'Dateien anhängen', pt: 'Anexar ficheiros', 'pt-BR': 'Anexar arquivos', it: 'Allega file', tr: 'Dosya iliştir', 'zh-CN': '附加文件' ,
  'zh-TW': '附加檔案',
  ko: "파일 첨부",
  ja: "ファイルを添付する", },
  chooseBulkUploadFolder: { es: 'Elegir una carpeta para subida masiva', en: 'Choose a folder for bulk upload', fr: 'Choisir un dossier pour l’import groupé', de: 'Ordner für Massenupload auswählen', pt: 'Escolher uma pasta para envio em massa', 'pt-BR': 'Escolher uma pasta para upload em massa', it: 'Scegli una cartella per il caricamento massivo', tr: 'Toplu yükleme için klasör seç', 'zh-CN': '选择批量上传文件夹' ,
  'zh-TW': '選擇批次上傳資料夾',
  ko: "일괄 업로드할 폴더 선택",
  ja: "一括アップロードするフォルダーを選択してください", },
  chooseBulkUploadFiles: { es: 'Elegir archivos para subida masiva', en: 'Choose files for bulk upload', fr: 'Choisir des fichiers pour l’import groupé', de: 'Dateien für Massenupload auswählen', pt: 'Escolher ficheiros para envio em massa', 'pt-BR': 'Escolher arquivos para upload em massa', it: 'Scegli file per il caricamento massivo', tr: 'Toplu yükleme için dosya seç', 'zh-CN': '选择批量上传文件' ,
  'zh-TW': '選擇批次上傳檔案',
  ko: "일괄 업로드할 파일 선택",
  ja: "一括アップロードするファイルを選択してください", },

  downloadActa: { es: 'Descargar acta', en: 'Download class record', fr: 'Télécharger le procès-verbal', de: 'Klassenprotokoll herunterladen', pt: 'Transferir ata da turma', 'pt-BR': 'Baixar ata da turma', it: 'Scarica verbale di classe', tr: 'Sınıf tutanağını indir', 'zh-CN': '下载班级记录' ,
  'zh-TW': '下載班級記錄',
  ko: "수업 기록 다운로드",
  ja: "授業記録をダウンロードする", },
  downloadAttendance: { es: 'Descargar asistencia', en: 'Download attendance', fr: 'Télécharger les présences', de: 'Anwesenheit herunterladen', pt: 'Transferir assiduidade', 'pt-BR': 'Baixar frequência', it: 'Scarica presenze', tr: 'Devam durumunu indir', 'zh-CN': '下载考勤记录',
  'zh-TW': '下載出缺席紀錄',
  ko: "출결 기록 다운로드",
  ja: "出欠記録をダウンロード", },
  downloadReportCard: { es: 'Descargar boletín', en: 'Download report card', fr: 'Télécharger le bulletin', de: 'Zeugnis herunterladen', pt: 'Transferir boletim', 'pt-BR': 'Baixar boletim', it: 'Scarica pagella', tr: 'Karne indir', 'zh-CN': '下载成绩单' ,
  'zh-TW': '下載成績單',
  ko: "성적표 다운로드",
  ja: "レポートカードをダウンロードする", },
  chooseTaskInstructions: { es: 'Elegir el documento con las instrucciones de la tarea', en: 'Choose the document with the task instructions', fr: 'Choisir le document avec les consignes de la tâche', de: 'Dokument mit den Aufgabenstellungen auswählen', pt: 'Escolher o documento com as instruções da tarefa', 'pt-BR': 'Escolher o documento com as instruções da tarefa', it: 'Scegli il documento con le istruzioni dell’attività', tr: 'Görev yönergelerini içeren belgeyi seç', 'zh-CN': '选择包含任务说明的文档' ,
  'zh-TW': '選擇包含任務說明的文件',
  ko: "작업 지침이 포함된 문서를 선택하세요.",
  ja: "タスクの指示が記載されたドキュメントを選択してください", },
  downloadRubric: { es: 'Descargar rúbrica', en: 'Download rubric', fr: 'Télécharger la grille d’évaluation', de: 'Bewertungsraster herunterladen', pt: 'Transferir grelha de avaliação', 'pt-BR': 'Baixar rubrica', it: 'Scarica rubrica', tr: 'Değerlendirme ölçeğini indir', 'zh-CN': '下载评分量规' ,
  'zh-TW': '下載評分量規',
  ko: "기준표 다운로드",
  ja: "ルーブリックをダウンロード", },
  addLogoToLibrary: { es: 'Añadir logotipo a la biblioteca', en: 'Add logo to the library', fr: 'Ajouter un logo à la bibliothèque', de: 'Logo zur Bibliothek hinzufügen', pt: 'Adicionar logótipo à biblioteca', 'pt-BR': 'Adicionar logotipo à biblioteca', it: 'Aggiungi logo alla libreria', tr: 'Logoyu kitaplığa ekle', 'zh-CN': '将徽标添加到资料库' ,
  'zh-TW': '將徽標新增到資料庫',
  ko: "라이브러리에 로고 추가",
  ja: "ロゴをライブラリに追加する", },
  downloadExam: { es: 'Descargar examen', en: 'Download exam', fr: 'Télécharger l’examen', de: 'Prüfung herunterladen', pt: 'Transferir exame', 'pt-BR': 'Baixar exame', it: 'Scarica esame', tr: 'Sınavı indir', 'zh-CN': '下载考试' ,
  'zh-TW': '下載考試',
  ko: "시험 다운로드",
  ja: "試験をダウンロードする", },
  chooseLogo: { es: 'Elegir logotipo', en: 'Choose logo', fr: 'Choisir un logo', de: 'Logo auswählen', pt: 'Escolher logótipo', 'pt-BR': 'Escolher logotipo', it: 'Scegli logo', tr: 'Logo seç', 'zh-CN': '选择徽标' ,
  'zh-TW': '選擇徽標',
  ko: "로고 선택",
  ja: "ロゴを選択してください", },
  chooseQuestionImage: { es: 'Elegir imagen de la pregunta', en: 'Choose question image', fr: 'Choisir l’image de la question', de: 'Bild für die Frage auswählen', pt: 'Escolher imagem da pergunta', 'pt-BR': 'Escolher imagem da questão', it: 'Scegli immagine della domanda', tr: 'Soru görselini seç', 'zh-CN': '选择题目图片' ,
  'zh-TW': '選擇題目圖片',
  ko: "질문 이미지 선택",
  ja: "質問画像を選択してください", },

  addPrimarySources: { es: 'Añadir fuentes primarias', en: 'Add primary sources', fr: 'Ajouter des sources primaires', de: 'Primärquellen hinzufügen', pt: 'Adicionar fontes primárias', 'pt-BR': 'Adicionar fontes primárias', it: 'Aggiungi fonti primarie', tr: 'Birincil kaynak ekle', 'zh-CN': '添加原始资料' ,
  'zh-TW': '新增原始資料',
  ko: "기본 소스 추가",
  ja: "一次ソースを追加する", },
  savePreservedFileCopy: { es: 'Guardar copia del archivo preservado', en: 'Save a copy of the preserved file', fr: 'Enregistrer une copie du fichier préservé', de: 'Kopie der erhaltenen Datei speichern', pt: 'Guardar cópia do ficheiro preservado', 'pt-BR': 'Salvar cópia do arquivo preservado', it: 'Salva copia del file conservato', tr: 'Korunan dosyanın bir kopyasını kaydet', 'zh-CN': '保存已保存文件的副本' ,
  'zh-TW': '儲存已儲存檔案的副本',
  ko: "보존된 파일의 복사본을 저장하세요.",
  ja: "保存されたファイルのコピーを保存します", },
  saveResearchPackage: { es: 'Guardar paquete de investigación', en: 'Save research package', fr: 'Enregistrer le paquet de recherche', de: 'Forschungspaket speichern', pt: 'Guardar pacote de investigação', 'pt-BR': 'Salvar pacote de pesquisa', it: 'Salva pacchetto di ricerca', tr: 'Araştırma paketini kaydet', 'zh-CN': '保存研究包' ,
  'zh-TW': '儲存研究包',
  ko: "연구 패키지 저장",
  ja: "研究パッケージを保存する", },
  validateResearchPackage: { es: 'Validar paquete de investigación', en: 'Validate research package', fr: 'Valider le paquet de recherche', de: 'Forschungspaket validieren', pt: 'Validar pacote de investigação', 'pt-BR': 'Validar pacote de pesquisa', it: 'Convalida pacchetto di ricerca', tr: 'Araştırma paketini doğrula', 'zh-CN': '校验研究包' ,
  'zh-TW': '校驗研究包',
  ko: "연구 패키지 검증",
  ja: "研究パッケージを検証する", },
  restorePackageAsNewVault: { es: 'Restaurar paquete como vault nuevo', en: 'Restore package as a new vault', fr: 'Restaurer le paquet comme nouveau coffre', de: 'Paket als neues Archiv wiederherstellen', pt: 'Restaurar pacote como novo arquivo', 'pt-BR': 'Restaurar pacote como novo vault', it: 'Ripristina pacchetto come nuovo vault', tr: 'Paketi yeni kasa olarak geri yükle', 'zh-CN': '将包恢复为新资料库' ,
  'zh-TW': '將包恢復為新資料庫',
  ko: "패키지를 새 자격 증명 모음으로 복원",
  ja: "パッケージを新しいボールトとして復元する", },

  addImage: { es: 'Añadir imagen', en: 'Add image', fr: 'Ajouter une image', de: 'Bild hinzufügen', pt: 'Adicionar imagem', 'pt-BR': 'Adicionar imagem', it: 'Aggiungi immagine', tr: 'Görsel ekle', 'zh-CN': '添加图片' ,
  'zh-TW': '新增圖片',
  ko: "이미지 추가",
  ja: "画像を追加", },
  chooseMapImage: { es: 'Elegir la imagen del mapa', en: 'Choose the map image', fr: 'Choisir l’image de la carte', de: 'Kartenbild auswählen', pt: 'Escolher a imagem do mapa', 'pt-BR': 'Escolher a imagem do mapa', it: 'Scegli l’immagine della mappa', tr: 'Harita görselini seç', 'zh-CN': '选择地图图片' ,
  'zh-TW': '選擇地圖圖片',
  ko: "지도 이미지를 선택하세요",
  ja: "地図画像を選択してください", },
  exportCharacterSheet: { es: 'Exportar ficha del personaje', en: 'Export character sheet', fr: 'Exporter la fiche du personnage', de: 'Charakterbogen exportieren', pt: 'Exportar ficha do personagem', 'pt-BR': 'Exportar ficha do personagem', it: 'Esporta scheda del personaggio', tr: 'Karakter sayfasını dışa aktar', 'zh-CN': '导出角色档案' ,
  'zh-TW': '匯出角色檔案',
  ko: "캐릭터 시트 내보내기",
  ja: "キャラクターシートのエクスポート", },
  addCharacterImage: { es: 'Añadir imagen del personaje', en: 'Add character image', fr: 'Ajouter une image du personnage', de: 'Charakterbild hinzufügen', pt: 'Adicionar imagem do personagem', 'pt-BR': 'Adicionar imagem do personagem', it: 'Aggiungi immagine del personaggio', tr: 'Karakter görseli ekle', 'zh-CN': '添加角色图片' ,
  'zh-TW': '新增角色圖片',
  ko: "캐릭터 이미지 추가",
  ja: "キャラクター画像を追加", },

  addToEvidenceArchive: { es: 'Añadir al archivo de evidencias', en: 'Add to the evidence archive', fr: 'Ajouter aux archives de preuves', de: 'Zum Belegarchiv hinzufügen', pt: 'Adicionar ao arquivo de evidências', 'pt-BR': 'Adicionar ao arquivo de evidências', it: 'Aggiungi all’archivio delle prove', tr: 'Kanı arşivine ekle', 'zh-CN': '添加到证据档案' ,
  'zh-TW': '新增到證據檔案',
  ko: "증거 보관소에 추가",
  ja: "証拠アーカイブに追加する", },
  attachFilesToGenealogyEntry: { es: 'Adjuntar archivos a la entrada genealógica', en: 'Attach files to the genealogy entry', fr: 'Joindre des fichiers à l’entrée généalogique', de: 'Dateien an den Genealogie-Eintrag anhängen', pt: 'Anexar ficheiros à entrada genealógica', 'pt-BR': 'Anexar arquivos à entrada genealógica', it: 'Allega file alla voce genealogica', tr: 'Şecere kaydına dosya iliştir', 'zh-CN': '将文件附加到族谱条目' ,
  'zh-TW': '將檔案附加到族譜條目',
  ko: "계보 항목에 파일 첨부",
  ja: "系図エントリにファイルを添付する", },
  replaceAttachmentFile: { es: 'Reemplazar el archivo adjunto', en: 'Replace the attached file', fr: 'Remplacer le fichier joint', de: 'Angehängte Datei ersetzen', pt: 'Substituir o ficheiro anexado', 'pt-BR': 'Substituir o arquivo anexado', it: 'Sostituisci il file allegato', tr: 'Ekli dosyayı değiştir', 'zh-CN': '替换附加文件' ,
  'zh-TW': '替換附加檔案',
  ko: "첨부파일을 교체하세요",
  ja: "添付ファイルを差し替える", },

  choosePortrait: { es: 'Elegir retrato', en: 'Choose portrait', fr: 'Choisir un portrait', de: 'Porträt auswählen', pt: 'Escolher retrato', 'pt-BR': 'Escolher retrato', it: 'Scegli ritratto', tr: 'Portre seç', 'zh-CN': '选择肖像' ,
  'zh-TW': '選擇肖像',
  ko: "초상화 선택",
  ja: "ポートレートを選択してください", },
  importGedcom: { es: 'Importar GEDCOM', en: 'Import GEDCOM', fr: 'Importer un GEDCOM', de: 'GEDCOM importieren', pt: 'Importar GEDCOM', 'pt-BR': 'Importar GEDCOM', it: 'Importa GEDCOM', tr: 'GEDCOM içe aktar', 'zh-CN': '导入 GEDCOM' ,
  'zh-TW': '匯入 GEDCOM',
  ko: "GEDCOM 가져오기",
  ja: "GEDCOM のインポート", },
  exportGedcom: { es: 'Exportar GEDCOM', en: 'Export GEDCOM', fr: 'Exporter un GEDCOM', de: 'GEDCOM exportieren', pt: 'Exportar GEDCOM', 'pt-BR': 'Exportar GEDCOM', it: 'Esporta GEDCOM', tr: 'GEDCOM dışa aktar', 'zh-CN': '导出 GEDCOM' ,
  'zh-TW': '匯出 GEDCOM',
  ko: "GEDCOM 내보내기",
  ja: "GEDCOM のエクスポート", },

  importNodusBookmarks: { es: 'Importar Nodus Bookmarks', en: 'Import Nodus Bookmarks', fr: 'Importer Nodus Bookmarks', de: 'Nodus Bookmarks importieren', pt: 'Importar Nodus Bookmarks', 'pt-BR': 'Importar Nodus Bookmarks', it: 'Importa Nodus Bookmarks', tr: 'Nodus Bookmarks içe aktar', 'zh-CN': '导入 Nodus 书签' ,
  'zh-TW': '匯入 Nodus 書籤',
  ko: "Nodus 북마크 가져오기",
  ja: "Nodus ブックマークのインポート", },
  exportNodusBookmarks: { es: 'Exportar Nodus Bookmarks', en: 'Export Nodus Bookmarks', fr: 'Exporter Nodus Bookmarks', de: 'Nodus Bookmarks exportieren', pt: 'Exportar Nodus Bookmarks', 'pt-BR': 'Exportar Nodus Bookmarks', it: 'Esporta Nodus Bookmarks', tr: 'Nodus Bookmarks dışa aktar', 'zh-CN': '导出 Nodus 书签' ,
  'zh-TW': '匯出 Nodus 書籤',
  ko: "Nodus 북마크 내보내기",
  ja: "Nodus ブックマークのエクスポート", },

  saveAudio: { es: 'Guardar audio', en: 'Save audio', fr: 'Enregistrer l’audio', de: 'Audio speichern', pt: 'Guardar áudio', 'pt-BR': 'Salvar áudio', it: 'Salva audio', tr: 'Sesi kaydet', 'zh-CN': '保存音频' ,
  'zh-TW': '儲存音訊',
  ko: "오디오 저장",
  ja: "音声を保存する", },

  chooseImage: { es: 'Elegir imagen', en: 'Choose image', fr: 'Choisir une image', de: 'Bild auswählen', pt: 'Escolher imagem', 'pt-BR': 'Escolher imagem', it: 'Scegli immagine', tr: 'Görsel seç', 'zh-CN': '选择图片' ,
  'zh-TW': '選擇圖片',
  ko: "이미지 선택",
  ja: "画像を選択してください", },
  chooseAudio: { es: 'Elegir audio', en: 'Choose audio', fr: 'Choisir un fichier audio', de: 'Audio auswählen', pt: 'Escolher áudio', 'pt-BR': 'Escolher áudio', it: 'Scegli audio', tr: 'Ses seç', 'zh-CN': '选择音频' ,
  'zh-TW': '選擇音訊',
  ko: "오디오 선택",
  ja: "オーディオを選択", },
  chooseVideo: { es: 'Elegir vídeo', en: 'Choose video', fr: 'Choisir une vidéo', de: 'Video auswählen', pt: 'Escolher vídeo', 'pt-BR': 'Escolher vídeo', it: 'Scegli video', tr: 'Video seç', 'zh-CN': '选择视频' ,
  'zh-TW': '選擇影片',
  ko: "비디오 선택",
  ja: "ビデオを選択してください", },
  chooseFile: { es: 'Elegir archivo', en: 'Choose file', fr: 'Choisir un fichier', de: 'Datei auswählen', pt: 'Escolher ficheiro', 'pt-BR': 'Escolher arquivo', it: 'Scegli file', tr: 'Dosya seç', 'zh-CN': '选择文件' ,
  'zh-TW': '選擇檔案',
  ko: "파일 선택",
  ja: "ファイルを選択してください", },

  chooseBackupFolder: { es: 'Elegir carpeta para copias automáticas', en: 'Choose folder for automatic backups', fr: 'Choisir le dossier des sauvegardes automatiques', de: 'Ordner für automatische Sicherungen auswählen', pt: 'Escolher pasta para cópias automáticas', 'pt-BR': 'Escolher pasta para backups automáticos', it: 'Scegli cartella per i backup automatici', tr: 'Otomatik yedekler için klasör seç', 'zh-CN': '选择自动备份文件夹' ,
  'zh-TW': '選擇自動備份資料夾',
  ko: "자동 백업을 위한 폴더 선택",
  ja: "自動バックアップ用のフォルダーを選択してください", },
  importSkillPackageDirectory: { es: 'Importar carpeta del paquete de habilidades', en: 'Import skill package directory', fr: 'Importer le dossier du paquet de compétences', de: 'Verzeichnis des Skill-Pakets importieren', pt: 'Importar pasta do pacote de competências', 'pt-BR': 'Importar pasta do pacote de habilidades', it: 'Importa cartella del pacchetto di abilità', tr: 'Yetenek paketi klasörünü içe aktar', 'zh-CN': '导入技能包文件夹' ,
  'zh-TW': '匯入技能包資料夾',
  ko: "스킬 패키지 디렉터리 가져오기",
  ja: "スキルパッケージディレクトリのインポート", },
  exportSkillPackageDirectory: { es: 'Exportar el paquete de habilidades a una carpeta', en: 'Export skill package into a directory', fr: 'Exporter le paquet de compétences vers un dossier', de: 'Skill-Paket in ein Verzeichnis exportieren', pt: 'Exportar o pacote de competências para uma pasta', 'pt-BR': 'Exportar o pacote de habilidades para uma pasta', it: 'Esporta il pacchetto di abilità in una cartella', tr: 'Yetenek paketini bir klasöre dışa aktar', 'zh-CN': '将技能包导出到文件夹' ,
  'zh-TW': '將技能包匯出到資料夾',
  ko: "기술 패키지를 디렉터리로 내보내기",
  ja: "スキルパッケージをディレクトリにエクスポートする", },
  saveCapabilityFile: { es: 'Guardar archivo de capacidad', en: 'Save capability file', fr: 'Enregistrer le fichier de capacité', de: 'Fähigkeitsdatei speichern', pt: 'Guardar ficheiro de capacidade', 'pt-BR': 'Salvar arquivo de capacidade', it: 'Salva file di capacità', tr: 'Yetenek dosyasını kaydet', 'zh-CN': '保存能力文件' ,
  'zh-TW': '儲存能力檔案',
  ko: "기능 파일 저장",
  ja: "機能ファイルの保存", },
  saveRecoveryKit: { es: 'Guardar kit de recuperación', en: 'Save recovery kit', fr: 'Enregistrer le kit de récupération', de: 'Wiederherstellungskit speichern', pt: 'Guardar kit de recuperação', 'pt-BR': 'Salvar kit de recuperação', it: 'Salva kit di ripristino', tr: 'Kurtarma kitini kaydet', 'zh-CN': '保存恢复工具包' ,
  'zh-TW': '儲存恢復工具包',
  ko: "복구 키트 저장",
  ja: "リカバリーキットを保存する", },

  exportNodusLibrary: { es: 'Exportar biblioteca Nodus', en: 'Export Nodus library', fr: 'Exporter la bibliothèque Nodus', de: 'Nodus-Bibliothek exportieren', pt: 'Exportar biblioteca Nodus', 'pt-BR': 'Exportar biblioteca Nodus', it: 'Esporta libreria Nodus', tr: 'Nodus kitaplığını dışa aktar', 'zh-CN': '导出 Nodus 文献库' ,
  'zh-TW': '匯出 Nodus 文獻庫',
  ko: "Nodus 라이브러리 내보내기",
  ja: "Nodus ライブラリをエクスポートする", },
  importNodusLibrary: { es: 'Importar biblioteca Nodus', en: 'Import Nodus library', fr: 'Importer la bibliothèque Nodus', de: 'Nodus-Bibliothek importieren', pt: 'Importar biblioteca Nodus', 'pt-BR': 'Importar biblioteca Nodus', it: 'Importa libreria Nodus', tr: 'Nodus kitaplığını içe aktar', 'zh-CN': '导入 Nodus 文献库' ,
  'zh-TW': '匯入 Nodus 文獻庫',
  ko: "Nodus 라이브러리 가져오기",
  ja: "Nodus ライブラリをインポートする", },
  exportManuscript: { es: 'Exportar el manuscrito', en: 'Export the manuscript', fr: 'Exporter le manuscrit', de: 'Manuskript exportieren', pt: 'Exportar o manuscrito', 'pt-BR': 'Exportar o manuscrito', it: 'Esporta il manoscritto', tr: 'El yazmasını dışa aktar', 'zh-CN': '导出书稿' ,
  'zh-TW': '匯出書稿',
  ko: "원고 내보내기",
  ja: "原稿をエクスポートする", },
  exportProject: { es: 'Exportar proyecto', en: 'Export project', fr: 'Exporter le projet', de: 'Projekt exportieren', pt: 'Exportar projeto', 'pt-BR': 'Exportar projeto', it: 'Esporta progetto', tr: 'Projeyi dışa aktar', 'zh-CN': '导出项目' ,
  'zh-TW': '匯出專案',
  ko: "프로젝트 내보내기",
  ja: "プロジェクトのエクスポート", },
  exportChapter: { es: 'Exportar capítulo', en: 'Export chapter', fr: 'Exporter le chapitre', de: 'Kapitel exportieren', pt: 'Exportar capítulo', 'pt-BR': 'Exportar capítulo', it: 'Esporta capitolo', tr: 'Bölümü dışa aktar', 'zh-CN': '导出章节' ,
  'zh-TW': '匯出章節',
  ko: "장 내보내기",
  ja: "エクスポートの章", },
  exportWorldBible: { es: 'Exportar la biblia del mundo', en: 'Export the world bible', fr: 'Exporter la bible du monde', de: 'Weltbibel exportieren', pt: 'Exportar a bíblia do mundo', 'pt-BR': 'Exportar a bíblia do mundo', it: 'Esporta la bibbia del mondo', tr: 'Dünya kitabını dışa aktar', 'zh-CN': '导出世界设定集' ,
  'zh-TW': '匯出世界設定集',
  ko: "세계성경 수출",
  ja: "世界聖書をエクスポートする", },
  exportNotes: { es: 'Exportar notas', en: 'Export notes', fr: 'Exporter les notes', de: 'Notizen exportieren', pt: 'Exportar notas', 'pt-BR': 'Exportar notas', it: 'Esporta note', tr: 'Notları dışa aktar', 'zh-CN': '导出笔记' ,
  'zh-TW': '匯出筆記',
  ko: "메모 내보내기",
  ja: "メモをエクスポートする", },
  exportCoverageMap: { es: 'Exportar mapa de cobertura', en: 'Export coverage map', fr: 'Exporter la carte de couverture', de: 'Abdeckungskarte exportieren', pt: 'Exportar mapa de cobertura', 'pt-BR': 'Exportar mapa de cobertura', it: 'Esporta mappa di copertura', tr: 'Kapsam haritasını dışa aktar', 'zh-CN': '导出覆盖图' ,
  'zh-TW': '匯出覆蓋圖',
  ko: "수출 범위 지도",
  ja: "カバレッジマップのエクスポート", },
  exportStudy: { es: 'Exportar estudio', en: 'Export study', fr: 'Exporter l’étude', de: 'Studie exportieren', pt: 'Exportar estudo', 'pt-BR': 'Exportar estudo', it: 'Esporta studio', tr: 'Çalışmayı dışa aktar', 'zh-CN': '导出学习库' ,
  'zh-TW': '匯出學習庫',
  ko: "수출 연구",
  ja: "研究の輸出", },
  exportReport: { es: 'Exportar informe', en: 'Export report', fr: 'Exporter le rapport', de: 'Bericht exportieren', pt: 'Exportar relatório', 'pt-BR': 'Exportar relatório', it: 'Esporta report', tr: 'Raporu dışa aktar', 'zh-CN': '导出报告' ,
  'zh-TW': '匯出報告',
  ko: "보고서 내보내기",
  ja: "レポートのエクスポート", },
  exportAuthorSynthesis: { es: 'Exportar síntesis de autores', en: 'Export author synthesis', fr: 'Exporter la synthèse des auteurs', de: 'Autorensynthese exportieren', pt: 'Exportar síntese de autores', 'pt-BR': 'Exportar síntese de autores', it: 'Esporta sintesi degli autori', tr: 'Yazar sentezini dışa aktar', 'zh-CN': '导出作者综述' ,
  'zh-TW': '匯出作者綜述',
  ko: "저자 합성 내보내기",
  ja: "著者合成のエクスポート", },
  downloadReports: { es: 'Descargar informes', en: 'Download reports', fr: 'Télécharger les rapports', de: 'Berichte herunterladen', pt: 'Transferir relatórios', 'pt-BR': 'Baixar relatórios', it: 'Scarica report', tr: 'Raporları indir', 'zh-CN': '下载报告' ,
  'zh-TW': '下載報告',
  ko: "보고서 다운로드",
  ja: "レポートをダウンロードする", },

  plainText: { es: 'Texto plano', en: 'Plain text', fr: 'Texte brut', de: 'Nur Text', pt: 'Texto simples', 'pt-BR': 'Texto simples', it: 'Testo semplice', tr: 'Düz metin', 'zh-CN': '纯文本' ,
  'zh-TW': '純文本',
  ko: "일반 텍스트",
  ja: "プレーンテキスト", },
  zipArchive: { es: 'Archivo ZIP', en: 'ZIP archive', fr: 'Archive ZIP', de: 'ZIP-Archiv', pt: 'Ficheiro ZIP', 'pt-BR': 'Arquivo ZIP', it: 'Archivio ZIP', tr: 'ZIP arşivi', 'zh-CN': 'ZIP 压缩包' ,
  'zh-TW': 'ZIP 壓縮包',
  ko: "ZIP 아카이브",
  ja: "ZIP アーカイブ", },
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
