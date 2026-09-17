// Analysis for a database. Three layers, all keeping the guiding rule that the AI never
// invents figures:
//  1. getDatabaseProfile / generateAnalysisReport — the univariate profile + an AI
//     narrative written over it (unchanged).
//  2. suggestDatabaseAnalyses — the AI *plans*: given the profile + the catalog of
//     analyses the app can compute (shared/analysisCatalog.ts), it returns a ranked list
//     of concrete analyses over real columns. Every suggestion is validated against the
//     schema before it is surfaced.
//  3. runDatabaseAnalysis — the engine *computes*: it loads the rows and produces an
//     AnalysisResult deterministically (shared/stats.ts), returning aggregates only —
//     raw rows never reach the model. narrateAnalysisResult writes optional prose over a
//     computed result.
// All completions are injectable so the logic is unit-tested without a provider.

import { getDatabase, getColumns, queryDatabaseRows } from '../db/databasesRepo';
import { getDb } from '../db/database';
import { computeProfile, profileToText } from '@shared/dataProfile';
import { comparableType } from '@shared/databaseFormula';
import { applicableAnalyses, assignColumns, catalogManifest, kindMeta, validateRequest } from '@shared/analysisCatalog';
import { parseAnalysisSuggestions } from '@shared/analysisSpec';
import {
  boxplot,
  categoryValues,
  categoryValuesMulti,
  chiSquare,
  contingencyTable,
  correlationMatrix,
  covarianceMatrix,
  crosstab,
  dateValues,
  describe,
  finitePairs,
  frequencies,
  groupBy,
  linearRegression,
  numericValues,
  pearson,
  round,
  spearman,
  timeSeries,
} from '@shared/stats';
import type { ColumnProfile, DatabaseProfile, DistributionSlice, HistogramBucket, NumberStats } from '@shared/dataProfile';
import type { AnalysisRequest, AnalysisResult, AnalysisSuggestion, DescriptiveColumn, GroupMetric, ScatterPoint, SeriesLine } from '@shared/analysisSpec';
import type { DatabaseColumn, DatabaseRow, ModelRef, PromptLanguage } from '@shared/types';
import { getSettings } from '../db/settingsRepo';

export interface DatabaseProfileResult {
  databaseName: string;
  profile: DatabaseProfile;
}

const profileRound = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** SQL-backed profile: aggregate state is bounded by columns/buckets, not row count. */
function computeDatabaseProfileSql(databaseId: string, columns: DatabaseColumn[]): DatabaseProfile {
  const db = getDb();
  const rowCount = Number((db.prepare('SELECT COUNT(*) AS count FROM db_rows WHERE database_id = ?').get(databaseId) as { count: number }).count);
  const profiles: ColumnProfile[] = [];
  for (const column of columns) {
    const valueType = comparableType(column);
    const table = column.type === 'formula' || column.type === 'rollup' ? 'db_computed_cells' : 'db_cells';
    const base = { columnId: column.id, name: column.name, type: column.type, valueType };
    if (valueType === 'number') {
      const expression = 'COALESCE(value_number, value_integer, CAST(value_text AS REAL))';
      const stats = db.prepare(
        `WITH values_list(value) AS (
           SELECT ${expression} FROM ${table}
           WHERE database_id = ? AND column_id = ?
             AND COALESCE(value_number, value_integer, value_text) IS NOT NULL
         ), aggregate AS (
           SELECT COUNT(*) AS count, MIN(value) AS min, MAX(value) AS max,
                  AVG(value) AS mean, SUM(value) AS sum, AVG(value * value) AS mean_square
           FROM values_list
         ), ranked AS (
           SELECT value, ROW_NUMBER() OVER (ORDER BY value) AS row_number,
                  COUNT(*) OVER () AS total FROM values_list
         )
         SELECT aggregate.*, (SELECT AVG(value) FROM ranked
           WHERE row_number IN ((total + 1) / 2, (total + 2) / 2)) AS median
         FROM aggregate`,
      ).get(databaseId, column.id) as { count: number; min: number | null; max: number | null; mean: number | null; sum: number | null; mean_square: number | null; median: number | null };
      let number: NumberStats | undefined;
      if (stats.count > 0 && stats.min != null && stats.max != null && stats.mean != null && stats.sum != null && stats.median != null) {
        const buckets = Math.min(8, Math.max(1, stats.count));
        let histogram: HistogramBucket[];
        if (stats.min === stats.max) histogram = [{ label: String(profileRound(stats.min)), count: stats.count }];
        else {
          const width = (stats.max - stats.min) / buckets;
          const counts = db.prepare(
            `SELECT MIN(?, CAST((${expression} - ?) / ? AS INTEGER)) AS bucket, COUNT(*) AS count
             FROM ${table}
             WHERE database_id = ? AND column_id = ?
               AND COALESCE(value_number, value_integer, value_text) IS NOT NULL
             GROUP BY bucket ORDER BY bucket`,
          ).all(buckets - 1, stats.min, width, databaseId, column.id) as Array<{ bucket: number; count: number }>;
          const byBucket = new Map(counts.map((entry) => [entry.bucket, entry.count]));
          histogram = Array.from({ length: buckets }, (_, index) => {
            const low = stats.min! + width * index;
            const high = index === buckets - 1 ? stats.max! : stats.min! + width * (index + 1);
            return { label: `${profileRound(low)}–${profileRound(high)}`, count: byBucket.get(index) ?? 0 };
          });
        }
        const variance = Math.max(0, (stats.mean_square ?? 0) - stats.mean * stats.mean);
        number = {
          count: stats.count, min: profileRound(stats.min), max: profileRound(stats.max),
          mean: profileRound(stats.mean), median: profileRound(stats.median), sum: profileRound(stats.sum),
          stdev: profileRound(Math.sqrt(variance)), histogram,
        };
      }
      profiles.push({ ...base, filled: stats.count, fillRate: rowCount ? stats.count / rowCount : 0, number });
      continue;
    }
    if (valueType === 'select' || valueType === 'multi_select') {
      const multi = valueType === 'multi_select';
      const counts = multi
        ? db.prepare(
          `SELECT CAST(item.value AS TEXT) AS id, COUNT(*) AS count
           FROM db_cells cell, json_each(CASE WHEN json_valid(COALESCE(cell.value_json, cell.value_text))
             THEN COALESCE(cell.value_json, cell.value_text) ELSE '[]' END) item
           WHERE cell.database_id = ? AND cell.column_id = ? GROUP BY item.value`,
        ).all(databaseId, column.id) as Array<{ id: string; count: number }>
        : db.prepare(
          `SELECT COALESCE(value_reference, value_text) AS id, COUNT(*) AS count
           FROM db_cells WHERE database_id = ? AND column_id = ?
             AND COALESCE(value_reference, value_text, '') <> '' GROUP BY id`,
        ).all(databaseId, column.id) as Array<{ id: string; count: number }>;
      const byId = new Map(counts.map((entry) => [entry.id, entry.count]));
      const distribution: DistributionSlice[] = column.options.map((option) => ({
        id: option.id, label: option.label, color: option.color, count: byId.get(option.id) ?? 0,
      })).filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count);
      const filled = multi
        ? Number((db.prepare(
          `SELECT COUNT(*) AS count FROM db_cells WHERE database_id = ? AND column_id = ?
           AND json_valid(COALESCE(value_json, value_text)) AND json_array_length(COALESCE(value_json, value_text)) > 0`,
        ).get(databaseId, column.id) as { count: number }).count)
        : counts.reduce((sum, entry) => sum + entry.count, 0);
      profiles.push({ ...base, filled, fillRate: rowCount ? filled / rowCount : 0, distinct: distribution.length, distribution });
      continue;
    }
    if (valueType === 'checkbox') {
      const checked = Number((db.prepare(
        `SELECT COUNT(*) AS count FROM db_cells WHERE database_id = ? AND column_id = ?
         AND COALESCE(value_integer, CAST(value_text AS INTEGER), 0) = 1`,
      ).get(databaseId, column.id) as { count: number }).count);
      profiles.push({ ...base, filled: rowCount, fillRate: 1, checkbox: { checked, unchecked: rowCount - checked } });
      continue;
    }
    if (valueType === 'date' || valueType === 'time') {
      const range = db.prepare(
        `SELECT COUNT(*) AS filled, MIN(COALESCE(value_date, value_text)) AS min,
                MAX(COALESCE(value_date, value_text)) AS max
         FROM ${table} WHERE database_id = ? AND column_id = ?
           AND COALESCE(value_date, value_text, '') <> ''`,
      ).get(databaseId, column.id) as { filled: number; min: string | null; max: string | null };
      profiles.push({ ...base, filled: range.filled, fillRate: rowCount ? range.filled / rowCount : 0,
        dateRange: range.min && range.max ? { min: range.min, max: range.max } : undefined });
      continue;
    }
    if (valueType === 'attachment') {
      const result = db.prepare(
        `SELECT COUNT(DISTINCT row_id) AS filled FROM db_attachments WHERE database_id = ? AND column_id = ?`,
      ).get(databaseId, column.id) as { filled: number };
      profiles.push({ ...base, filled: result.filled, fillRate: rowCount ? result.filled / rowCount : 0 });
      continue;
    }
    if (valueType === 'relation') {
      const result = db.prepare(
        `SELECT COUNT(DISTINCT row_id) AS filled, COUNT(*) AS links
         FROM db_relations WHERE database_id = ? AND column_id = ?`,
      ).get(databaseId, column.id) as { filled: number; links: number };
      profiles.push({ ...base, filled: result.filled, fillRate: rowCount ? result.filled / rowCount : 0, relationLinks: result.links });
      continue;
    }
    const result = db.prepare(
      `SELECT COUNT(*) AS filled, COUNT(DISTINCT value_text) AS distinct_count
       FROM ${table} WHERE database_id = ? AND column_id = ? AND TRIM(COALESCE(value_text, '')) <> ''`,
    ).get(databaseId, column.id) as { filled: number; distinct_count: number };
    profiles.push({ ...base, filled: result.filled, fillRate: rowCount ? result.filled / rowCount : 0, distinct: result.distinct_count });
  }
  return { rowCount, columns: profiles };
}

/** The deterministic profile for a database (fill rates, numeric summaries, distributions). */
export function getDatabaseProfile(databaseId: string): DatabaseProfileResult | null {
  const database = getDatabase(databaseId);
  if (!database) return null;
  const columns = getColumns(databaseId);
  if (columns.some((column) => column.type === 'formula' || column.type === 'rollup')) {
    queryDatabaseRows({ databaseId, limit: 1 });
  }
  return { databaseName: database.name, profile: computeDatabaseProfileSql(databaseId, columns) };
}

