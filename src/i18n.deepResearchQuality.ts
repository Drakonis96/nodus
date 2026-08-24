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

export const DEEP_RESEARCH_QUALITY_TRANSLATIONS = { en, fr, de, pt, 'pt-BR': ptBR, it, tr } as const;
