const catalog = [
  ['Importar desde Notion','Import from Notion','Importer depuis Notion','Aus Notion importieren','Importar do Notion','Importar do Notion','Importa da Notion','Notion’dan içe aktar'],
  ['Importación de Notion completada','Notion import completed','Importation Notion terminée','Notion-Import abgeschlossen','Importação do Notion concluída','Importação do Notion concluída','Importazione da Notion completata','Notion içe aktarma tamamlandı'],
  ['Se conservaron {n} páginas de fila y se deduplicaron {a} archivos.','{n} row pages were preserved and {a} files were deduplicated.','{n} pages de ligne ont été conservées et {a} fichiers dédupliqués.','{n} Zeilenseiten wurden erhalten und {a} Dateien dedupliziert.','Foram preservadas {n} páginas de linha e desduplicados {a} ficheiros.','Foram preservadas {n} páginas de linha e {a} arquivos foram desduplicados.','Sono state conservate {n} pagine di riga e deduplicati {a} file.','{n} satır sayfası korundu ve {a} dosya tekilleştirildi.'],
  ['Informe de compatibilidad','Compatibility report','Rapport de compatibilité','Kompatibilitätsbericht','Relatório de compatibilidade','Relatório de compatibilidade','Rapporto di compatibilità','Uyumluluk raporu'],
] as const;

function language(index: number): Record<string, string> { return Object.fromEntries(catalog.map((row) => [row[0], row[index]])); }
export const NOTION_IMPORT_TRANSLATIONS = {
  en: language(1), fr: language(2), de: language(3), pt: language(4), 'pt-BR': language(5), it: language(6), tr: language(7),
} as const;