const ANALYSIS_SYSTEM = `Eres un analista de datos. Recibes el PERFIL ESTADÍSTICO de una base de datos (ya calculado: recuentos, medias, distribuciones). Escribe un informe breve y claro en Markdown que: (1) resuma el tamaño y la completitud de los datos, (2) destaque los patrones y valores atípicos que se deduzcan de las cifras, (3) señale posibles problemas de calidad (columnas poco rellenas, valores dominantes). Usa ÚNICAMENTE las cifras del perfil; no inventes datos ni cifras que no aparezcan. Sé conciso.`;
const ANALYSIS_SYSTEM_I18N = {
  es: ANALYSIS_SYSTEM,
  en: 'You are a data analyst. You receive the STATISTICAL PROFILE of a database (already calculated: counts, averages, distributions). Write a brief, clear Markdown report that: (1) summarizes data size and completeness, (2) highlights patterns and outliers that follow from the figures, and (3) points out possible quality issues (sparsely populated columns, dominant values). Use ONLY figures in the profile; do not invent data or figures that do not appear. Be concise.',
  fr: 'Vous êtes analyste de données. Vous recevez le PROFIL STATISTIQUE d’une base de données (déjà calculé : décomptes, moyennes, distributions). Rédigez un rapport Markdown bref et clair qui : (1) résume le volume et la complétude des données, (2) met en évidence les tendances et valeurs atypiques déductibles des chiffres, et (3) signale d’éventuels problèmes de qualité (colonnes peu renseignées, valeurs dominantes). Utilisez UNIQUEMENT les chiffres du profil ; n’inventez ni données ni chiffres absents. Soyez concis.',
  de: 'Du bist Datenanalyst. Du erhältst das STATISTISCHE PROFIL einer Datenbank (bereits berechnet: Anzahlen, Mittelwerte, Verteilungen). Verfasse einen kurzen, klaren Markdown-Bericht, der (1) Umfang und Vollständigkeit der Daten zusammenfasst, (2) aus den Zahlen ableitbare Muster und Ausreißer hervorhebt und (3) mögliche Qualitätsprobleme benennt (schwach befüllte Spalten, dominierende Werte). Verwende AUSSCHLIESSLICH Zahlen aus dem Profil; erfinde keine Daten oder nicht vorhandenen Zahlen. Sei knapp.',
  pt: 'És analista de dados. Recebes o PERFIL ESTATÍSTICO de uma base de dados (já calculado: contagens, médias, distribuições). Redige um relatório Markdown breve e claro que: (1) resuma a dimensão e a completude dos dados, (2) destaque padrões e valores atípicos dedutíveis dos números e (3) assinale possíveis problemas de qualidade (colunas pouco preenchidas, valores dominantes). Usa APENAS os números do perfil; não inventes dados nem números ausentes. Sê conciso.',
  'pt-BR': 'Você é analista de dados. Recebe o PERFIL ESTATÍSTICO de um banco de dados (já calculado: contagens, médias, distribuições). Escreva um relatório Markdown breve e claro que: (1) resuma o tamanho e a completude dos dados, (2) destaque padrões e valores atípicos dedutíveis dos números e (3) indique possíveis problemas de qualidade (colunas pouco preenchidas, valores dominantes). Use SOMENTE os números do perfil; não invente dados nem números ausentes. Seja conciso.',
  it: 'Sei un analista di dati. Ricevi il PROFILO STATISTICO di un database (già calcolato: conteggi, medie, distribuzioni). Scrivi un rapporto Markdown breve e chiaro che: (1) riassuma dimensione e completezza dei dati, (2) evidenzi schemi e valori anomali deducibili dalle cifre e (3) segnali possibili problemi di qualità (colonne poco compilate, valori dominanti). Usa ESCLUSIVAMENTE le cifre del profilo; non inventare dati o cifre assenti. Sii conciso.',
  tr: 'Bir veri analistisin. Bir veritabanının İSTATİSTİKSEL PROFİLİNİ alırsın (sayımlar, ortalamalar ve dağılımlar önceden hesaplanmıştır). Şunları yapan kısa ve anlaşılır bir Markdown raporu yaz: (1) verinin boyutunu ve doluluk düzeyini özetle, (2) sayılardan çıkarılabilen örüntüleri ve aykırı değerleri vurgula, (3) olası kalite sorunlarını belirt (az doldurulmuş sütunlar, baskın değerler). YALNIZCA profildeki sayıları kullan; görünmeyen veri veya sayı uydurma. Kısa ol.',
  'zh-Hans': '你是一位数据分析师。你会收到一份数据库的统计概况（已计算完成：计数、均值、分布）。请用 Markdown 撰写一份简洁清晰的报告，内容包括：(1) 概述数据规模与完整度；(2) 突出可从数字中看出的模式与异常值；(3) 指出可能的数据质量问题（填充率低的列、占主导的值）。只使用概况中给出的数字；不要编造未出现的数据或数字。要简明扼要。',
  'zh-Hant': '你是一位資料分析師。你會收到一份資料庫的統計概況（已計算完成：計數、平均值、分布）。請以 Markdown 撰寫一份簡潔清晰的報告，內容包括：(1) 概述資料規模與完整度；(2) 凸顯可從數字中看出的模式與離群值；(3) 指出可能的資料品質問題（填寫率低的欄位、佔主導的值）。只使用概況中提供的數字；不要編造未出現的資料或數字。務求簡潔。',
  vi: 'Bạn là một chuyên gia phân tích dữ liệu. Bạn nhận được HỒ SƠ THỐNG KÊ của một cơ sở dữ liệu (đã được tính toán sẵn: số đếm, trung bình, phân bố). Hãy viết một báo cáo Markdown ngắn gọn, rõ ràng, gồm: (1) tóm tắt quy mô và mức độ đầy đủ của dữ liệu, (2) làm nổi bật các xu hướng và giá trị bất thường rút ra từ các con số, và (3) chỉ ra những vấn đề chất lượng có thể có (cột ít được điền, giá trị chiếm ưu thế). Chỉ sử dụng các con số trong hồ sơ; không được bịa ra dữ liệu hay con số không xuất hiện. Hãy viết súc tích.',
  ja: 'あなたはデータアナリストです。データベースの統計プロファイル（すでに計算済み：件数、平均、分布）を受け取ります。次の内容を含む簡潔で明確なMarkdownレポートを作成してください：(1) データの規模と完全性の要約、(2) 数値から読み取れるパターンと外れ値の指摘、(3) 考えられる品質上の問題（入力の少ない列、支配的な値）の指摘。プロファイルに記載された数値のみを使用し、存在しないデータや数値を捏造しないでください。簡潔にしてください。',
  ru: 'Вы аналитик данных. Вы получаете СТАТИСТИЧЕСКИЙ ПРОФИЛЬ базы данных (уже рассчитанный: количества, средние, распределения). Составьте краткий и ясный отчёт в формате Markdown, который: (1) резюмирует объём и полноту данных, (2) выделяет закономерности и выбросы, следующие из чисел, и (3) указывает на возможные проблемы качества (слабо заполненные столбцы, доминирующие значения). Используйте ТОЛЬКО числа из профиля; не выдумывайте отсутствующие данные или числа. Будьте кратки.',
  uk: 'Ви аналітик даних. Ви отримуєте СТАТИСТИЧНИЙ ПРОФІЛЬ бази даних (уже обчислений: кількості, середні, розподіли). Складіть короткий і чіткий звіт у форматі Markdown, який: (1) підсумовує обсяг і повноту даних, (2) висвітлює закономірності та викиди, що випливають із чисел, і (3) вказує на можливі проблеми якості (слабо заповнені стовпці, домінантні значення). Використовуйте ТІЛЬКИ числа з профілю; не вигадуйте дані чи числа, яких немає. Будьте стислі.',
  ko: '귀하는 데이터 분석가입니다. 데이터베이스의 통계 프로필(이미 계산됨: 개수, 평균, 분포)을 받습니다. 다음 내용을 포함하는 간결하고 명확한 Markdown 보고서를 작성하십시오: (1) 데이터 규모와 완전성 요약, (2) 수치에서 도출되는 패턴과 이상값 강조, (3) 가능한 품질 문제(채워짐이 적은 열, 지배적인 값) 지적. 프로필에 있는 수치만 사용하고, 나타나지 않은 데이터나 수치는 만들어내지 마십시오. 간결하게 작성하십시오.',
} as const;
function localizedAnalysisSystem(language: string | undefined, purpose: 'report' | 'suggest' | 'narrate' = 'report'): string {
  const base = purpose === 'report' ? ANALYSIS_SYSTEM : purpose === 'suggest' ? SUGGEST_SYSTEM : NARRATE_SYSTEM;
  if (language === 'es') return base;
  const translated = purpose === 'report'
    ? ANALYSIS_SYSTEM_I18N[language as keyof typeof ANALYSIS_SYSTEM_I18N]
    : purpose === 'suggest'
      ? SUGGEST_SYSTEM_I18N[language ?? '']
      : NARRATE_SYSTEM_I18N[language ?? ''];
  const directives = {
    es: 'Escribe los campos de texto libre en español; conserva exactamente cada clave JSON, enumeración, id del catálogo y cifra proporcionada.',
    en: 'Write free-text fields in English; preserve every JSON key, enum, catalog id, and supplied figure exactly.',
    fr: 'Rédige les champs libres en français ; conserve exactement chaque clé JSON, énumération, identifiant du catalogue et chiffre fourni.',
    de: 'Schreibe freie Textfelder auf Deutsch; bewahre jeden JSON-Schlüssel, Enum-Wert, Katalogbezeichner und jede gelieferte Zahl exakt.',
    pt: 'Escreve os campos livres em português; conserva exatamente cada chave JSON, enumeração, id do catálogo e número fornecido.',
    'pt-BR': 'Escreva os campos livres em português brasileiro; preserve exatamente cada chave JSON, enum, id do catálogo e número fornecido.',
    it: 'Scrivi i campi liberi in italiano; conserva esattamente ogni chiave JSON, enumerazione, id del catalogo e numero fornito.',
    tr: 'Serbest metin alanlarını Türkçe yaz; tüm JSON anahtarlarını, enum değerlerini, katalog kimliklerini ve verilen sayıları aynen koru.',
    'zh-Hans': '自由文本字段请用简体中文书写；请准确保留每个 JSON 键、枚举值、目录 id 和提供的数字。',
    'zh-Hant': '自由文字欄位請以繁體中文撰寫；請準確保留每個 JSON 鍵、列舉值、目錄 id 和提供的數字。',
    vi: 'Viết các trường văn bản tự do bằng tiếng Việt; giữ nguyên chính xác mọi khóa JSON, giá trị enum, id danh mục và con số được cung cấp.',
    ja: '自由記述フィールドは日本語で記述し、すべてのJSONキー、enum値、カタログID、提供された数値を正確に保持してください。',
    ru: 'Записывайте поля свободного текста на русском языке; точно сохраняйте каждый ключ JSON, значение enum, идентификатор каталога и предоставленное число.',
    uk: 'Записуйте поля вільного тексту українською мовою; точно зберігайте кожен ключ JSON, значення enum, ідентифікатор каталогу та надане число.',
    ko: '자유 텍스트 필드는 한국어로 작성하고, 모든 JSON 키, enum 값, 카탈로그 id 및 제공된 수치를 정확히 보존하십시오.',
  } as const;
  return `${translated || base}\n\n${directives[(language as keyof typeof directives)] || directives.en}`;
}

function analysisScaffolding(language: string | undefined, kind: 'profile' | 'result' | 'report' | 'suggest' | 'narrate'): string {
  const labels = {
    es: { profile: '=== PERFIL DE DATOS ===', result: '=== RESULTADO ===', report: 'Escribe el informe.', suggest: 'Devuelve el array JSON de análisis sugeridos.', narrate: 'Explícalo.' },
    en: { profile: '=== DATA PROFILE ===', result: '=== RESULT ===', report: 'Write the report.', suggest: 'Return the JSON array of suggested analyses.', narrate: 'Explain it.' },
    fr: { profile: '=== PROFIL DES DONNÉES ===', result: '=== RÉSULTAT ===', report: 'Rédige le rapport.', suggest: 'Renvoie le tableau JSON des analyses proposées.', narrate: 'Explique-le.' },
    de: { profile: '=== DATENPROFIL ===', result: '=== ERGEBNIS ===', report: 'Verfasse den Bericht.', suggest: 'Gib das JSON-Array der vorgeschlagenen Analysen zurück.', narrate: 'Erkläre es.' },
    pt: { profile: '=== PERFIL DE DADOS ===', result: '=== RESULTADO ===', report: 'Redige o relatório.', suggest: 'Devolve o array JSON das análises sugeridas.', narrate: 'Explica-o.' },
    'pt-BR': { profile: '=== PERFIL DE DADOS ===', result: '=== RESULTADO ===', report: 'Escreva o relatório.', suggest: 'Retorne o array JSON das análises sugeridas.', narrate: 'Explique-o.' },
    it: { profile: '=== PROFILO DEI DATI ===', result: '=== RISULTATO ===', report: 'Scrivi il rapporto.', suggest: 'Restituisci l’array JSON delle analisi suggerite.', narrate: 'Spiegalo.' },
    tr: { profile: '=== VERİ PROFİLİ ===', result: '=== SONUÇ ===', report: 'Raporu yaz.', suggest: 'Önerilen analizlerin JSON dizisini döndür.', narrate: 'Açıkla.' },
    'zh-Hans': { profile: '=== 数据概况 ===', result: '=== 结果 ===', report: '撰写报告。', suggest: '返回建议分析的 JSON 数组。', narrate: '解释它。' },
    'zh-Hant': { profile: '=== 資料概況 ===', result: '=== 結果 ===', report: '撰寫報告。', suggest: '回傳建議分析的 JSON 陣列。', narrate: '解釋它。' },
    vi: { profile: '=== HỒ SƠ DỮ LIỆU ===', result: '=== KẾT QUẢ ===', report: 'Viết báo cáo.', suggest: 'Trả về mảng JSON các phân tích được đề xuất.', narrate: 'Giải thích kết quả.' },
    ja: { profile: '=== データプロファイル ===', result: '=== 結果 ===', report: 'レポートを作成してください。', suggest: '提案する分析のJSON配列を返してください。', narrate: '説明してください。' },
    ru: { profile: '=== ПРОФИЛЬ ДАННЫХ ===', result: '=== РЕЗУЛЬТАТ ===', report: 'Напишите отчёт.', suggest: 'Верните массив JSON предложенных анализов.', narrate: 'Объясните его.' },
    uk: { profile: '=== ПРОФІЛЬ ДАНИХ ===', result: '=== РЕЗУЛЬТАТ ===', report: 'Напишіть звіт.', suggest: 'Поверніть масив JSON запропонованих аналізів.', narrate: 'Поясніть його.' },
    ko: { profile: '=== 데이터 프로필 ===', result: '=== 결과 ===', report: '보고서를 작성하십시오.', suggest: '제안된 분석의 JSON 배열을 반환하십시오.', narrate: '설명하십시오.' },
  } as const;
  const selected = labels[(language as keyof typeof labels)] || labels.en;
  return selected[kind];
}

