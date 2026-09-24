/** Files dropped on a vault's Library: imported to the Global Library and used in the vault. */
const keys = [
  'Se añadirá a la Biblioteca global y a este vault.',
  '{n} documento(s) añadido(s) a este vault y a la Biblioteca global. Se indexarán automáticamente.',
  '{n} documento(s) añadido(s) a este vault y a la Biblioteca global. La indexación automática está desactivada.',
  'Esos documentos ya estaban en este vault.',
];
const translations: Record<string, string[]> = {
  en: ['It will be added to the Global Library and to this vault.', '{n} document(s) added to this vault and to the Global Library. They will be indexed automatically.', '{n} document(s) added to this vault and to the Global Library. Automatic indexing is off.', 'Those documents were already in this vault.'],
  fr: ['Il sera ajouté à la Bibliothèque globale et à ce vault.', '{n} document(s) ajouté(s) à ce vault et à la Bibliothèque globale. Ils seront indexés automatiquement.', '{n} document(s) ajouté(s) à ce vault et à la Bibliothèque globale. L’indexation automatique est désactivée.', 'Ces documents étaient déjà dans ce vault.'],
  de: ['Wird zur globalen Bibliothek und zu diesem Vault hinzugefügt.', '{n} Dokument(e) zu diesem Vault und zur globalen Bibliothek hinzugefügt. Sie werden automatisch indexiert.', '{n} Dokument(e) zu diesem Vault und zur globalen Bibliothek hinzugefügt. Die automatische Indexierung ist deaktiviert.', 'Diese Dokumente waren bereits in diesem Vault.'],
  pt: ['Será adicionado à Biblioteca global e a este vault.', '{n} documento(s) adicionado(s) a este vault e à Biblioteca global. Serão indexados automaticamente.', '{n} documento(s) adicionado(s) a este vault e à Biblioteca global. A indexação automática está desativada.', 'Esses documentos já estavam neste vault.'],
  'pt-BR': ['Será adicionado à Biblioteca global e a este vault.', '{n} documento(s) adicionado(s) a este vault e à Biblioteca global. Eles serão indexados automaticamente.', '{n} documento(s) adicionado(s) a este vault e à Biblioteca global. A indexação automática está desativada.', 'Esses documentos já estavam neste vault.'],
  it: ['Verrà aggiunto alla Biblioteca globale e a questo vault.', '{n} documento/i aggiunto/i a questo vault e alla Biblioteca globale. Verranno indicizzati automaticamente.', '{n} documento/i aggiunto/i a questo vault e alla Biblioteca globale. L’indicizzazione automatica è disattivata.', 'Quei documenti erano già in questo vault.'],
  tr: ['Küresel Kitaplığa ve bu vault’a eklenecek.', '{n} belge bu vault’a ve Küresel Kitaplığa eklendi. Otomatik olarak dizinlenecek.', '{n} belge bu vault’a ve Küresel Kitaplığa eklendi. Otomatik dizinleme kapalı.', 'Bu belgeler zaten bu vault’taydı.'],
  'zh-CN': ['将添加到全局文献库和此 vault。', '已将 {n} 个文档添加到此 vault 和全局文献库，将自动建立索引。', '已将 {n} 个文档添加到此 vault 和全局文献库。自动索引已关闭。', '这些文档已在此 vault 中。'],
  'zh-TW': ['將新增到全域文獻庫和此 vault。', '已將 {n} 份文件新增到此 vault 和全域文獻庫，將自動建立索引。', '已將 {n} 份文件新增到此 vault 和全域文獻庫。自動索引已關閉。', '這些文件已在此 vault 中。'],
  ko: ['글로벌 라이브러리와 이 vault에 추가됩니다.', '문서 {n}개를 이 vault와 글로벌 라이브러리에 추가했습니다. 자동으로 색인됩니다.', '문서 {n}개를 이 vault와 글로벌 라이브러리에 추가했습니다. 자동 색인이 꺼져 있습니다.', '이 문서들은 이미 이 vault에 있습니다.'],
  ja: ['グローバルライブラリとこの vault に追加されます。', '{n} 件の文書をこの vault とグローバルライブラリに追加しました。自動的にインデックス化されます。', '{n} 件の文書をこの vault とグローバルライブラリに追加しました。自動インデックス化はオフです。', 'これらの文書はすでにこの vault にあります。'],
};
export const VAULT_FILE_DROP_TRANSLATIONS = Object.fromEntries(Object.entries(translations).map(([language, values]) => [language, Object.fromEntries(keys.map((key, index) => [key, values[index]]))]));
