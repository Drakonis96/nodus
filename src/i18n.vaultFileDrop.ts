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
keys.push('Indiferente', 'Preparación', 'Años', 'Vaults');
const filterTranslations: Record<string, string[]> = {
  en: ['Either', 'Preparation', 'Years', 'Vaults'], fr: ['Indifférent', 'Préparation', 'Années', 'Vaults'], de: ['Egal', 'Vorbereitung', 'Jahre', 'Vaults'], pt: ['Indiferente', 'Preparação', 'Anos', 'Vaults'],
  'pt-BR': ['Indiferente', 'Preparação', 'Anos', 'Vaults'], it: ['Indifferente', 'Preparazione', 'Anni', 'Vault'], tr: ['Fark etmez', 'Hazırlık', 'Yıllar', 'Vault’lar'],
  'zh-CN': ['不限', '准备', '年份', 'Vault'], 'zh-TW': ['不限', '準備', '年份', 'Vault'], ko: ['상관없음', '준비', '연도', 'Vault'], ja: ['指定なし', '準備', '年', 'Vault'],
};
for (const [language, values] of Object.entries(filterTranslations)) translations[language].push(...values);
keys.push('Este documento ya se está indexando en otra tarea.', 'La indexación de este documento no pudo empezar. Reintenta.', 'Indexación', 'Indexando:', 'Indexación en pausa', 'Reanudar la indexación', 'Pausar la indexación', 'Reintentar {n} documento(s) cuya indexación falló', 'Detener la indexación', 'Quitar de la indexación', 'Se cancelarán los documentos pendientes. Lo que ya está indexado se conserva.');
// Indexing as one Queue entry.
const queueTranslations: Record<string, string[]> = {
  en: ['This document is already being indexed by another task.', 'Indexing this document could not start. Retry.', 'Indexing', 'Indexing:', 'Indexing paused', 'Resume indexing', 'Pause indexing', 'Retry {n} document(s) whose indexing failed', 'Stop indexing', 'Remove from indexing', 'Pending documents will be cancelled. What is already indexed is kept.'],
  fr: ['Ce document est déjà en cours d’indexation dans une autre tâche.', 'L’indexation de ce document n’a pas pu démarrer. Réessayez.', 'Indexation', 'Indexation :', 'Indexation en pause', 'Reprendre l’indexation', 'Mettre l’indexation en pause', 'Réessayer {n} document(s) dont l’indexation a échoué', 'Arrêter l’indexation', 'Retirer de l’indexation', 'Les documents en attente seront annulés. Ce qui est déjà indexé est conservé.'],
  de: ['Dieses Dokument wird bereits in einer anderen Aufgabe indexiert.', 'Die Indexierung dieses Dokuments konnte nicht starten. Erneut versuchen.', 'Indexierung', 'Indexiere:', 'Indexierung pausiert', 'Indexierung fortsetzen', 'Indexierung pausieren', '{n} Dokument(e) mit fehlgeschlagener Indexierung erneut versuchen', 'Indexierung stoppen', 'Aus der Indexierung entfernen', 'Ausstehende Dokumente werden abgebrochen. Bereits Indexiertes bleibt erhalten.'],
  pt: ['Este documento já está a ser indexado noutra tarefa.', 'Não foi possível iniciar a indexação deste documento. Tente novamente.', 'Indexação', 'A indexar:', 'Indexação em pausa', 'Retomar a indexação', 'Pausar a indexação', 'Tentar novamente {n} documento(s) cuja indexação falhou', 'Parar a indexação', 'Retirar da indexação', 'Os documentos pendentes serão cancelados. O que já está indexado é mantido.'],
  'pt-BR': ['Este documento já está sendo indexado em outra tarefa.', 'Não foi possível iniciar a indexação deste documento. Tente novamente.', 'Indexação', 'Indexando:', 'Indexação pausada', 'Retomar a indexação', 'Pausar a indexação', 'Tentar novamente {n} documento(s) cuja indexação falhou', 'Parar a indexação', 'Remover da indexação', 'Os documentos pendentes serão cancelados. O que já está indexado é mantido.'],
  it: ['Questo documento è già in fase di indicizzazione in un’altra attività.', 'Impossibile avviare l’indicizzazione di questo documento. Riprova.', 'Indicizzazione', 'Indicizzazione di:', 'Indicizzazione in pausa', 'Riprendi l’indicizzazione', 'Metti in pausa l’indicizzazione', 'Riprova {n} documento/i la cui indicizzazione non è riuscita', 'Interrompi l’indicizzazione', 'Rimuovi dall’indicizzazione', 'I documenti in attesa verranno annullati. Ciò che è già indicizzato viene conservato.'],
  tr: ['Bu belge zaten başka bir görevde dizinleniyor.', 'Bu belgenin dizinlenmesi başlatılamadı. Yeniden deneyin.', 'Dizinleme', 'Dizinleniyor:', 'Dizinleme duraklatıldı', 'Dizinlemeyi sürdür', 'Dizinlemeyi duraklat', 'Dizinlemesi başarısız olan {n} belgeyi yeniden dene', 'Dizinlemeyi durdur', 'Dizinlemeden çıkar', 'Bekleyen belgeler iptal edilecek. Zaten dizinlenmiş olanlar korunur.'],
  'zh-CN': ['此文档已在另一个任务中建立索引。', '无法开始为此文档建立索引。请重试。', '索引', '正在索引：', '索引已暂停', '继续索引', '暂停索引', '重试 {n} 个索引失败的文档', '停止索引', '从索引中移除', '待处理的文档将被取消。已建立的索引会保留。'],
  'zh-TW': ['此文件已在另一個任務中建立索引。', '無法開始為此文件建立索引。請重試。', '索引', '正在索引：', '索引已暫停', '繼續索引', '暫停索引', '重試 {n} 份索引失敗的文件', '停止索引', '從索引中移除', '待處理的文件將被取消。已建立的索引會保留。'],
  ko: ['이 문서는 이미 다른 작업에서 색인 중입니다.', '이 문서의 색인을 시작할 수 없습니다. 다시 시도하세요.', '색인', '색인 중:', '색인 일시 중지됨', '색인 재개', '색인 일시 중지', '색인에 실패한 문서 {n}개 다시 시도', '색인 중지', '색인에서 제거', '대기 중인 문서는 취소됩니다. 이미 색인된 내용은 유지됩니다.'],
  ja: ['この文書はすでに別のタスクでインデックス化されています。', 'この文書のインデックス化を開始できませんでした。再試行してください。', 'インデックス化', 'インデックス化中:', 'インデックス化を一時停止中', 'インデックス化を再開', 'インデックス化を一時停止', 'インデックス化に失敗した {n} 件の文書を再試行', 'インデックス化を停止', 'インデックス化から外す', '保留中の文書はキャンセルされます。インデックス化済みの内容は保持されます。'],
};
for (const [language, values] of Object.entries(queueTranslations)) translations[language].push(...values);
keys.push('Copiar a una colección', 'Mover a una colección', 'Copiar aquí', 'Abre una colección de Nodus para mover documentos desde ella.', '{n} documento(s) seleccionado(s)', 'Etiqueta «{tag}» añadida a {n} documento(s).');
// The Global Library's selection bar.
const selectionTranslations: Record<string, string[]> = {
  en: ['Copy to a collection', 'Move to a collection', 'Copy here', 'Open a Nodus collection to move documents out of it.', '{n} document(s) selected', 'Tag “{tag}” added to {n} document(s).'],
  fr: ['Copier dans une collection', 'Déplacer vers une collection', 'Copier ici', 'Ouvrez une collection Nodus pour en déplacer des documents.', '{n} document(s) sélectionné(s)', 'Étiquette « {tag} » ajoutée à {n} document(s).'],
  de: ['In eine Sammlung kopieren', 'In eine Sammlung verschieben', 'Hierher kopieren', 'Öffne eine Nodus-Sammlung, um Dokumente aus ihr zu verschieben.', '{n} Dokument(e) ausgewählt', 'Tag „{tag}“ zu {n} Dokument(en) hinzugefügt.'],
  pt: ['Copiar para uma coleção', 'Mover para uma coleção', 'Copiar para aqui', 'Abra uma coleção Nodus para mover documentos a partir dela.', '{n} documento(s) selecionado(s)', 'Etiqueta «{tag}» adicionada a {n} documento(s).'],
  'pt-BR': ['Copiar para uma coleção', 'Mover para uma coleção', 'Copiar para cá', 'Abra uma coleção do Nodus para mover documentos a partir dela.', '{n} documento(s) selecionado(s)', 'Etiqueta “{tag}” adicionada a {n} documento(s).'],
  it: ['Copia in una raccolta', 'Sposta in una raccolta', 'Copia qui', 'Apri una raccolta Nodus per spostarne i documenti.', '{n} documento/i selezionato/i', 'Etichetta «{tag}» aggiunta a {n} documento/i.'],
  tr: ['Bir koleksiyona kopyala', 'Bir koleksiyona taşı', 'Buraya kopyala', 'Belgeleri taşımak için bir Nodus koleksiyonu açın.', '{n} belge seçildi', '“{tag}” etiketi {n} belgeye eklendi.'],
  'zh-CN': ['复制到合集', '移动到合集', '复制到此处', '请打开一个 Nodus 合集，才能从中移动文档。', '已选择 {n} 个文档', '已为 {n} 个文档添加标签“{tag}”。'],
  'zh-TW': ['複製到合集', '移動到合集', '複製到此處', '請開啟一個 Nodus 合集，才能從中移動文件。', '已選取 {n} 份文件', '已為 {n} 份文件新增標籤「{tag}」。'],
  ko: ['컬렉션으로 복사', '컬렉션으로 이동', '여기로 복사', '문서를 옮기려면 Nodus 컬렉션을 여세요.', '문서 {n}개 선택됨', '문서 {n}개에 “{tag}” 태그를 추가했습니다.'],
  ja: ['コレクションにコピー', 'コレクションに移動', 'ここにコピー', '文書を移動するには Nodus のコレクションを開いてください。', '{n} 件の文書を選択中', '{n} 件の文書にタグ「{tag}」を追加しました。'],
};
for (const [language, values] of Object.entries(selectionTranslations)) translations[language].push(...values);
export const VAULT_FILE_DROP_TRANSLATIONS = Object.fromEntries(Object.entries(translations).map(([language, values]) => [language, Object.fromEntries(keys.map((key, index) => [key, values[index]]))]));
