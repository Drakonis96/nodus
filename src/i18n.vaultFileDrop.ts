/** A vault's Library: files dropped on it (imported to the Global Library and used in the
 * vault) and its per-document index button. */
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
keys.push('Reindexar documento', 'Reintentar indexado');
const indexActionTranslations: Record<string, string[]> = {
  en: ['Reindex document', 'Retry indexing'],
  fr: ['Réindexer le document', 'Réessayer l’indexation'],
  de: ['Dokument neu indexieren', 'Indexierung erneut versuchen'],
  pt: ['Reindexar documento', 'Tentar indexar novamente'],
  'pt-BR': ['Reindexar documento', 'Tentar indexar novamente'],
  it: ['Reindicizza documento', 'Riprova l’indicizzazione'],
  tr: ['Belgeyi yeniden dizinle', 'Dizinlemeyi yeniden dene'],
  'zh-CN': ['重新索引文档', '重试索引'],
  'zh-TW': ['重新索引文件', '重試索引'],
  ko: ['문서 다시 색인', '색인 다시 시도'],
  ja: ['文書を再インデックス化', 'インデックス化を再試行'],
};
for (const [language, values] of Object.entries(indexActionTranslations)) translations[language].push(...values);
keys.push('Indexar documentos', 'Se indexarán {n} documentos con el modelo de embeddings configurado. ¿Continuar?', 'Configura un modelo de embeddings para indexar.', '{n} documento(s) en cola para indexar.', 'Ya está todo indexado.');
const indexNowTranslations: Record<string, string[]> = {
  en: ['Index documents', '{n} documents will be indexed with the configured embedding model. Continue?', 'Set up an embedding model to index.', '{n} document(s) queued for indexing.', 'Everything is already indexed.'],
  fr: ['Indexer les documents', '{n} documents seront indexés avec le modèle d’embeddings configuré. Continuer ?', 'Configurez un modèle d’embeddings pour indexer.', '{n} document(s) en file pour l’indexation.', 'Tout est déjà indexé.'],
  de: ['Dokumente indexieren', '{n} Dokumente werden mit dem konfigurierten Embedding-Modell indexiert. Fortfahren?', 'Richte ein Embedding-Modell ein, um zu indexieren.', '{n} Dokument(e) zur Indexierung eingereiht.', 'Alles ist bereits indexiert.'],
  pt: ['Indexar documentos', 'Serão indexados {n} documentos com o modelo de embeddings configurado. Continuar?', 'Configure um modelo de embeddings para indexar.', '{n} documento(s) em fila para indexar.', 'Já está tudo indexado.'],
  'pt-BR': ['Indexar documentos', 'Serão indexados {n} documentos com o modelo de embeddings configurado. Continuar?', 'Configure um modelo de embeddings para indexar.', '{n} documento(s) na fila para indexar.', 'Já está tudo indexado.'],
  it: ['Indicizza documenti', 'Verranno indicizzati {n} documenti con il modello di embedding configurato. Continuare?', 'Configura un modello di embedding per indicizzare.', '{n} documento/i in coda per l’indicizzazione.', 'È già tutto indicizzato.'],
  tr: ['Belgeleri dizinle', '{n} belge yapılandırılmış embedding modeliyle dizinlenecek. Devam edilsin mi?', 'Dizinlemek için bir embedding modeli ayarla.', '{n} belge dizinleme için sıraya alındı.', 'Her şey zaten dizinlenmiş.'],
  'zh-CN': ['为文档建立索引', '将使用已配置的嵌入模型为 {n} 个文档建立索引。继续吗？', '请先配置嵌入模型再建立索引。', '已将 {n} 个文档加入索引队列。', '已全部建立索引。'],
  'zh-TW': ['為文件建立索引', '將使用已設定的嵌入模型為 {n} 份文件建立索引。繼續嗎？', '請先設定嵌入模型再建立索引。', '已將 {n} 份文件加入索引佇列。', '已全部建立索引。'],
  ko: ['문서 색인', '설정된 임베딩 모델로 문서 {n}개를 색인합니다. 계속할까요?', '색인하려면 임베딩 모델을 설정하세요.', '문서 {n}개를 색인 대기열에 추가했습니다.', '이미 모두 색인되었습니다.'],
  ja: ['文書をインデックス化', '設定済みの埋め込みモデルで {n} 件の文書をインデックス化します。続行しますか？', 'インデックス化するには埋め込みモデルを設定してください。', '{n} 件の文書をインデックス化のキューに追加しました。', 'すべてインデックス化済みです。'],
};
for (const [language, values] of Object.entries(indexNowTranslations)) translations[language].push(...values);
export const VAULT_FILE_DROP_TRANSLATIONS = Object.fromEntries(Object.entries(translations).map(([language, values]) => [language, Object.fromEntries(keys.map((key, index) => [key, values[index]]))]));
