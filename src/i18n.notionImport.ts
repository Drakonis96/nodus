const catalog = [
  ['Importar desde Notion','Import from Notion','Importer depuis Notion','Aus Notion importieren','Importar do Notion','Importar do Notion','Importa da Notion','Notion’dan içe aktar', '从 Notion 导入', '從 Notion 匯入'],
  ['Importación de Notion completada','Notion import completed','Importation Notion terminée','Notion-Import abgeschlossen','Importação do Notion concluída','Importação do Notion concluída','Importazione da Notion completata','Notion içe aktarma tamamlandı', 'Notion 导入已完成', 'Notion 匯入已完成'],
  ['Se conservaron {n} páginas de fila y se deduplicaron {a} archivos.','{n} row pages were preserved and {a} files were deduplicated.','{n} pages de ligne ont été conservées et {a} fichiers dédupliqués.','{n} Zeilenseiten wurden erhalten und {a} Dateien dedupliziert.','Foram preservadas {n} páginas de linha e desduplicados {a} ficheiros.','Foram preservadas {n} páginas de linha e {a} arquivos foram desduplicados.','Sono state conservate {n} pagine di riga e deduplicati {a} file.','{n} satır sayfası korundu ve {a} dosya tekilleştirildi.', '保留了{n}个行页面，并对{a}个文件进行了去重。', '保留了{n}個行頁面，並對{a}個檔案進行了去重。'],
  ['Informe de compatibilidad','Compatibility report','Rapport de compatibilité','Kompatibilitätsbericht','Relatório de compatibilidade','Relatório de compatibilidade','Rapporto di compatibilità','Uyumluluk raporu', '兼容性报告', '相容性報告'],
] as const;

function language(index: number): Record<string, string> { return Object.fromEntries(catalog.map((row) => [row[0], row[index]])); }
export const NOTION_IMPORT_TRANSLATIONS = {
  en: language(1), fr: language(2), de: language(3), pt: language(4), 'pt-BR': language(5), it: language(6), tr: language(7), 'zh-CN': language(9),
  'zh-TW': language(9),
} as const;
