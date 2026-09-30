// Translations for the favourite-model availability check in Settings › AI providers
// (ProvidersSettings.tsx): favourites a provider no longer lists, replaced or removed.
const KEYS = [
  'Comprobar disponibilidad',
  'Comprobando…',
  'Ya no los ofrece su proveedor',
  'Estos favoritos ya no aparecen en la lista de modelos de su proveedor. Sustitúyelos en las tareas que los usan o quítalos.',
  '{provider} ya no ofrece este modelo',
  'Lo usan {n} tareas',
  'Ninguna tarea lo usa',
  'Sustituir por…',
  'Sustituir',
  'Quitar',
  'Todos los favoritos siguen disponibles.',
  'No se pudo comprobar: {providers}',
  'Sustituido en {n} tareas.',
] as const;

function table(values: readonly string[]): Record<string, string> {
  if (values.length !== KEYS.length) throw new Error('Stale-model translations are incomplete.');
  return Object.fromEntries(KEYS.map((key, index) => [key, values[index]]));
}

export const STALE_MODEL_TRANSLATIONS = {
  en: table([
    'Check availability', 'Checking…', 'No longer offered by their provider',
    'These favorites no longer appear in their provider’s model list. Replace them in the tasks that use them, or remove them.',
    '{provider} no longer offers this model', 'Used by {n} tasks', 'No task uses it', 'Replace with…', 'Replace', 'Remove',
    'All favorites are still offered.', 'Could not check: {providers}', 'Replaced in {n} tasks.',
  ]),
  fr: table([
    'Vérifier la disponibilité', 'Vérification…', 'Plus proposés par leur fournisseur',
    'Ces favoris n’apparaissent plus dans la liste de modèles de leur fournisseur. Remplacez-les dans les tâches qui les utilisent ou retirez-les.',
    '{provider} ne propose plus ce modèle', 'Utilisé par {n} tâches', 'Aucune tâche ne l’utilise', 'Remplacer par…', 'Remplacer', 'Retirer',
    'Tous les favoris sont toujours proposés.', 'Vérification impossible : {providers}', 'Remplacé dans {n} tâches.',
  ]),
  de: table([
    'Verfügbarkeit prüfen', 'Wird geprüft…', 'Vom Anbieter nicht mehr angeboten',
    'Diese Favoriten erscheinen nicht mehr in der Modellliste ihres Anbieters. Ersetzen Sie sie in den Aufgaben, die sie verwenden, oder entfernen Sie sie.',
    '{provider} bietet dieses Modell nicht mehr an', 'Von {n} Aufgaben verwendet', 'Von keiner Aufgabe verwendet', 'Ersetzen durch…', 'Ersetzen', 'Entfernen',
    'Alle Favoriten werden weiterhin angeboten.', 'Prüfung nicht möglich: {providers}', 'In {n} Aufgaben ersetzt.',
  ]),
  pt: table([
    'Verificar disponibilidade', 'A verificar…', 'Já não disponibilizados pelo fornecedor',
    'Estes favoritos já não aparecem na lista de modelos do fornecedor. Substitua-os nas tarefas que os usam ou remova-os.',
    '{provider} já não disponibiliza este modelo', 'Usado por {n} tarefas', 'Nenhuma tarefa o usa', 'Substituir por…', 'Substituir', 'Remover',
    'Todos os favoritos continuam disponíveis.', 'Não foi possível verificar: {providers}', 'Substituído em {n} tarefas.',
  ]),
  'pt-BR': table([
    'Verificar disponibilidade', 'Verificando…', 'Não oferecidos mais pelo provedor',
    'Estes favoritos não aparecem mais na lista de modelos do provedor. Substitua-os nas tarefas que os usam ou remova-os.',
    '{provider} não oferece mais este modelo', 'Usado por {n} tarefas', 'Nenhuma tarefa o usa', 'Substituir por…', 'Substituir', 'Remover',
    'Todos os favoritos continuam disponíveis.', 'Não foi possível verificar: {providers}', 'Substituído em {n} tarefas.',
  ]),
  it: table([
    'Verifica disponibilità', 'Verifica in corso…', 'Non più offerti dal fornitore',
    'Questi preferiti non compaiono più nell’elenco dei modelli del loro fornitore. Sostituiscili nelle attività che li usano oppure rimuovili.',
    '{provider} non offre più questo modello', 'Usato da {n} attività', 'Nessuna attività lo usa', 'Sostituisci con…', 'Sostituisci', 'Rimuovi',
    'Tutti i preferiti sono ancora disponibili.', 'Impossibile verificare: {providers}', 'Sostituito in {n} attività.',
  ]),
  tr: table([
    'Kullanılabilirliği denetle', 'Denetleniyor…', 'Sağlayıcısı artık sunmuyor',
    'Bu favoriler artık sağlayıcılarının model listesinde görünmüyor. Onları kullanan görevlerde değiştirin veya kaldırın.',
    '{provider} bu modeli artık sunmuyor', '{n} görev kullanıyor', 'Hiçbir görev kullanmıyor', 'Şununla değiştir…', 'Değiştir', 'Kaldır',
    'Tüm favoriler hâlâ sunuluyor.', 'Denetlenemedi: {providers}', '{n} görevde değiştirildi.',
  ]),
  'zh-CN': table([
    '检查可用性', '正在检查…', '提供商已不再提供',
    '这些收藏的模型已不在其提供商的模型列表中。请在使用它们的任务中替换，或将其移除。',
    '{provider} 已不再提供此模型', '{n} 个任务在使用', '没有任务使用', '替换为…', '替换', '移除',
    '所有收藏的模型仍然可用。', '无法检查：{providers}', '已在 {n} 个任务中替换。',
  ]),
  'zh-TW': table([
    '檢查可用性', '正在檢查…', '提供者已不再提供',
    '這些收藏的模型已不在其提供者的模型清單中。請在使用它們的任務中替換，或將其移除。',
    '{provider} 已不再提供此模型', '{n} 個任務正在使用', '沒有任務使用', '替換為…', '替換', '移除',
    '所有收藏的模型仍可使用。', '無法檢查：{providers}', '已在 {n} 個任務中替換。',
  ]),
  ja: table([
    '利用可否を確認', '確認中…', 'プロバイダーが提供を終了',
    'これらのお気に入りは、プロバイダーのモデル一覧に表示されなくなりました。使用しているタスクで置き換えるか、削除してください。',
    '{provider} はこのモデルを提供していません', '{n} 件のタスクが使用中', '使用しているタスクはありません', '置き換え先…', '置き換える', '削除',
    'すべてのお気に入りは引き続き利用できます。', '確認できませんでした: {providers}', '{n} 件のタスクで置き換えました。',
  ]),
  ko: table([
    '사용 가능 여부 확인', '확인 중…', '제공업체가 더 이상 제공하지 않음',
    '이 즐겨찾기는 더 이상 제공업체의 모델 목록에 없습니다. 사용 중인 작업에서 교체하거나 제거하세요.',
    '{provider}에서 더 이상 이 모델을 제공하지 않습니다', '{n}개 작업에서 사용 중', '사용하는 작업 없음', '다음으로 교체…', '교체', '제거',
    '모든 즐겨찾기를 계속 사용할 수 있습니다.', '확인할 수 없음: {providers}', '{n}개 작업에서 교체했습니다.',
  ]),
} as const;
