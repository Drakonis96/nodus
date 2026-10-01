// The setting that extracts new PDFs with reaction schemes and figure labels folded into "[scheme]".
const KEYS = [
  "Simplificar esquemas y figuras en PDFs nuevos",
  "Las etiquetas sueltas de esquemas de reacción, figuras y tablas se sustituyen por «[scheme]» y se quitan los encabezados de página. Solo se aplica a obras cuyo texto aún no se ha usado; la elección se conserva para cada obra.",
] as const;

function table(values: readonly string[]): Record<string, string> {
  if (values.length !== KEYS.length) throw new Error('Scheme declutter translations are incomplete.');
  return Object.fromEntries(KEYS.map((key, index) => [key, values[index]]));
}

export const SCHEME_DECLUTTER_TRANSLATIONS = {
  "en": table([
    "Simplify schemes and figures in new PDFs",
    "Stray labels from reaction schemes, figures and tables are replaced by “[scheme]”, and running heads are removed. Applies only to works whose text has not been used yet; the choice is preserved for each work.",
  ]),
  "fr": table([
    "Simplifier les schémas et figures des nouveaux PDF",
    "Les libellés épars des schémas réactionnels, figures et tableaux sont remplacés par « [scheme] » et les titres courants sont supprimés. S’applique uniquement aux œuvres dont le texte n’a pas encore été utilisé ; ce choix est conservé pour chaque œuvre.",
  ]),
  "de": table([
    "Schemata und Abbildungen in neuen PDFs vereinfachen",
    "Verstreute Beschriftungen aus Reaktionsschemata, Abbildungen und Tabellen werden durch „[scheme]“ ersetzt, Kolumnentitel werden entfernt. Gilt nur für Werke, deren Text noch nicht verwendet wurde; die Wahl bleibt für jedes Werk erhalten.",
  ]),
  "pt": table([
    "Simplificar esquemas e figuras em PDFs novos",
    "As etiquetas soltas de esquemas de reação, figuras e tabelas são substituídas por «[scheme]» e os cabeçalhos de página são removidos. Aplica-se apenas a obras cujo texto ainda não foi usado; a escolha é preservada para cada obra.",
  ]),
  "pt-BR": table([
    "Simplificar esquemas e figuras em PDFs novos",
    "Os rótulos soltos de esquemas de reação, figuras e tabelas são substituídos por “[scheme]” e os cabeçalhos de página são removidos. Vale apenas para obras cujo texto ainda não foi usado; a escolha é preservada para cada obra.",
  ]),
  "it": table([
    "Semplifica schemi e figure nei nuovi PDF",
    "Le etichette sparse di schemi di reazione, figure e tabelle vengono sostituite da «[scheme]» e le testatine vengono rimosse. Vale solo per le opere il cui testo non è ancora stato usato; la scelta viene mantenuta per ogni opera.",
  ]),
  "tr": table([
    "Yeni PDF'lerde şemaları ve şekilleri sadeleştir",
    "Tepkime şemaları, şekiller ve tablolardan kalan dağınık etiketler “[scheme]” ile değiştirilir ve sayfa başlıkları kaldırılır. Yalnızca metni henüz kullanılmamış eserlere uygulanır; bu seçim her eser için korunur.",
  ]),
  "zh-CN": table([
    "简化新 PDF 中的反应式和图表",
    "反应式、图和表中零散的标签会替换为“[scheme]”，并移除页眉。仅适用于文本尚未使用过的作品；每部作品都会保留此选择。",
  ]),
  "zh-TW": table([
    "簡化新 PDF 中的反應式與圖表",
    "反應式、圖與表中零散的標籤會替換為「[scheme]」，並移除頁首。僅適用於文字尚未使用過的作品；每部作品都會保留此選擇。",
  ]),
  "ja": table([
    "新しい PDF の反応スキームと図を簡略化",
    "反応スキーム、図、表の断片的なラベルを「[scheme]」に置き換え、柱を削除します。テキストがまだ使われていない作品にのみ適用され、この選択は作品ごとに保持されます。",
  ]),
  "ko": table([
    "새 PDF의 반응 도식과 그림 단순화",
    "반응 도식, 그림, 표에서 흩어진 레이블을 “[scheme]”으로 바꾸고 머리글을 제거합니다. 텍스트가 아직 사용되지 않은 작품에만 적용되며, 이 선택은 작품별로 유지됩니다.",
  ]),
} as const;