export interface AnalysisDeps {
  complete?: (opts: { system: string; user: string; plainContext?: boolean; temperature?: number; maxTokens?: number }, model?: ModelRef | null) => Promise<string>;
  model?: ModelRef | null;
}

export interface AnalysisReport {
  databaseName: string;
  profileText: string;
  report: string;
}

async function defaultComplete(opts: { system: string; user: string; plainContext?: boolean; temperature?: number; maxTokens?: number }, m?: ModelRef | null): Promise<string> {
  const { completeText } = await import('./aiClient');
  const { getSettings } = await import('../db/settingsRepo');
  const s = getSettings();
  return completeText(opts, m ?? s.chatModel ?? s.synthesisModel ?? null);
}

/** Generate the AI narrative report for a database over its statistical profile. */
export async function generateAnalysisReport(databaseId: string, deps: AnalysisDeps = {}): Promise<AnalysisReport> {
  const result = getDatabaseProfile(databaseId);
  if (!result) throw new Error('Base de datos no encontrada.');
  const language = getSettings().promptLanguage ?? 'es';
  const profileText = profileToText(result.databaseName, result.profile, language);
  const complete = deps.complete ?? defaultComplete;
  const report = await complete(
    { system: localizedAnalysisSystem(language), user: `${analysisScaffolding(language, 'profile')}\n${profileText}\n\n${analysisScaffolding(language, 'report')}`, plainContext: true, temperature: 0.3, maxTokens: 1200 },
    deps.model ?? null
  );
  return { databaseName: result.databaseName, profileText, report: report.trim() };
}

// ── suggest (AI plans) ────────────────────────────────────────────────────────

const SUGGEST_SYSTEM = `Eres un analista de datos experto. Recibes el PERFIL de una base de datos y el CATÁLOGO de análisis que la aplicación puede calcular (con los ids de columna válidos por rol). Tu tarea es PROPONER los análisis más reveladores, NO calcularlos.

Devuelve ÚNICAMENTE un array JSON (sin texto adicional, sin markdown) con entre 4 y 7 objetos, ordenados del más al menos interesante, con esta forma exacta:
[{"kind":"<uno del catálogo>","columns":["<id>","<id>"],"title":"<título corto y humano>","rationale":"<por qué es interesante, 1 frase>"}]

Reglas estrictas:
- Usa SOLO los ids de columna que aparecen en el catálogo, y respeta el rol de cada hueco (numeric/category/lowCard/date). En el catálogo, un rol con "+" admite VARIAS columnas y con "?" es opcional.
- Aprovecha la multi-selección cuando aporte: "descriptive" y "group_compare" y "time_series" pueden llevar varias numéricas; "correlation_matrix"/"covariance_matrix" con "columns":[] usan todas, o un subconjunto de ≥2.
- "chi_square"/"crosstab": dos categóricas distintas; "crosstab" admite una 3ª numérica opcional para agregar (media/suma).
- "data_quality" lleva "columns": [].
- Prioriza relaciones entre columnas (correlaciones, chi-cuadrado, tablas cruzadas, comparación de grupos) sobre resúmenes de una sola columna.
- No repitas el mismo análisis con las mismas columnas.
- title y rationale en el idioma del perfil (español).`;

