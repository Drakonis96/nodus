const KEYS = [
  'Calidad del informe',
  'Indicadores reproducibles. No sustituyen la revisión de las fuentes.',
  'Respaldo',
  'Profundidad',
  'Diversidad',
  'Síntesis multifuente',
  'Coherencia',
  'Cobertura del encargo',
  'Fuentes efectivas',
  'Citas con reparos',
  'Redundancia',
  '{passed} de {total} secciones superan los umbrales',
  'supera los umbrales de calidad',
  'sólido',
  'requiere revisión',
  'débil',
] as const;

function table(values: readonly string[]): Record<string, string> {
  if (values.length !== KEYS.length) throw new Error('Deep Research quality translations are incomplete.');
  return Object.fromEntries(KEYS.map((key, index) => [key, values[index]]));
}

const en = table(['Report quality', 'Reproducible indicators. They do not replace source review.', 'Grounding', 'Depth', 'Diversity', 'Cross-source synthesis', 'Coherence', 'Brief coverage', 'Effective sources', 'Citations with concerns', 'Redundancy', '{passed} of {total} sections pass the thresholds', 'passes the quality thresholds', 'strong indicators', 'needs review', 'weak']);
const fr = table(['Qualité du rapport', 'Indicateurs reproductibles. Ils ne remplacent pas la vérification des sources.', 'Justification', 'Profondeur', 'Diversité', 'Synthèse entre sources', 'Cohérence', 'Couverture de la consigne', 'Sources effectives', 'Citations problématiques', 'Redondance', '{passed} sections sur {total} dépassent les seuils', 'dépasse les seuils de qualité', 'indicateurs solides', 'à vérifier', 'faible']);
const de = table(['Berichtsqualität', 'Reproduzierbare Indikatoren. Sie ersetzen nicht die Quellenprüfung.', 'Beleglage', 'Tiefe', 'Vielfalt', 'Quellenübergreifende Synthese', 'Kohärenz', 'Abdeckung des Auftrags', 'Effektive Quellen', 'Beanstandete Zitate', 'Redundanz', '{passed} von {total} Abschnitten erfüllen die Schwellenwerte', 'erfüllt die Qualitätsschwellen', 'starke Indikatoren', 'prüfbedürftig', 'schwach']);
const pt = table(['Qualidade do relatório', 'Indicadores reproduzíveis. Não substituem a revisão das fontes.', 'Fundamentação', 'Profundidade', 'Diversidade', 'Síntese entre fontes', 'Coerência', 'Cobertura do pedido', 'Fontes efetivas', 'Citações com reservas', 'Redundância', '{passed} de {total} secções superam os limiares', 'supera os limiares de qualidade', 'indicadores sólidos', 'requer revisão', 'fraco']);
const ptBR = table(['Qualidade do relatório', 'Indicadores reproduzíveis. Não substituem a revisão das fontes.', 'Fundamentação', 'Profundidade', 'Diversidade', 'Síntese entre fontes', 'Coerência', 'Cobertura do pedido', 'Fontes efetivas', 'Citações com ressalvas', 'Redundância', '{passed} de {total} seções superam os limites', 'supera os limites de qualidade', 'indicadores sólidos', 'requer revisão', 'fraco']);
const it = table(['Qualità del rapporto', 'Indicatori riproducibili. Non sostituiscono la verifica delle fonti.', 'Fondamento', 'Profondità', 'Diversità', 'Sintesi tra fonti', 'Coerenza', 'Copertura della richiesta', 'Fonti effettive', 'Citazioni con riserve', 'Ridondanza', '{passed} sezioni su {total} superano le soglie', 'supera le soglie di qualità', 'indicatori solidi', 'da rivedere', 'debole']);
const tr = table(['Rapor kalitesi', 'Yeniden üretilebilir göstergeler. Kaynak incelemesinin yerini almaz.', 'Dayanak', 'Derinlik', 'Çeşitlilik', 'Kaynaklar arası sentez', 'Tutarlılık', 'İstek kapsamı', 'Etkin kaynaklar', 'Şüpheli atıflar', 'Tekrar', '{total} bölümün {passed} tanesi eşikleri geçiyor', 'kalite eşiklerini geçiyor', 'güçlü göstergeler', 'inceleme gerekli', 'zayıf']);
const zhCN = table(['报告质量', '可复现的指标。它们不能替代对来源的核查。', '依据', '深度', '多样性', '跨来源综合', '连贯性', '任务覆盖度', '有效来源', '有疑虑的引注', '冗余', '{total} 个章节中有 {passed} 个通过阈值', '通过质量阈值', '指标强劲', '需要复核', '较弱']);

const zhTW = table(['報告質量', '可復現的指標。它們不能替代對來源的核查。', '依據', '深度', '多樣性', '跨來源綜合', '連貫性', '任務覆蓋度', '有效來源', '有疑慮的引注', '冗餘', '{total} 個章節中有 {passed} 個通過閾值', '通過質量閾值', '指標強勁', '需要複核', '較弱']);

export const DEEP_RESEARCH_QUALITY_TRANSLATIONS = { en, fr, de, pt, 'pt-BR': ptBR, it, tr, 'zh-CN': zhCN ,
  'zh-TW': zhTW,
  ko: table([
    "보고서 품질",
    "재현 가능한 지표. 이는 소스 리뷰를 대체하지 않습니다.",
    "접지",
    "깊이",
    "다양성",
    "소스간 합성",
    "통일",
    "간략한 보도",
    "효과적인 소스",
    "우려가 있는 인용",
    "중복성",
    "{total}개 섹션 중 {passed}개가 임계값을 통과했습니다.",
    "품질 기준을 통과했습니다.",
    "강력한 지표",
    "검토가 필요하다",
    "약한",
  ]),
  ja: table([
    "レポートの品質",
    "再現可能なインジケーター。これらはソースレビューに代わるものではありません。",
    "接地",
    "深さ",
    "多様性",
    "クロスソース合成",
    "一貫性",
    "簡単な内容",
    "効果的な情報源",
    "懸念のある引用",
    "冗長性",
    "{total} セクション中 {passed} セクションがしきい値を超えています",
    "品質のしきい値を超えています",
    "強力な指標",
    "見直しが必要",
    "弱い",
  ]), } as const;