// These are complete translations of SUGGEST_SYSTEM: the JSON contract, catalog
// identifiers and validation rules must never be shortened when changing locale.
const SUGGEST_SYSTEM_I18N: Record<string, string> = {
  es: SUGGEST_SYSTEM,
  en: `You are an expert data analyst. You receive a database PROFILE and the CATALOG of analyses the application can compute (with valid column ids for each role). Your task is to PROPOSE the most revealing analyses, NOT to calculate them.

Return ONLY a JSON array (no additional text, no markdown) containing 4 to 7 objects, ordered from most to least interesting, with this exact shape:
[{"kind":"<one catalog kind>","columns":["<id>","<id>"],"title":"<short human title>","rationale":"<why it is interesting, 1 sentence>"}]

Strict rules:
- Use ONLY column ids appearing in the catalog, and respect each slot's role (numeric/category/lowCard/date). In the catalog, a role with "+" accepts MULTIPLE columns and "?" is optional.
- Use multi-selection when useful: "descriptive", "group_compare", and "time_series" may contain multiple numeric columns; "correlation_matrix"/"covariance_matrix" with "columns":[] use all columns, or a subset of ≥2.
- "chi_square"/"crosstab": two different categorical columns; "crosstab" accepts an optional third numeric column for aggregation (mean/sum).
- "data_quality" uses "columns": [].
- Prioritize relationships between columns (correlations, chi-square, cross-tabs, group comparisons) over single-column summaries.
- Do not repeat the same analysis with the same columns.
- title and rationale in the profile's language (English).`,
  fr: `Tu es un analyste de données expert. Tu reçois le PROFIL d’une base de données et le CATALOGUE des analyses que l’application peut calculer (avec les identifiants de colonnes valides pour chaque rôle). Ta tâche est de PROPOSER les analyses les plus révélatrices, PAS de les calculer.

Renvoie UNIQUEMENT un tableau JSON (aucun texte supplémentaire, aucun markdown) contenant 4 à 7 objets, classés du plus au moins intéressant, avec cette forme exacte :
[{"kind":"<un type du catalogue>","columns":["<id>","<id>"],"title":"<titre court et humain>","rationale":"<pourquoi c’est intéressant, 1 phrase>"}]

Règles strictes :
- Utilise UNIQUEMENT les identifiants de colonnes présents dans le catalogue et respecte le rôle de chaque emplacement (numeric/category/lowCard/date). Dans le catalogue, un rôle avec « + » accepte PLUSIEURS colonnes et « ? » est facultatif.
- Utilise la sélection multiple lorsqu’elle est utile : « descriptive », « group_compare » et « time_series » peuvent contenir plusieurs colonnes numériques ; « correlation_matrix »/« covariance_matrix » avec "columns":[] utilisent toutes les colonnes, ou un sous-ensemble d’au moins 2.
- « chi_square »/« crosstab » : deux colonnes catégorielles distinctes ; « crosstab » accepte une troisième colonne numérique facultative pour agréger (moyenne/somme).
- « data_quality » utilise "columns": [].
- Donne la priorité aux relations entre colonnes (corrélations, chi carré, tableaux croisés, comparaisons de groupes) plutôt qu’aux résumés d’une seule colonne.
- Ne répète pas la même analyse avec les mêmes colonnes.
- title et rationale dans la langue du profil (français).`,
  de: `Du bist ein erfahrener Datenanalyst. Du erhältst das PROFIL einer Datenbank und den KATALOG der Analysen, die die Anwendung berechnen kann (mit gültigen Spalten-IDs je Rolle). Deine Aufgabe ist es, die aufschlussreichsten Analysen VORZUSCHLAGEN, NICHT sie zu berechnen.

Gib AUSSCHLIESSLICH ein JSON-Array (kein zusätzlicher Text, kein Markdown) mit 4 bis 7 Objekten zurück, geordnet vom interessantesten zum am wenigsten interessanten, exakt in dieser Form:
[{"kind":"<ein Katalogtyp>","columns":["<id>","<id>"],"title":"<kurzer, verständlicher Titel>","rationale":"<warum interessant, 1 Satz>"}]

Strenge Regeln:
- Verwende NUR Spalten-IDs aus dem Katalog und beachte die Rolle jedes Platzes (numeric/category/lowCard/date). Eine Rolle mit "+" erlaubt MEHRERE Spalten, "?" ist optional.
- Nutze Mehrfachauswahl, wenn sie sinnvoll ist: "descriptive", "group_compare" und "time_series" können mehrere numerische Spalten enthalten; "correlation_matrix"/"covariance_matrix" mit "columns":[] verwenden alle Spalten oder eine Teilmenge von mindestens 2.
- "chi_square"/"crosstab": zwei verschiedene kategoriale Spalten; "crosstab" akzeptiert optional eine dritte numerische Spalte zur Aggregation (Mittelwert/Summe).
- "data_quality" verwendet "columns": [].
- Bevorzuge Beziehungen zwischen Spalten (Korrelationen, Chi-Quadrat, Kreuztabellen, Gruppenvergleiche) gegenüber Zusammenfassungen einzelner Spalten.
- Wiederhole nicht dieselbe Analyse mit denselben Spalten.
- title und rationale in der Sprache des Profils (Deutsch).`,
  pt: `És um analista de dados experiente. Recebes o PERFIL de uma base de dados e o CATÁLOGO de análises que a aplicação consegue calcular (com ids de coluna válidos por função). A tua tarefa é PROPOR as análises mais reveladoras, NÃO calculá-las.

Devolve APENAS um array JSON (sem texto adicional, sem markdown) com 4 a 7 objetos, ordenados do mais para o menos interessante, com esta forma exata:
[{"kind":"<um tipo do catálogo>","columns":["<id>","<id>"],"title":"<título curto e humano>","rationale":"<por que é interessante, 1 frase>"}]

Regras estritas:
- Usa APENAS ids de coluna presentes no catálogo e respeita a função de cada posição (numeric/category/lowCard/date). No catálogo, uma função com "+" aceita VÁRIAS colunas e "?" é opcional.
- Usa a seleção múltipla quando for útil: "descriptive", "group_compare" e "time_series" podem conter várias colunas numéricas; "correlation_matrix"/"covariance_matrix" com "columns":[] usam todas as colunas ou um subconjunto de ≥2.
- "chi_square"/"crosstab": duas colunas categóricas diferentes; "crosstab" aceita uma terceira coluna numérica opcional para agregar (média/soma).
- "data_quality" usa "columns": [].
- Dá prioridade às relações entre colunas (correlações, qui-quadrado, tabelas cruzadas, comparação de grupos) em vez de resumos de uma coluna.
- Não repitas a mesma análise com as mesmas colunas.
- title e rationale na língua do perfil (português).`,
  'pt-BR': `Você é um analista de dados experiente. Recebe o PERFIL de um banco de dados e o CATÁLOGO de análises que o aplicativo pode calcular (com ids de coluna válidos por função). Sua tarefa é PROPOR as análises mais reveladoras, NÃO calculá-las.

Retorne SOMENTE um array JSON (sem texto adicional, sem markdown) com 4 a 7 objetos, ordenados do mais para o menos interessante, nesta forma exata:
[{"kind":"<um tipo do catálogo>","columns":["<id>","<id>"],"title":"<título curto e humano>","rationale":"<por que é interessante, 1 frase>"}]

Regras estritas:
- Use SOMENTE ids de coluna presentes no catálogo e respeite a função de cada espaço (numeric/category/lowCard/date). No catálogo, uma função com "+" aceita VÁRIAS colunas e "?" é opcional.
- Use a seleção múltipla quando for útil: "descriptive", "group_compare" e "time_series" podem conter várias colunas numéricas; "correlation_matrix"/"covariance_matrix" com "columns":[] usam todas as colunas ou um subconjunto de ≥2.
- "chi_square"/"crosstab": duas colunas categóricas diferentes; "crosstab" aceita uma terceira coluna numérica opcional para agregar (média/soma).
- "data_quality" usa "columns": [].
- Priorize relações entre colunas (correlações, qui-quadrado, tabelas cruzadas, comparação de grupos) em vez de resumos de uma única coluna.
- Não repita a mesma análise com as mesmas colunas.
- title e rationale no idioma do perfil (português brasileiro).`,
  it: `Sei un analista dei dati esperto. Ricevi il PROFILO di un database e il CATALOGO delle analisi che l’applicazione può calcolare (con id di colonna validi per ruolo). Il tuo compito è PROPORRE le analisi più rivelatrici, NON calcolarle.

Restituisci SOLO un array JSON (nessun testo aggiuntivo, nessun markdown) con 4-7 oggetti, ordinati dal più al meno interessante, in questa forma esatta:
[{"kind":"<un tipo del catalogo>","columns":["<id>","<id>"],"title":"<titolo breve e chiaro>","rationale":"<perché è interessante, 1 frase>"}]

Regole rigorose:
- Usa SOLO gli id di colonna presenti nel catalogo e rispetta il ruolo di ogni posizione (numeric/category/lowCard/date). Nel catalogo, un ruolo con "+" ammette PIÙ colonne e "?" è facoltativo.
- Usa la selezione multipla quando utile: "descriptive", "group_compare" e "time_series" possono contenere più colonne numeriche; "correlation_matrix"/"covariance_matrix" con "columns":[] usano tutte le colonne o un sottoinsieme di ≥2.
- "chi_square"/"crosstab": due colonne categoriali diverse; "crosstab" accetta una terza colonna numerica facoltativa per l’aggregazione (media/somma).
- "data_quality" usa "columns": [].
- Dai priorità alle relazioni tra colonne (correlazioni, chi-quadrato, tabelle incrociate, confronti tra gruppi) rispetto ai riepiloghi di una singola colonna.
- Non ripetere la stessa analisi con le stesse colonne.
- title e rationale nella lingua del profilo (italiano).`,
  tr: `Uzman bir veri analistisin. Bir veritabanının PROFİLİNİ ve uygulamanın hesaplayabildiği analizlerin KATALOĞUNU (her rol için geçerli sütun kimlikleriyle) alırsın. Görevin en açıklayıcı analizleri HESAPLAMAK DEĞİL, ÖNERMEKTİR.

Yalnızca 4-7 nesneden oluşan bir JSON dizisi döndür (ek metin veya markdown yok); nesneleri en ilginçten en az ilginçe sırala ve tam olarak şu biçimi kullan:
[{"kind":"<katalogdan bir tür>","columns":["<id>","<id>"],"title":"<kısa, anlaşılır başlık>","rationale":"<neden ilginç, 1 cümle>"}]

Kesin kurallar:
- YALNIZCA katalogda bulunan sütun kimliklerini kullan ve her yuvanın rolüne uy (numeric/category/lowCard/date). Katalogda "+" içeren rol BİRDEN ÇOK sütun, "?" ise isteğe bağlıdır.
- Yararlı olduğunda çoklu seçimi kullan: "descriptive", "group_compare" ve "time_series" birden çok sayısal sütun alabilir; "correlation_matrix"/"covariance_matrix" için "columns":[] tüm sütunları veya ≥2’lik bir alt kümeyi kullanır.
- "chi_square"/"crosstab": iki farklı kategorik sütun; "crosstab" toplulaştırma (ortalama/toplam) için isteğe bağlı üçüncü sayısal sütunu kabul eder.
- "data_quality" için "columns": [] kullan.
- Tek sütun özetleri yerine sütunlar arası ilişkileri (korelasyonlar, ki-kare, çapraz tablolar, grup karşılaştırmaları) önceliklendir.
- Aynı analizi aynı sütunlarla tekrarlama.
- title ve rationale profilin dilinde (Türkçe) olsun.`,
  'zh-Hans': `你是一位资深数据分析师。你会收到一份数据库概况（PROFILE）以及本应用可执行的分析目录（CATALOG，包含各角色可用的有效列 ID）。你的任务是提出最具洞察力的分析方案，而不是执行计算。

只返回一个 JSON 数组（不要附加任何文字，不要 Markdown），包含 4 到 7 个对象，按从最有趣到最不有趣排序，格式必须完全如下：
[{"kind":"<目录中的一种分析类型>","columns":["<id>","<id>"],"title":"<简短、自然的标题>","rationale":"<为何有趣，1 句话>"}]

严格规则：
- 只使用目录中出现的列 ID，并遵守每个槽位的角色（numeric/category/lowCard/date）。在目录中，带 "+" 的角色接受多列，带 "?" 的角色为可选。
- 在有帮助时使用多选："descriptive"、"group_compare" 和 "time_series" 可以包含多个数值列；"correlation_matrix"/"covariance_matrix" 搭配 "columns":[] 时使用全部列，或使用 ≥2 列的子集。
- "chi_square"/"crosstab"：两个不同的分类列；"crosstab" 接受一个可选的第三数值列用于聚合（mean/sum）。
- "data_quality" 使用 "columns": []。
- 优先考虑列与列之间的关系（相关性、卡方、交叉表、组间比较），而非单列汇总。
- 不要用相同的列重复同一个分析。
- title 和 rationale 使用概况所用的语言（简体中文）。`,
  'zh-Hant': `你是一位資深資料分析師。你會收到一份資料庫概況（PROFILE）以及本應用程式可計算的分析目錄（CATALOG，包含各角色可用的有效欄位 ID）。你的任務是提出最具洞察力的分析，而不是計算它們。

只回傳一個 JSON 陣列（不要附加任何文字，不要 Markdown），包含 4 到 7 個物件，並依從最有趣到最不有趣排序，格式必須完全如下：
[{"kind":"<目錄中的一種分析類型>","columns":["<id>","<id>"],"title":"<簡短、自然的標題>","rationale":"<為何有趣，1 句話>"}]

嚴格規則：
- 只使用目錄中出現的欄位 ID，並遵守每個位置的角色（numeric/category/lowCard/date）。在目錄中，帶 "+" 的角色接受多個欄位，帶 "?" 的角色為選用。
- 在有幫助時使用多選："descriptive"、"group_compare" 和 "time_series" 可以包含多個數值欄位；"correlation_matrix"/"covariance_matrix" 搭配 "columns":[] 時使用全部欄位，或使用 ≥2 個欄位的子集。
- "chi_square"/"crosstab"：兩個不同的類別欄位；"crosstab" 接受一個選用的第三個數值欄位進行聚合（mean/sum）。
- "data_quality" 使用 "columns": []。
- 優先考慮欄位之間的關係（相關性、卡方檢定、交叉表、組間比較），而非單一欄位的摘要。
- 不要以相同的欄位重複同一個分析。
- title 和 rationale 使用概況所用的語言（繁體中文）。`,
  vi: `Bạn là một chuyên gia phân tích dữ liệu. Bạn nhận được HỒ SƠ (PROFILE) của một cơ sở dữ liệu và DANH MỤC (CATALOG) các phân tích mà ứng dụng có thể tính toán (kèm id cột hợp lệ cho từng vai trò). Nhiệm vụ của bạn là ĐỀ XUẤT những phân tích có giá trị khám phá cao nhất, KHÔNG phải tính toán chúng.

Chỉ trả về một mảng JSON (không thêm văn bản, không markdown) gồm 4 đến 7 đối tượng, sắp xếp từ thú vị nhất đến ít thú vị nhất, với đúng dạng sau:
[{"kind":"<một loại trong danh mục>","columns":["<id>","<id>"],"title":"<tiêu đề ngắn gọn, tự nhiên>","rationale":"<vì sao đáng quan tâm, 1 câu>"}]

Quy tắc nghiêm ngặt:
- Chỉ dùng các id cột có trong danh mục và tôn trọng vai trò của từng vị trí (numeric/category/lowCard/date). Trong danh mục, vai trò có "+" chấp nhận NHIỀU cột và "?" là tùy chọn.
- Dùng chọn nhiều khi hữu ích: "descriptive", "group_compare" và "time_series" có thể chứa nhiều cột số; "correlation_matrix"/"covariance_matrix" với "columns":[] dùng tất cả các cột, hoặc một tập con ≥2.
- "chi_square"/"crosstab": hai cột phân loại khác nhau; "crosstab" chấp nhận một cột số thứ ba tùy chọn để tổng hợp (mean/sum).
- "data_quality" dùng "columns": [].
- Ưu tiên các mối quan hệ giữa các cột (tương quan, chi bình phương, bảng chéo, so sánh nhóm) hơn là tóm tắt một cột.
- Không lặp lại cùng một phân tích với cùng các cột.
- title và rationale bằng ngôn ngữ của hồ sơ (tiếng Việt).`,
  ja: `あなたは熟練したデータアナリストです。データベースのPROFILEと、アプリケーションが計算できる分析のCATALOG（各ロールで有効な列ID付き）を受け取ります。あなたの任務は、最も示唆に富む分析を提案することであり、計算することではありません。

追加のテキストやMarkdownを含めず、JSON配列のみを返してください。4-7個のオブジェクトを含み、最も興味深いものから順に並べ、次の形式に厳密に従ってください：
[{"kind":"<カタログの種類>","columns":["<id>","<id>"],"title":"<短く自然なタイトル>","rationale":"<なぜ興味深いか、1文>"}]

厳格なルール：
- カタログに存在する列IDのみを使用し、各スロットのロール（numeric/category/lowCard/date）を守ってください。カタログでは、「+」の付いたロールは複数の列を受け付け、「?」は省略可能です。
- 有用な場合は複数選択を使用してください："descriptive"、"group_compare"、"time_series" は複数の数値列を含めることができます；"correlation_matrix"/"covariance_matrix" を "columns":[] で使うと全列、または ≥2 の部分集合を使用します。
- "chi_square"/"crosstab"：異なる2つのカテゴリ列；"crosstab" は集計（mean/sum）用に省略可能な3つ目の数値列を受け付けます。
- "data_quality" は "columns": [] を使用します。
- 単一列の要約よりも、列間の関係（相関、カイ二乗、クロス集計、グループ比較）を優先してください。
- 同じ列で同じ分析を繰り返さないでください。
- title と rationale はプロファイルの言語（日本語）で記述してください。`,
  ru: `Вы опытный аналитик данных. Вы получаете ПРОФИЛЬ (PROFILE) базы данных и КАТАЛОГ (CATALOG) анализов, которые приложение может вычислить (с допустимыми идентификаторами столбцов для каждой роли). Ваша задача — ПРЕДЛОЖИТЬ наиболее показательные анализы, а НЕ вычислять их.

Верните ТОЛЬКО массив JSON (без дополнительного текста и без markdown), содержащий от 4 до 7 объектов, упорядоченных от самого интересного к наименее интересному, строго следующей формы:
[{"kind":"<один тип из каталога>","columns":["<id>","<id>"],"title":"<краткий понятный заголовок>","rationale":"<почему это интересно, 1 предложение>"}]

Строгие правила:
- Используйте ТОЛЬКО идентификаторы столбцов, присутствующие в каталоге, и соблюдайте роль каждого слота (numeric/category/lowCard/date). В каталоге роль со знаком «+» допускает НЕСКОЛЬКО столбцов, а «?» означает необязательность.
- Используйте множественный выбор, когда это полезно: "descriptive", "group_compare" и "time_series" могут содержать несколько числовых столбцов; "correlation_matrix"/"covariance_matrix" с "columns":[] используют все столбцы или подмножество из ≥2.
- "chi_square"/"crosstab": два разных категориальных столбца; "crosstab" принимает необязательный третий числовой столбец для агрегирования (mean/sum).
- "data_quality" использует "columns": [].
- Отдавайте приоритет связям между столбцами (корреляции, хи-квадрат, таблицы сопряжённости, сравнения групп), а не сводкам по одному столбцу.
- Не повторяйте один и тот же анализ с одними и теми же столбцами.
- title и rationale — на языке профиля (русский).`,
  uk: `Ви досвідчений аналітик даних. Ви отримуєте ПРОФІЛЬ (PROFILE) бази даних і КАТАЛОГ (CATALOG) аналізів, які застосунок може обчислити (з дійсними ідентифікаторами стовпців для кожної ролі). Ваше завдання — ЗАПРОПОНУВАТИ найпоказовіші аналізи, а НЕ обчислювати їх.

Поверніть ТІЛЬКИ масив JSON (без додаткового тексту й без markdown), що містить від 4 до 7 об'єктів, упорядкованих від найцікавішого до найменш цікавого, точно такої форми:
[{"kind":"<один тип із каталогу>","columns":["<id>","<id>"],"title":"<короткий зрозумілий заголовок>","rationale":"<чому це цікаво, 1 речення>"}]

Суворі правила:
- Використовуйте ТІЛЬКИ ідентифікатори стовпців, наявні в каталозі, і дотримуйтеся ролі кожного слота (numeric/category/lowCard/date). У каталозі роль зі знаком «+» допускає КІЛЬКА стовпців, а «?» означає необов'язковість.
- Використовуйте множинний вибір, коли це корисно: "descriptive", "group_compare" і "time_series" можуть містити кілька числових стовпців; "correlation_matrix"/"covariance_matrix" з "columns":[] використовують усі стовпці або підмножину з ≥2.
- "chi_square"/"crosstab": два різні категоріальні стовпці; "crosstab" приймає необов'язковий третій числовий стовпець для агрегування (mean/sum).
- "data_quality" використовує "columns": [].
- Надавайте перевагу зв'язкам між стовпцями (кореляції, хі-квадрат, таблиці спряженості, порівняння груп), а не зведенням за одним стовпцем.
- Не повторюйте той самий аналіз з тими самими стовпцями.
- title і rationale — мовою профілю (українська).`,
  ko: `귀하는 숙련된 데이터 분석가입니다. 데이터베이스의 PROFILE과 애플리케이션이 계산할 수 있는 분석 CATALOG(각 역할에 유효한 열 ID 포함)를 받습니다. 귀하의 임무는 가장 통찰력 있는 분석을 제안하는 것이지, 계산하는 것이 아닙니다.

추가 텍스트나 Markdown 없이 JSON 배열만 반환하십시오. 4~7개의 객체를 포함하고 가장 흥미로운 것부터 순서대로 정렬하며 다음 형식을 정확히 따르십시오:
[{"kind":"<카탈로그의 한 종류>","columns":["<id>","<id>"],"title":"<짧고 자연스러운 제목>","rationale":"<왜 흥미로운지, 1문장>"}]

엄격한 규칙:
- 카탈로그에 있는 열 ID만 사용하고 각 슬롯의 역할(numeric/category/lowCard/date)을 준수하십시오. 카탈로그에서 "+"가 붙은 역할은 여러 열을 받아들이고 "?"는 선택 사항입니다.
- 유용할 때 다중 선택을 사용하십시오: "descriptive", "group_compare", "time_series"는 여러 수치 열을 포함할 수 있습니다; "correlation_matrix"/"covariance_matrix"를 "columns":[]와 함께 사용하면 모든 열을, 또는 ≥2개의 부분집합을 사용합니다.
- "chi_square"/"crosstab": 서로 다른 두 범주형 열; "crosstab"은 집계(mean/sum)를 위한 선택적 세 번째 수치 열을 받아들입니다.
- "data_quality"는 "columns": []를 사용합니다.
- 단일 열 요약보다 열 간의 관계(상관, 카이제곱, 교차표, 그룹 비교)를 우선하십시오.
- 같은 열로 같은 분석을 반복하지 마십시오.
- title과 rationale은 프로파일의 언어(한국어)로 작성하십시오.`,
};

export interface SuggestionResult {
  databaseName: string;
  suggestions: AnalysisSuggestion[];
}

/** Ask the AI to plan the most insightful analyses; validate each against the schema. */
export async function suggestDatabaseAnalyses(databaseId: string, deps: AnalysisDeps = {}): Promise<SuggestionResult> {
  const result = getDatabaseProfile(databaseId);
  if (!result) throw new Error('Base de datos no encontrada.');
  const profile = result.profile;
  const language = getSettings().promptLanguage ?? 'es';
  const manifest = catalogManifest(profile, language);
  const profileText = profileToText(result.databaseName, profile, language);
  const complete = deps.complete ?? defaultComplete;

  const reply = await complete(
    { system: localizedAnalysisSystem(language, 'suggest'), user: `${analysisScaffolding(language, 'profile')}\n${profileText}\n\n${manifest}\n\n${analysisScaffolding(language, 'suggest')}`, plainContext: true, temperature: 0.4, maxTokens: 900 },
    deps.model ?? null
  );

  const parsed = parseAnalysisSuggestions(reply);
  const suggestions: AnalysisSuggestion[] = [];
  const seen = new Set<string>();
  for (const s of parsed) {
    const v = validateRequest({ kind: s.kind, columns: s.columns, options: s.options }, profile);
    if (!v.ok || !v.normalized) continue;
    const key = `${v.normalized.kind}:${v.normalized.columns.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ ...v.normalized, title: s.title, rationale: s.rationale });
  }

  // Fallback: if the model produced nothing usable, seed with deterministic defaults.
  if (suggestions.length === 0) {
    for (const req of applicableAnalyses(profile)) {
      const v = validateRequest(req, profile);
      if (v.ok && v.normalized) suggestions.push({ ...v.normalized, title: kindMeta(req.kind).label, rationale: '' });
    }
  }
  return { databaseName: result.databaseName, suggestions };
}

// ── run (engine computes) ──────────────────────────────────────────────────────

const MAX_SCATTER_POINTS = 600;

/**
 * Thin a scatter down to a drawable number of dots by walking the whole set at an even
 * stride, rather than taking the first N. The statistics always run on every pair — this only
 * decides which dots get drawn — but taking a prefix samples whatever the rows happen to be
 * ordered by (in a photo catalogue, the earliest folders), so the cloud would misrepresent a
 * range the caption still reports in full. An even stride keeps the picture honest.
 */
function scatterSample(pairs: [number, number][]): [number, number][] {
  if (pairs.length <= MAX_SCATTER_POINTS) return pairs;
  const stride = pairs.length / MAX_SCATTER_POINTS;
  const out: [number, number][] = [];
  for (let i = 0; i < MAX_SCATTER_POINTS; i++) out.push(pairs[Math.floor(i * stride)]);
  return out;
}

function histogram(values: number[], buckets = 10): { label: string; count: number }[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: String(round(min, 2)), count: values.length }];
  const k = Math.min(buckets, Math.max(1, values.length));
  const width = (max - min) / k;
  const counts = new Array(k).fill(0);
  for (const v of values) {
    let idx = Math.floor((v - min) / width);
    if (idx >= k) idx = k - 1;
    counts[idx]++;
  }
  return counts.map((count, i) => {
    const lo = min + width * i;
    const hi = i === k - 1 ? max : min + width * (i + 1);
    return { label: `${round(lo, 2)}–${round(hi, 2)}`, count };
  });
}

function nonNull(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v != null && Number.isFinite(v));
}

/** Compute one analysis from the columns + rows. Pure (no DB access) → unit-testable. */
export function computeAnalysis(columns: DatabaseColumn[], rows: DatabaseRow[], request: AnalysisRequest): AnalysisResult {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const col = (id: string): DatabaseColumn => {
    const c = byId.get(id);
    if (!c) throw new Error(`Columna inexistente: ${id}`);
    return c;
  };

  const groups = assignColumns(request.kind, request.columns).assigned;
  /** Numeric columns to use for a matrix: the explicit subset, or all numeric when empty. */
  const matrixSeries = (ids: string[]) => {
    const cols = ids.length ? ids.map(col) : columns.filter((c) => c.type === 'number' || c.type === 'relation');
    return cols.map((c) => ({ key: c.id, label: c.name, values: numericValues(c, rows) }));
  };

  switch (request.kind) {
    case 'descriptive': {
      const out: DescriptiveColumn[] = [];
      for (const id of groups[0]) {
        const c = col(id);
        const values = nonNull(numericValues(c, rows));
        if (!values.length) continue;
        out.push({ column: c.id, columnName: c.name, stats: describe(values), boxplot: boxplot(values), histogram: histogram(values) });
      }
      if (!out.length) throw new Error('Ninguna columna elegida tiene valores numéricos.');
      return { kind: 'descriptive', columns: out };
    }
    case 'correlation': {
      const cx = col(request.columns[0]);
      const cy = col(request.columns[1]);
      const pairs = finitePairs(numericValues(cx, rows), numericValues(cy, rows));
      const points: ScatterPoint[] = scatterSample(pairs).map(([x, y]) => ({ x: round(x, 4), y: round(y, 4) }));
      return { kind: 'correlation', xColumn: cx.id, yColumn: cy.id, xName: cx.name, yName: cy.name, pearson: pearson(pairs), spearman: spearman(pairs), regression: linearRegression(pairs), points };
    }
    case 'correlation_matrix':
      return { kind: 'correlation_matrix', matrix: correlationMatrix(matrixSeries(groups[0])) };
    case 'covariance_matrix':
      return { kind: 'covariance_matrix', matrix: covarianceMatrix(matrixSeries(groups[0])) };
    case 'chi_square': {
      const cr = col(request.columns[0]);
      const cc = col(request.columns[1]);
      const table = contingencyTable(categoryValues(cr, rows), categoryValues(cc, rows));
      return { kind: 'chi_square', rowColumn: cr.id, colColumn: cc.id, rowName: cr.name, colName: cc.name, result: chiSquare(table) };
    }
    case 'crosstab': {
      const cr = col(groups[0][0]);
      const cc = col(groups[1][0]);
      const cv = groups[2][0] ? col(groups[2][0]) : null;
      const aggregate = request.options?.aggregate ?? (cv ? 'mean' : 'count');
      const ct = crosstab(categoryValues(cr, rows), categoryValues(cc, rows), cv ? numericValues(cv, rows) : null, aggregate);
      return { kind: 'crosstab', rowColumn: cr.id, colColumn: cc.id, valueColumn: cv?.id ?? null, rowName: cr.name, colName: cc.name, valueName: cv?.name ?? null, aggregate, rowLabels: ct.rowLabels, colLabels: ct.colLabels, values: ct.values, rowTotals: ct.rowTotals, colTotals: ct.colTotals, total: ct.total };
    }
    case 'group_compare': {
      const cg = col(groups[0][0]);
      const cats = categoryValues(cg, rows);
      const metrics: GroupMetric[] = [];
      for (const id of groups[1]) {
        const cv = col(id);
        const vals = numericValues(cv, rows);
        const result = groupBy(cats, vals);
        const byLabel = new Map<string, number[]>();
        for (let i = 0; i < rows.length; i++) {
          const label = cats[i];
          const v = vals[i];
          if (label == null || v == null || !Number.isFinite(v)) continue;
          if (!byLabel.has(label)) byLabel.set(label, []);
          byLabel.get(label)!.push(v);
        }
        const boxplots = result.groups.map((g) => ({ label: g.label, box: boxplot(byLabel.get(g.label) ?? []) }));
        metrics.push({ valueColumn: cv.id, valueName: cv.name, result, boxplots });
      }
      return { kind: 'group_compare', groupColumn: cg.id, groupName: cg.name, metrics };
    }
    case 'top_values': {
      const c = col(request.columns[0]);
      const freq = frequencies(categoryValuesMulti(c, rows), request.options?.topN ?? 15);
      return { kind: 'top_values', column: c.id, columnName: c.name, items: freq.items, distinct: freq.distinct, total: freq.total };
    }
    case 'time_series': {
      const cd = col(groups[0][0]);
      const bucket = request.options?.bucket ?? 'month';
      const valueIds = groups[1];
      const metric = request.options?.metric ?? (valueIds.length ? 'mean' : 'count');
      const dates = dateValues(cd, rows);
      const pick = (p: { count: number; sum: number; mean: number }) => (metric === 'count' ? p.count : metric === 'sum' ? p.sum : p.mean);
      let series: SeriesLine[];
      if (!valueIds.length) {
        series = [{ label: cd.name, points: timeSeries(dates, null, bucket).map((p) => ({ bucket: p.bucket, value: p.count })) }];
      } else {
        series = valueIds.map((id) => {
          const cv = col(id);
          return { label: cv.name, points: timeSeries(dates, numericValues(cv, rows), bucket).map((p) => ({ bucket: p.bucket, value: pick(p) })) };
        });
      }
      return { kind: 'time_series', dateColumn: cd.id, dateName: cd.name, metric, bucket, series };
    }
    case 'data_quality': {
      const profileById = new Map(computeProfile(columns, rows).columns.map((c) => [c.columnId, c]));
      const cols = columns.map((c) => {
        const p = profileById.get(c.id);
        const fillRate = p?.fillRate ?? 0;
        const distinct = p?.distinct ?? p?.distribution?.length ?? null;
        const issues: string[] = [];
        if (fillRate === 0) issues.push('Columna vacía');
        else if (fillRate < 0.5) issues.push('Muy incompleta');
        if (distinct != null && rows.length > 1) {
          if (distinct === 1) issues.push('Valor constante');
          else if (distinct === rows.length && (c.type === 'text' || c.type === 'title')) issues.push('Casi único (¿identificador?)');
        }
        return { column: c.id, name: c.name, type: c.type, filled: p?.filled ?? 0, fillRate, distinct, issues };
      });
      return { kind: 'data_quality', rowCount: rows.length, columns: cols };
    }
    default: {
      const _exhaustive: never = request.kind;
      throw new Error(`Análisis no soportado: ${_exhaustive}`);
    }
  }
}

export interface RunAnalysisResult {
  databaseName: string;
  request: AnalysisRequest;
  result: AnalysisResult;
}

interface AnalysisVectors {
  rowCount: number;
  numeric: Map<string, (number | null)[]>;
  category: Map<string, (string | null)[]>;
  multi: Map<string, (string | null)[]>;
  date: Map<string, (string | null)[]>;
}

/**
 * Scan the database in bounded pages and retain only the primitive vectors used by the
 * selected analysis. The hydrated 500-row page is discarded before requesting the next
 * one, so analyses never turn the complete table into DatabaseRow objects.
 */
function loadAnalysisVectors(databaseId: string, columns: DatabaseColumn[], request: AnalysisRequest): AnalysisVectors {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const groups = assignColumns(request.kind, request.columns).assigned;
  const numericIds = new Set<string>();
  const categoryIds = new Set<string>();
  const multiIds = new Set<string>();
  const dateIds = new Set<string>();
  switch (request.kind) {
    case 'descriptive':
      groups[0].forEach((id) => numericIds.add(id));
      break;
    case 'correlation':
      request.columns.forEach((id) => numericIds.add(id));
      break;
    case 'correlation_matrix':
    case 'covariance_matrix':
      (groups[0].length ? groups[0] : columns.filter((column) => column.type === 'number' || column.type === 'relation').map((column) => column.id))
        .forEach((id) => numericIds.add(id));
      break;
    case 'chi_square':
      request.columns.forEach((id) => categoryIds.add(id));
      break;
    case 'crosstab':
      groups[0].forEach((id) => categoryIds.add(id));
      groups[1].forEach((id) => categoryIds.add(id));
      groups[2].forEach((id) => numericIds.add(id));
      break;
    case 'group_compare':
      groups[0].forEach((id) => categoryIds.add(id));
      groups[1].forEach((id) => numericIds.add(id));
      break;
    case 'top_values':
      request.columns.forEach((id) => multiIds.add(id));
      break;
    case 'time_series':
      groups[0].forEach((id) => dateIds.add(id));
      groups[1].forEach((id) => numericIds.add(id));
      break;
    case 'data_quality':
      break;
  }
  const result: AnalysisVectors = {
    rowCount: 0,
    numeric: new Map([...numericIds].map((id) => [id, []])),
    category: new Map([...categoryIds].map((id) => [id, []])),
    multi: new Map([...multiIds].map((id) => [id, []])),
    date: new Map([...dateIds].map((id) => [id, []])),
  };
  let cursor: string | null = null;
  do {
    const page = queryDatabaseRows({ databaseId, cursor, limit: 500 });
    result.rowCount += page.rows.length;
    for (const id of numericIds) result.numeric.get(id)!.push(...numericValues(byId.get(id)!, page.rows));
    for (const id of categoryIds) result.category.get(id)!.push(...categoryValues(byId.get(id)!, page.rows));
    for (const id of multiIds) result.multi.get(id)!.push(...categoryValuesMulti(byId.get(id)!, page.rows));
    for (const id of dateIds) result.date.get(id)!.push(...dateValues(byId.get(id)!, page.rows));
    cursor = page.nextCursor;
  } while (cursor);
  return result;
}

function computeAnalysisFromVectors(
  columns: DatabaseColumn[],
  vectors: AnalysisVectors,
  profile: DatabaseProfile,
  request: AnalysisRequest,
): AnalysisResult {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const col = (id: string): DatabaseColumn => {
    const column = byId.get(id);
    if (!column) throw new Error(`Columna inexistente: ${id}`);
    return column;
  };
  const numbers = (id: string) => vectors.numeric.get(id) ?? [];
  const categories = (id: string) => vectors.category.get(id) ?? [];
  const groups = assignColumns(request.kind, request.columns).assigned;
  const matrixSeries = (ids: string[]) => {
    const selected = ids.length ? ids.map(col) : columns.filter((column) => column.type === 'number' || column.type === 'relation');
    return selected.map((column) => ({ key: column.id, label: column.name, values: numbers(column.id) }));
  };

  switch (request.kind) {
    case 'descriptive': {
      const out: DescriptiveColumn[] = [];
      for (const id of groups[0]) {
        const column = col(id);
        const values = nonNull(numbers(id));
        if (values.length) out.push({ column: id, columnName: column.name, stats: describe(values), boxplot: boxplot(values), histogram: histogram(values) });
      }
      if (!out.length) throw new Error('Ninguna columna elegida tiene valores numéricos.');
      return { kind: 'descriptive', columns: out };
    }
    case 'correlation': {
      const x = col(request.columns[0]);
      const y = col(request.columns[1]);
      const pairs = finitePairs(numbers(x.id), numbers(y.id));
      const points: ScatterPoint[] = scatterSample(pairs).map(([px, py]) => ({ x: round(px, 4), y: round(py, 4) }));
      return { kind: 'correlation', xColumn: x.id, yColumn: y.id, xName: x.name, yName: y.name, pearson: pearson(pairs), spearman: spearman(pairs), regression: linearRegression(pairs), points };
    }
    case 'correlation_matrix':
      return { kind: 'correlation_matrix', matrix: correlationMatrix(matrixSeries(groups[0])) };
    case 'covariance_matrix':
      return { kind: 'covariance_matrix', matrix: covarianceMatrix(matrixSeries(groups[0])) };
    case 'chi_square': {
      const row = col(request.columns[0]);
      const column = col(request.columns[1]);
      const table = contingencyTable(categories(row.id), categories(column.id));
      return { kind: 'chi_square', rowColumn: row.id, colColumn: column.id, rowName: row.name, colName: column.name, result: chiSquare(table) };
    }
    case 'crosstab': {
      const row = col(groups[0][0]);
      const column = col(groups[1][0]);
      const value = groups[2][0] ? col(groups[2][0]) : null;
      const aggregate = request.options?.aggregate ?? (value ? 'mean' : 'count');
      const table = crosstab(categories(row.id), categories(column.id), value ? numbers(value.id) : null, aggregate);
      return { kind: 'crosstab', rowColumn: row.id, colColumn: column.id, valueColumn: value?.id ?? null, rowName: row.name, colName: column.name, valueName: value?.name ?? null, aggregate, rowLabels: table.rowLabels, colLabels: table.colLabels, values: table.values, rowTotals: table.rowTotals, colTotals: table.colTotals, total: table.total };
    }
    case 'group_compare': {
      const groupColumn = col(groups[0][0]);
      const labels = categories(groupColumn.id);
      const metrics: GroupMetric[] = groups[1].map((id) => {
        const valueColumn = col(id);
        const values = numbers(id);
        const result = groupBy(labels, values);
        const byLabel = new Map<string, number[]>();
        for (let index = 0; index < labels.length; index += 1) {
          const label = labels[index];
          const value = values[index];
          if (label == null || value == null || !Number.isFinite(value)) continue;
          const items = byLabel.get(label) ?? [];
          items.push(value);
          byLabel.set(label, items);
        }
        return { valueColumn: id, valueName: valueColumn.name, result, boxplots: result.groups.map((group) => ({ label: group.label, box: boxplot(byLabel.get(group.label) ?? []) })) };
      });
      return { kind: 'group_compare', groupColumn: groupColumn.id, groupName: groupColumn.name, metrics };
    }
    case 'top_values': {
      const column = col(request.columns[0]);
      const freq = frequencies(vectors.multi.get(column.id) ?? [], request.options?.topN ?? 15);
      return { kind: 'top_values', column: column.id, columnName: column.name, items: freq.items, distinct: freq.distinct, total: freq.total };
    }
    case 'time_series': {
      const dateColumn = col(groups[0][0]);
      const dates = vectors.date.get(dateColumn.id) ?? [];
      const bucket = request.options?.bucket ?? 'month';
      const valueIds = groups[1];
      const metric = request.options?.metric ?? (valueIds.length ? 'mean' : 'count');
      const pick = (point: { count: number; sum: number; mean: number }) => metric === 'count' ? point.count : metric === 'sum' ? point.sum : point.mean;
      const series: SeriesLine[] = valueIds.length
        ? valueIds.map((id) => ({ label: col(id).name, points: timeSeries(dates, numbers(id), bucket).map((point) => ({ bucket: point.bucket, value: pick(point) })) }))
        : [{ label: dateColumn.name, points: timeSeries(dates, null, bucket).map((point) => ({ bucket: point.bucket, value: point.count })) }];
      return { kind: 'time_series', dateColumn: dateColumn.id, dateName: dateColumn.name, metric, bucket, series };
    }
    case 'data_quality': {
      const profileById = new Map(profile.columns.map((column) => [column.columnId, column]));
      return { kind: 'data_quality', rowCount: profile.rowCount, columns: columns.map((column) => {
        const columnProfile = profileById.get(column.id);
        const fillRate = columnProfile?.fillRate ?? 0;
        const distinct = columnProfile?.distinct ?? columnProfile?.distribution?.length ?? null;
        const issues: string[] = [];
        if (fillRate === 0) issues.push('Columna vacía');
        else if (fillRate < 0.5) issues.push('Muy incompleta');
        if (distinct != null && profile.rowCount > 1) {
          if (distinct === 1) issues.push('Valor constante');
          else if (distinct === profile.rowCount && (column.type === 'text' || column.type === 'title')) issues.push('Casi único (¿identificador?)');
        }
        return { column: column.id, name: column.name, type: column.type, filled: columnProfile?.filled ?? 0, fillRate, distinct, issues };
      }) };
    }
  }
}

/** Validate with SQL aggregates, scan bounded pages and compute from primitive vectors. */
export function runDatabaseAnalysis(databaseId: string, request: AnalysisRequest): RunAnalysisResult {
  const database = getDatabase(databaseId);
  if (!database) throw new Error('Base de datos no encontrada.');
  const columns = getColumns(databaseId);
  const profile = computeDatabaseProfileSql(databaseId, columns);
  const v = validateRequest(request, profile);
  if (!v.ok || !v.normalized) throw new Error(v.error ?? 'Solicitud de análisis no válida.');
  const vectors = loadAnalysisVectors(databaseId, columns, v.normalized);
  return { databaseName: database.name, request: v.normalized, result: computeAnalysisFromVectors(columns, vectors, profile, v.normalized) };
}

// ── narrate (AI prose over a computed result) ─────────────────────────────────

const NARRATE_SYSTEM = `Eres un analista de datos. Recibes el RESULTADO ya calculado de un análisis estadístico. Explícalo en 2-4 frases claras en Markdown: qué mide, qué muestran las cifras (correlación, significación, diferencias entre grupos, atípicos…) y una lectura prudente. Usa ÚNICAMENTE las cifras dadas; recuerda que correlación no implica causalidad y que los p-valores son aproximados. Sé conciso.`;
const NARRATE_SYSTEM_I18N: Record<string, string> = {
  es: NARRATE_SYSTEM,
  en: 'You are a data analyst. You receive the already calculated RESULT of a statistical analysis. Explain it in 2–4 clear Markdown sentences: what it measures, what the figures show (correlation, significance, group differences, outliers…), and a cautious interpretation. Use ONLY the supplied figures; remember that correlation does not imply causation and p-values are approximate. Be concise.',
  fr: 'Tu es analyste de données. Tu reçois le RÉSULTAT déjà calculé d’une analyse statistique. Explique-le en 2 à 4 phrases claires en Markdown : ce qu’il mesure, ce que montrent les chiffres (corrélation, significativité, différences entre groupes, valeurs atypiques…) et une interprétation prudente. Utilise UNIQUEMENT les chiffres fournis ; rappelle-toi que corrélation n’implique pas causalité et que les p-values sont approximatives. Sois concis.',
  de: 'Du bist Datenanalyst. Du erhältst das bereits berechnete ERGEBNIS einer statistischen Analyse. Erkläre es in 2–4 klaren Markdown-Sätzen: was es misst, was die Zahlen zeigen (Korrelation, Signifikanz, Gruppenunterschiede, Ausreißer …) und eine vorsichtige Interpretation. Verwende NUR die gelieferten Zahlen; Korrelation bedeutet keine Kausalität und p-Werte sind Näherungen. Sei prägnant.',
  pt: 'És analista de dados. Recebes o RESULTADO já calculado de uma análise estatística. Explica-o em 2–4 frases claras em Markdown: o que mede, o que mostram os números (correlação, significância, diferenças entre grupos, valores atípicos…) e uma interpretação prudente. Usa APENAS os números fornecidos; lembra-te de que correlação não implica causalidade e os valores-p são aproximados. Sê conciso.',
  'pt-BR': 'Você é um analista de dados. Recebe o RESULTADO já calculado de uma análise estatística. Explique-o em 2–4 frases claras em Markdown: o que mede, o que os números mostram (correlação, significância, diferenças entre grupos, valores atípicos…) e uma interpretação prudente. Use SOMENTE os números fornecidos; lembre-se de que correlação não implica causalidade e os valores-p são aproximados. Seja conciso.',
  it: 'Sei un analista dei dati. Ricevi il RISULTATO già calcolato di un’analisi statistica. Spiegalo in 2–4 frasi chiare in Markdown: cosa misura, cosa mostrano i numeri (correlazione, significatività, differenze tra gruppi, valori anomali…) e un’interpretazione prudente. Usa SOLO i numeri forniti; ricorda che correlazione non implica causalità e i p-value sono approssimativi. Sii conciso.',
  tr: 'Veri analistisin. İstatistiksel bir analizin önceden hesaplanmış SONUCUNU alırsın. Sonucu Markdown biçiminde 2–4 açık cümleyle açıkla: neyi ölçtüğünü, sayıların ne gösterdiğini (korelasyon, anlamlılık, grup farkları, aykırı değerler…) ve ihtiyatlı bir yorumu belirt. YALNIZCA verilen sayıları kullan; korelasyonun nedensellik anlamına gelmediğini ve p-değerlerinin yaklaşık olduğunu unutma. Kısa ve öz ol.',
  'zh-Hans': '你是一位数据分析师。你会收到一份已经计算好的统计分析结果。请用 Markdown 以 2–4 句清晰的话解释它：它衡量什么、数字说明了什么（相关性、显著性、组间差异、异常值……），以及一个审慎的解读。只使用所提供的数字；记住相关性不等于因果关系，且 p 值是近似值。要简明扼要。',
  'zh-Hant': '你是一位資料分析師。你會收到一份已經計算好的統計分析結果。請以 Markdown 用 2–4 句清晰的話解釋它：它衡量什麼、數字說明了什麼（相關性、顯著性、組間差異、離群值……），以及一個審慎的解讀。只使用所提供的數字；切記相關不等於因果，且 p 值為近似值。務求簡潔。',
  vi: 'Bạn là một chuyên gia phân tích dữ liệu. Bạn nhận được KẾT QUẢ đã được tính toán của một phân tích thống kê. Hãy giải thích kết quả đó bằng 2–4 câu Markdown rõ ràng: nó đo lường điều gì, các con số cho thấy điều gì (tương quan, ý nghĩa thống kê, khác biệt giữa các nhóm, giá trị bất thường…), và một cách diễn giải thận trọng. Chỉ sử dụng các con số được cung cấp; hãy nhớ rằng tương quan không hàm ý quan hệ nhân quả và giá trị p chỉ là gần đúng. Hãy viết súc tích.',
  ja: 'あなたはデータアナリストです。統計分析の計算済みの結果を受け取ります。Markdownで2–4文の明確な説明を書いてください：何を測定しているのか、数値が何を示しているのか（相関、有意性、グループ間の差、外れ値…）、そして慎重な解釈です。提供された数値のみを使用し、相関は因果関係を意味せず、p値は近似値であることに留意してください。簡潔にしてください。',
  ru: 'Вы аналитик данных. Вы получаете уже вычисленный РЕЗУЛЬТАТ статистического анализа. Объясните его в 2–4 ясных предложениях на Markdown: что он измеряет, что показывают числа (корреляция, значимость, различия между группами, выбросы…), и осторожная интерпретация. Используйте ТОЛЬКО предоставленные числа; помните, что корреляция не означает причинно-следственной связи, а p-значения приблизительны. Будьте кратки.',
  uk: 'Ви аналітик даних. Ви отримуєте вже обчислений РЕЗУЛЬТАТ статистичного аналізу. Поясніть його в 2–4 чітких реченнях у Markdown: що він вимірює, що показують числа (кореляція, значущість, відмінності між групами, викиди…), і стримане тлумачення. Використовуйте ТІЛЬКИ надані числа; пам\'ятайте, що кореляція не означає причинно-наслідкового зв\'язку, а p-значення є наближеними. Будьте стислі.',
  ko: '귀하는 데이터 분석가입니다. 이미 계산된 통계 분석 결과를 받습니다. Markdown으로 2–4개의 명확한 문장으로 설명하십시오: 무엇을 측정하는지, 수치가 무엇을 보여주는지(상관, 유의성, 그룹 간 차이, 이상값…), 그리고 신중한 해석입니다. 제공된 수치만 사용하고, 상관이 인과관계를 의미하지 않으며 p값은 근사치임을 기억하십시오. 간결하게 작성하십시오.',
};

interface ResultTextCopy {
  descriptive: string; mean: string; median: string; variance: string; deviation: string; skewness: string; kurtosis: string; outliers: string;
  correlation: string; regressionSlope: string; covariance: string; matrix: string; numeric: string; chiSquare: string; dof: string;
  crosstab: string; of: string; total: string; comparison: string; by: string; frequent: string; distinct: string;
  timeSeries: string; per: string; dataQuality: string; rows: string; columns: string; filled: string; noIssues: string;
  issues: Record<string, string>;
}

const RESULT_TEXT_COPY: Record<PromptLanguage, ResultTextCopy> = {
  es: { descriptive: 'Descriptiva', mean: 'media', median: 'mediana', variance: 'varianza', deviation: 'desv', skewness: 'asimetría', kurtosis: 'curtosis', outliers: 'atípicos', correlation: 'Correlación', regressionSlope: 'regresión pendiente', covariance: 'covarianza', matrix: 'Matriz', numeric: 'numéricas', chiSquare: 'Chi-cuadrado', dof: 'gl', crosstab: 'Tabla cruzada', of: 'de', total: 'Total', comparison: 'Comparación', by: 'por', frequent: 'Valores más frecuentes', distinct: 'distintos', timeSeries: 'Serie temporal', per: 'por', dataQuality: 'Calidad de datos', rows: 'filas', columns: 'columnas', filled: 'relleno', noIssues: 'sin problemas detectados; todas las columnas suficientemente completas', issues: { 'Columna vacía': 'Columna vacía', 'Muy incompleta': 'Muy incompleta', 'Valor constante': 'Valor constante', 'Casi único (¿identificador?)': 'Casi único (¿identificador?)' } },
  en: { descriptive: 'Descriptive statistics', mean: 'mean', median: 'median', variance: 'variance', deviation: 'stdev', skewness: 'skewness', kurtosis: 'kurtosis', outliers: 'outliers', correlation: 'Correlation', regressionSlope: 'regression slope', covariance: 'covariance', matrix: 'Matrix', numeric: 'numeric variables', chiSquare: 'Chi-square', dof: 'df', crosstab: 'Cross-tabulation', of: 'of', total: 'Total', comparison: 'Comparison', by: 'by', frequent: 'Most frequent values', distinct: 'distinct', timeSeries: 'Time series', per: 'by', dataQuality: 'Data quality', rows: 'rows', columns: 'columns', filled: 'filled', noIssues: 'no issues detected; every column is sufficiently complete', issues: { 'Columna vacía': 'Empty column', 'Muy incompleta': 'Highly incomplete', 'Valor constante': 'Constant value', 'Casi único (¿identificador?)': 'Almost unique (identifier?)' } },
  fr: { descriptive: 'Statistiques descriptives', mean: 'moyenne', median: 'médiane', variance: 'variance', deviation: 'écart-type', skewness: 'asymétrie', kurtosis: 'kurtosis', outliers: 'valeurs atypiques', correlation: 'Corrélation', regressionSlope: 'pente de régression', covariance: 'covariance', matrix: 'Matrice', numeric: 'variables numériques', chiSquare: 'Khi carré', dof: 'ddl', crosstab: 'Tableau croisé', of: 'de', total: 'Total', comparison: 'Comparaison', by: 'par', frequent: 'Valeurs les plus fréquentes', distinct: 'distinctes', timeSeries: 'Série temporelle', per: 'par', dataQuality: 'Qualité des données', rows: 'lignes', columns: 'colonnes', filled: 'rempli', noIssues: 'aucun problème détecté ; toutes les colonnes sont suffisamment complètes', issues: { 'Columna vacía': 'Colonne vide', 'Muy incompleta': 'Très incomplète', 'Valor constante': 'Valeur constante', 'Casi único (¿identificador?)': 'Presque unique (identifiant ?)' } },
  de: { descriptive: 'Deskriptive Statistik', mean: 'Mittelwert', median: 'Median', variance: 'Varianz', deviation: 'Standardabw.', skewness: 'Schiefe', kurtosis: 'Kurtosis', outliers: 'Ausreißer', correlation: 'Korrelation', regressionSlope: 'Regressionssteigung', covariance: 'Kovarianz', matrix: 'Matrix', numeric: 'numerische Variablen', chiSquare: 'Chi-Quadrat', dof: 'df', crosstab: 'Kreuztabelle', of: 'von', total: 'Gesamt', comparison: 'Vergleich', by: 'nach', frequent: 'Häufigste Werte', distinct: 'verschiedene', timeSeries: 'Zeitreihe', per: 'nach', dataQuality: 'Datenqualität', rows: 'Zeilen', columns: 'Spalten', filled: 'gefüllt', noIssues: 'keine Probleme erkannt; alle Spalten sind ausreichend vollständig', issues: { 'Columna vacía': 'Leere Spalte', 'Muy incompleta': 'Sehr unvollständig', 'Valor constante': 'Konstanter Wert', 'Casi único (¿identificador?)': 'Fast eindeutig (Bezeichner?)' } },
  pt: { descriptive: 'Estatística descritiva', mean: 'média', median: 'mediana', variance: 'variância', deviation: 'desvio-padrão', skewness: 'assimetria', kurtosis: 'curtose', outliers: 'atípicos', correlation: 'Correlação', regressionSlope: 'inclinação da regressão', covariance: 'covariância', matrix: 'Matriz', numeric: 'variáveis numéricas', chiSquare: 'Qui-quadrado', dof: 'gl', crosstab: 'Tabela cruzada', of: 'de', total: 'Total', comparison: 'Comparação', by: 'por', frequent: 'Valores mais frequentes', distinct: 'distintos', timeSeries: 'Série temporal', per: 'por', dataQuality: 'Qualidade dos dados', rows: 'linhas', columns: 'colunas', filled: 'preenchido', noIssues: 'sem problemas detetados; todas as colunas estão suficientemente completas', issues: { 'Columna vacía': 'Coluna vazia', 'Muy incompleta': 'Muito incompleta', 'Valor constante': 'Valor constante', 'Casi único (¿identificador?)': 'Quase único (identificador?)' } },
  'pt-BR': { descriptive: 'Estatística descritiva', mean: 'média', median: 'mediana', variance: 'variância', deviation: 'desvio-padrão', skewness: 'assimetria', kurtosis: 'curtose', outliers: 'atípicos', correlation: 'Correlação', regressionSlope: 'inclinação da regressão', covariance: 'covariância', matrix: 'Matriz', numeric: 'variáveis numéricas', chiSquare: 'Qui-quadrado', dof: 'gl', crosstab: 'Tabela cruzada', of: 'de', total: 'Total', comparison: 'Comparação', by: 'por', frequent: 'Valores mais frequentes', distinct: 'distintos', timeSeries: 'Série temporal', per: 'por', dataQuality: 'Qualidade dos dados', rows: 'linhas', columns: 'colunas', filled: 'preenchido', noIssues: 'nenhum problema detectado; todas as colunas estão suficientemente completas', issues: { 'Columna vacía': 'Coluna vazia', 'Muy incompleta': 'Muito incompleta', 'Valor constante': 'Valor constante', 'Casi único (¿identificador?)': 'Quase único (identificador?)' } },
  it: { descriptive: 'Statistica descrittiva', mean: 'media', median: 'mediana', variance: 'varianza', deviation: 'dev. std.', skewness: 'asimmetria', kurtosis: 'curtosi', outliers: 'anomali', correlation: 'Correlazione', regressionSlope: 'pendenza di regressione', covariance: 'covarianza', matrix: 'Matrice', numeric: 'variabili numeriche', chiSquare: 'Chi quadrato', dof: 'gdl', crosstab: 'Tabella incrociata', of: 'di', total: 'Totale', comparison: 'Confronto', by: 'per', frequent: 'Valori più frequenti', distinct: 'distinti', timeSeries: 'Serie temporale', per: 'per', dataQuality: 'Qualità dei dati', rows: 'righe', columns: 'colonne', filled: 'compilato', noIssues: 'nessun problema rilevato; tutte le colonne sono sufficientemente complete', issues: { 'Columna vacía': 'Colonna vuota', 'Muy incompleta': 'Molto incompleta', 'Valor constante': 'Valore costante', 'Casi único (¿identificador?)': 'Quasi univoco (identificatore?)' } },
  tr: { descriptive: 'Betimsel istatistik', mean: 'ortalama', median: 'medyan', variance: 'varyans', deviation: 'std. sapma', skewness: 'çarpıklık', kurtosis: 'basıklık', outliers: 'aykırı değerler', correlation: 'Korelasyon', regressionSlope: 'regresyon eğimi', covariance: 'kovaryans', matrix: 'Matris', numeric: 'sayısal değişken', chiSquare: 'Ki-kare', dof: 'sd', crosstab: 'Çapraz tablo', of: 'için', total: 'Toplam', comparison: 'Karşılaştırma', by: 'gruplama', frequent: 'En sık değerler', distinct: 'farklı', timeSeries: 'Zaman serisi', per: 'ölçekte', dataQuality: 'Veri kalitesi', rows: 'satır', columns: 'sütun', filled: 'dolu', noIssues: 'sorun saptanmadı; tüm sütunlar yeterince dolu', issues: { 'Columna vacía': 'Boş sütun', 'Muy incompleta': 'Çok eksik', 'Valor constante': 'Sabit değer', 'Casi único (¿identificador?)': 'Neredeyse benzersiz (kimlik?)' } },
  'zh-Hans': { descriptive: '描述性统计', mean: '均值', median: '中位数', variance: '方差', deviation: '标准差', skewness: '偏度', kurtosis: '峰度', outliers: '异常值', correlation: '相关性', regressionSlope: '回归斜率', covariance: '协方差', matrix: '矩阵', numeric: '数值变量', chiSquare: '卡方', dof: '自由度', crosstab: '交叉表', of: '的', total: '总计', comparison: '比较', by: '按', frequent: '最常见值', distinct: '个不同值', timeSeries: '时间序列', per: '按', dataQuality: '数据质量', rows: '行', columns: '列', filled: '已填充', noIssues: '未发现问题；所有列都足够完整', issues: { 'Columna vacía': '空列', 'Muy incompleta': '严重不完整', 'Valor constante': '常量值', 'Casi único (¿identificador?)': '几乎唯一（是标识符吗？）' } },
  'zh-Hant': { descriptive: '描述性統計', mean: '平均數', median: '中位數', variance: '變異數', deviation: '標準差', skewness: '偏態', kurtosis: '峰度', outliers: '離群值', correlation: '相關性', regressionSlope: '迴歸斜率', covariance: '共變異數', matrix: '矩陣', numeric: '數值變數', chiSquare: '卡方', dof: '自由度', crosstab: '交叉表', of: '的', total: '總計', comparison: '比較', by: '依', frequent: '最常見值', distinct: '個不同值', timeSeries: '時間序列', per: '依', dataQuality: '資料品質', rows: '列', columns: '欄位', filled: '已填寫', noIssues: '未發現問題；所有欄位都足夠完整', issues: { 'Columna vacía': '空欄位', 'Muy incompleta': '嚴重不完整', 'Valor constante': '固定值', 'Casi único (¿identificador?)': '幾乎唯一（是否為識別碼？）' } },
  vi: { descriptive: 'Thống kê mô tả', mean: 'trung bình', median: 'trung vị', variance: 'phương sai', deviation: 'độ lệch chuẩn', skewness: 'độ bất đối xứng', kurtosis: 'độ nhọn', outliers: 'giá trị bất thường', correlation: 'Tương quan', regressionSlope: 'độ dốc hồi quy', covariance: 'hiệp phương sai', matrix: 'Ma trận', numeric: 'biến số', chiSquare: 'Chi bình phương', dof: 'bậc tự do', crosstab: 'Bảng chéo', of: 'của', total: 'Tổng', comparison: 'So sánh', by: 'theo', frequent: 'Các giá trị thường gặp nhất', distinct: 'giá trị khác biệt', timeSeries: 'Chuỗi thời gian', per: 'theo', dataQuality: 'Chất lượng dữ liệu', rows: 'dòng', columns: 'cột', filled: 'đã điền', noIssues: 'không phát hiện vấn đề; mọi cột đều đầy đủ', issues: { 'Columna vacía': 'Cột trống', 'Muy incompleta': 'Rất thiếu', 'Valor constante': 'Giá trị không đổi', 'Casi único (¿identificador?)': 'Gần như duy nhất (mã định danh?)' } },
  ja: { descriptive: '記述統計', mean: '平均', median: '中央値', variance: '分散', deviation: '標準偏差', skewness: '歪度', kurtosis: '尖度', outliers: '外れ値', correlation: '相関', regressionSlope: '回帰の傾き', covariance: '共分散', matrix: '行列', numeric: '数値変数', chiSquare: 'カイ二乗', dof: '自由度', crosstab: 'クロス集計', of: 'の', total: '合計', comparison: '比較', by: '別', frequent: '頻出値', distinct: '種類', timeSeries: '時系列', per: '別', dataQuality: 'データ品質', rows: '行', columns: '列', filled: '入力済み', noIssues: '問題は検出されませんでした。すべての列は十分に完全です', issues: { 'Columna vacía': '空の列', 'Muy incompleta': '大幅に不完全', 'Valor constante': '一定値', 'Casi único (¿identificador?)': 'ほぼ一意（識別子ですか？）' } },
  ru: { descriptive: 'Описательная статистика', mean: 'среднее', median: 'медиана', variance: 'дисперсия', deviation: 'стандартное отклонение', skewness: 'асимметрия', kurtosis: 'эксцесс', outliers: 'выбросы', correlation: 'Корреляции', regressionSlope: 'наклон регрессии', covariance: 'ковариации', matrix: 'Матрица', numeric: 'числовые переменные', chiSquare: 'Хи-квадрат', dof: 'ст. св.', crosstab: 'Таблица сопряжённости', of: 'для', total: 'Итого', comparison: 'Сравнение', by: 'по', frequent: 'Самые частые значения', distinct: 'уникальных', timeSeries: 'Временной ряд', per: 'по', dataQuality: 'Качество данных', rows: 'строк', columns: 'столбцов', filled: 'заполнено', noIssues: 'проблем не обнаружено; все столбцы достаточно заполнены', issues: { 'Columna vacía': 'Пустой столбец', 'Muy incompleta': 'Сильно неполный', 'Valor constante': 'Постоянное значение', 'Casi único (¿identificador?)': 'Почти уникально (идентификатор?)' } },
  uk: { descriptive: 'Описова статистика', mean: 'середнє', median: 'медіана', variance: 'дисперсія', deviation: 'стандартне відхилення', skewness: 'асиметрія', kurtosis: 'ексцес', outliers: 'викиди', correlation: 'Кореляції', regressionSlope: 'нахил регресії', covariance: 'коваріації', matrix: 'Матриця', numeric: 'числові змінні', chiSquare: 'Хі-квадрат', dof: 'ст. св.', crosstab: 'Таблиця спряженості', of: 'для', total: 'Разом', comparison: 'Порівняння', by: 'за', frequent: 'Найчастіші значення', distinct: 'унікальних', timeSeries: 'Часовий ряд', per: 'за', dataQuality: 'Якість даних', rows: 'рядків', columns: 'стовпців', filled: 'заповнено', noIssues: 'проблем не виявлено; усі стовпці достатньо заповнені', issues: { 'Columna vacía': 'Порожній стовпець', 'Muy incompleta': 'Дуже неповний', 'Valor constante': 'Стале значення', 'Casi único (¿identificador?)': 'Майже унікально (ідентифікатор?)' } },
  ko: { descriptive: '기술 통계', mean: '평균', median: '중앙값', variance: '분산', deviation: '표준편차', skewness: '왜도', kurtosis: '첨도', outliers: '이상값', correlation: '상관', regressionSlope: '회귀 기울기', covariance: '공분산', matrix: '행렬', numeric: '수치 변수', chiSquare: '카이제곱', dof: '자유도', crosstab: '교차표', of: '의', total: '합계', comparison: '비교', by: '기준', frequent: '가장 빈번한 값', distinct: '고유값', timeSeries: '시계열', per: '기준', dataQuality: '데이터 품질', rows: '행', columns: '열', filled: '채움', noIssues: '문제가 감지되지 않았습니다. 모든 열이 충분히 채워져 있습니다', issues: { 'Columna vacía': '빈 열', 'Muy incompleta': '매우 불완전', 'Valor constante': '상수값', 'Casi único (¿identificador?)': '거의 고유(식별자인가요?)' } },
};

/** Compact textual summary of a computed result for the narration prompt. */
export function resultToText(r: AnalysisResult, language: PromptLanguage = 'es'): string {
  const c = RESULT_TEXT_COPY[language] ?? RESULT_TEXT_COPY.es;
  switch (r.kind) {
    case 'descriptive':
      return r.columns
        .map((column) => `${c.descriptive} ${c.of} "${column.columnName}": n=${column.stats.n}, ${c.mean}=${column.stats.mean}, ${c.median}=${column.stats.median}, ${c.variance}=${column.stats.variance}, ${c.deviation}=${column.stats.stdev}, CV=${column.stats.cv}, Q1=${column.stats.q1}, Q3=${column.stats.q3}, ${c.skewness}=${column.stats.skewness}, ${c.kurtosis}=${column.stats.kurtosis}, ${c.outliers}=${column.stats.outliers.length}.`)
        .join('\n');
    case 'correlation':
      return `${c.correlation} "${r.xName}" vs "${r.yName}": Pearson r=${r.pearson.r} (n=${r.pearson.n}, p=${r.pearson.p}), Spearman=${r.spearman.r}, ${c.regressionSlope}=${r.regression.slope}, R²=${r.regression.r2}.`;
    case 'correlation_matrix':
    case 'covariance_matrix': {
      const pairs: string[] = [];
      for (let i = 0; i < r.matrix.labels.length; i++)
        for (let j = i + 1; j < r.matrix.labels.length; j++) pairs.push(`${r.matrix.labels[i]}~${r.matrix.labels[j]}=${r.matrix.matrix[i][j]}`);
      const noun = r.kind === 'covariance_matrix' ? c.covariance : c.correlation.toLocaleLowerCase(language);
      return `${c.matrix} ${c.of} ${noun} (${r.matrix.labels.length} ${c.numeric}): ${pairs.join(', ')}.`;
    }
    case 'chi_square':
      return `${c.chiSquare} "${r.rowName}" x "${r.colName}": χ²=${r.result.chi2}, ${c.dof}=${r.result.dof}, V de Cramér=${r.result.cramersV}, p=${r.result.p}, n=${r.result.table.total}.`;
    case 'crosstab': {
      const rowsTxt = r.rowLabels.map((rl, i) => `${rl}: [${r.colLabels.map((cl, j) => `${cl}=${r.values[i][j]}`).join(', ')}]`).join('; ');
      return `${c.crosstab} "${r.rowName}" x "${r.colName}" (${r.aggregate}${r.valueName ? ` ${c.of} ${r.valueName}` : ''}): ${rowsTxt}. ${c.total}=${r.total}.`;
    }
    case 'group_compare':
      return r.metrics
        .map((m) => {
          const g = m.result.groups.map((x) => `${x.label}: ${c.mean}=${x.mean} (n=${x.count})`).join('; ');
          const a = m.result.anova ? ` ANOVA F=${m.result.anova.f}, p=${m.result.anova.p}, η²=${m.result.anova.etaSquared}.` : '';
          return `${c.comparison} ${c.of} "${m.valueName}" ${c.by} "${r.groupName}": ${g}.${a}`;
        })
        .join('\n');
    case 'top_values':
      return `${c.frequent} ${c.of} "${r.columnName}" (${r.distinct} ${c.distinct}, ${r.total} ${c.total.toLocaleLowerCase(language)}): ${r.items.map((i) => `${i.label} (${i.count})`).join(', ')}.`;
    case 'time_series':
      return `${c.timeSeries} ${c.of} "${r.dateName}" (${r.metric}, ${c.per} ${r.bucket}): ${r.series.map((s) => `${s.label}: ${s.points.map((p) => `${p.bucket}=${p.value}`).join(', ')}`).join(' | ')}.`;
    case 'data_quality': {
      const flagged = r.columns.filter((c) => c.issues.length);
      return `${c.dataQuality} (${r.rowCount} ${c.rows}, ${r.columns.length} ${c.columns}): ${flagged.length ? flagged.map((column) => `${column.name} (${c.filled} ${Math.round(column.fillRate * 100)}%: ${column.issues.map((issue) => c.issues[issue] ?? issue).join(', ')})`).join('; ') : c.noIssues}.`;
    }
  }
}

/** Write a short prose reading of an already-computed analysis result. */
export async function narrateAnalysisResult(result: AnalysisResult, deps: AnalysisDeps = {}): Promise<string> {
  const complete = deps.complete ?? defaultComplete;
  const language = getSettings().promptLanguage ?? 'es';
  const text = await complete(
    { system: localizedAnalysisSystem(language, 'narrate'), user: `${analysisScaffolding(language, 'result')}\n${resultToText(result, language)}\n\n${analysisScaffolding(language, 'narrate')}`, plainContext: true, temperature: 0.3, maxTokens: 400 },
    deps.model ?? null
  );
  return text.trim();
}
