import type {
  Debate,
  DebateAnalysisRequest,
  DebateAnalysisResponse,
  DebateSide,
  PromptLanguage,
} from '@shared/types';
import { getDebate } from '../graph/graphService';
import { AiError, completeTextStream } from './aiClient';
import { coreStructuredPrompt } from './prompts';
import { getSettings } from '../db/settingsRepo';

const MAX_WORKS_PER_SIDE = 6;
const MAX_EVIDENCE_PER_WORK = 2;
const QUOTE_CLIP = 320;

interface DebatePromptCopy {
  unknownAuthor: string;
  noDate: string;
  noLocation: string;
  side: string;
  idea: string;
  label: string;
  claim: string;
  sideAuthors: string;
  work: string;
  development: string;
  evidence: string;
  refutation: string;
  contradiction: string;
  relation: string;
  basis: string;
  confidence: string;
  year: string;
  internal: string;
  sharedThemes: string;
  chronology: string;
  firstAuthor: string;
  cite: (a: string, b: string) => string;
  analyze: string;
}

const DEBATE_PROMPT_COPY: Record<PromptLanguage, DebatePromptCopy> = {
  es: { unknownAuthor: 'autor desconocido', noDate: 's. f.', noLocation: 's. l.', side: 'Bando', idea: 'idea', label: 'Etiqueta', claim: 'Afirmación', sideAuthors: 'Autores del bando', work: 'Obra', development: 'Desarrollo', evidence: 'Evidencia', refutation: 'refutación', contradiction: 'contradicción', relation: 'Relación detectada', basis: 'base', confidence: 'confianza', year: 'año', internal: 'Nota: ambas ideas las desarrolla la misma obra (tensión interna, no debate entre autores distintos).', sharedThemes: 'Temas compartidos', chronology: 'Cronología', firstAuthor: 'primer autor', cite: (a, b) => `Cita el bando A como ${a} y el bando B como ${b} cuando corresponda.`, analyze: 'Analiza este debate siguiendo tus instrucciones.' },
  en: { unknownAuthor: 'unknown author', noDate: 'n.d.', noLocation: 'n.p.', side: 'Side', idea: 'idea', label: 'Label', claim: 'Claim', sideAuthors: 'Authors on this side', work: 'Work', development: 'Development', evidence: 'Evidence', refutation: 'refutation', contradiction: 'contradiction', relation: 'Detected relationship', basis: 'basis', confidence: 'confidence', year: 'year', internal: 'Note: both ideas are developed by the same work (an internal tension, not a debate between different authors).', sharedThemes: 'Shared themes', chronology: 'Chronology', firstAuthor: 'first author', cite: (a, b) => `Cite side A as ${a} and side B as ${b} where appropriate.`, analyze: 'Analyze this debate according to your instructions.' },
  fr: { unknownAuthor: 'auteur inconnu', noDate: 's. d.', noLocation: 's. l.', side: 'Camp', idea: 'idée', label: 'Libellé', claim: 'Affirmation', sideAuthors: 'Auteurs du camp', work: 'Œuvre', development: 'Développement', evidence: 'Preuve', refutation: 'réfutation', contradiction: 'contradiction', relation: 'Relation détectée', basis: 'base', confidence: 'confiance', year: 'année', internal: 'Remarque : les deux idées sont développées dans la même œuvre (tension interne, et non débat entre auteurs distincts).', sharedThemes: 'Thèmes communs', chronology: 'Chronologie', firstAuthor: 'premier auteur', cite: (a, b) => `Citez le camp A sous la forme ${a} et le camp B sous la forme ${b}, le cas échéant.`, analyze: 'Analysez ce débat conformément à vos instructions.' },
  de: { unknownAuthor: 'unbekannter Autor', noDate: 'o. J.', noLocation: 'o. O.', side: 'Seite', idea: 'Idee', label: 'Bezeichnung', claim: 'Aussage', sideAuthors: 'Autoren dieser Seite', work: 'Werk', development: 'Ausführung', evidence: 'Beleg', refutation: 'Widerlegung', contradiction: 'Widerspruch', relation: 'Erkannte Beziehung', basis: 'Grundlage', confidence: 'Konfidenz', year: 'Jahr', internal: 'Hinweis: Beide Ideen werden im selben Werk entwickelt (innere Spannung, keine Debatte zwischen verschiedenen Autoren).', sharedThemes: 'Gemeinsame Themen', chronology: 'Chronologie', firstAuthor: 'erster Autor', cite: (a, b) => `Zitieren Sie Seite A gegebenenfalls als ${a} und Seite B als ${b}.`, analyze: 'Analysieren Sie diese Debatte gemäß Ihren Anweisungen.' },
  pt: { unknownAuthor: 'autor desconhecido', noDate: 's. d.', noLocation: 's. l.', side: 'Lado', idea: 'ideia', label: 'Etiqueta', claim: 'Afirmação', sideAuthors: 'Autores deste lado', work: 'Obra', development: 'Desenvolvimento', evidence: 'Evidência', refutation: 'refutação', contradiction: 'contradição', relation: 'Relação detetada', basis: 'base', confidence: 'confiança', year: 'ano', internal: 'Nota: ambas as ideias são desenvolvidas pela mesma obra (tensão interna, não um debate entre autores diferentes).', sharedThemes: 'Temas partilhados', chronology: 'Cronologia', firstAuthor: 'primeiro autor', cite: (a, b) => `Cite o lado A como ${a} e o lado B como ${b}, quando aplicável.`, analyze: 'Analise este debate de acordo com as instruções.' },
  'pt-BR': { unknownAuthor: 'autor desconhecido', noDate: 's. d.', noLocation: 's. l.', side: 'Lado', idea: 'ideia', label: 'Rótulo', claim: 'Afirmação', sideAuthors: 'Autores deste lado', work: 'Obra', development: 'Desenvolvimento', evidence: 'Evidência', refutation: 'refutação', contradiction: 'contradição', relation: 'Relação detectada', basis: 'base', confidence: 'confiança', year: 'ano', internal: 'Observação: ambas as ideias são desenvolvidas pela mesma obra (tensão interna, não um debate entre autores diferentes).', sharedThemes: 'Temas compartilhados', chronology: 'Cronologia', firstAuthor: 'primeiro autor', cite: (a, b) => `Cite o lado A como ${a} e o lado B como ${b}, quando apropriado.`, analyze: 'Analise este debate de acordo com as instruções.' },
  it: { unknownAuthor: 'autore sconosciuto', noDate: 's. d.', noLocation: 's. l.', side: 'Parte', idea: 'idea', label: 'Etichetta', claim: 'Affermazione', sideAuthors: 'Autori della parte', work: 'Opera', development: 'Sviluppo', evidence: 'Evidenza', refutation: 'confutazione', contradiction: 'contraddizione', relation: 'Relazione rilevata', basis: 'base', confidence: 'confidenza', year: 'anno', internal: 'Nota: entrambe le idee sono sviluppate dalla stessa opera (tensione interna, non un dibattito fra autori diversi).', sharedThemes: 'Temi condivisi', chronology: 'Cronologia', firstAuthor: 'primo autore', cite: (a, b) => `Cita la parte A come ${a} e la parte B come ${b}, quando opportuno.`, analyze: 'Analizza questo dibattito seguendo le istruzioni.' },
  tr: { unknownAuthor: 'bilinmeyen yazar', noDate: 't.y.', noLocation: 'y.y.', side: 'Taraf', idea: 'fikir', label: 'Etiket', claim: 'İddia', sideAuthors: 'Bu taraftaki yazarlar', work: 'Eser', development: 'Açıklama', evidence: 'Kanıt', refutation: 'çürütme', contradiction: 'çelişki', relation: 'Tespit edilen ilişki', basis: 'temel', confidence: 'güven', year: 'yıl', internal: 'Not: Her iki fikir de aynı eserde geliştirilmiştir (farklı yazarlar arasındaki bir tartışma değil, içsel bir gerilimdir).', sharedThemes: 'Ortak temalar', chronology: 'Kronoloji', firstAuthor: 'ilk yazar', cite: (a, b) => `Uygun olduğunda A tarafını ${a}, B tarafını ise ${b} olarak alıntılayın.`, analyze: 'Bu tartışmayı talimatlarınıza göre analiz edin.' },
  'zh-Hans': { unknownAuthor: '未知作者', noDate: '无日期', noLocation: '无地点', side: '阵营', idea: '想法', label: '标签', claim: '论断', sideAuthors: '该阵营的作者', work: '著作', development: '阐述', evidence: '证据', refutation: '反驳', contradiction: '矛盾', relation: '检测到的关系', basis: '依据', confidence: '置信度', year: '年份', internal: '注意：两个想法均由同一部著作阐述（属于内部张力，而非不同作者之间的争论）。', sharedThemes: '共同主题', chronology: '时间线', firstAuthor: '第一作者', cite: (a, b) => `在适当之处，将 A 方引用为 ${a}，将 B 方引用为 ${b}。`, analyze: '请按照你的指示分析这场争论。' },
  'zh-Hant': { unknownAuthor: '未知作者', noDate: '無日期', noLocation: '無地點', side: '陣營', idea: '想法', label: '標籤', claim: '論斷', sideAuthors: '該陣營的作者', work: '著作', development: '闡述', evidence: '證據', refutation: '反駁', contradiction: '矛盾', relation: '偵測到的關係', basis: '依據', confidence: '信心度', year: '年份', internal: '注意：兩個想法均由同一部著作闡述（屬於內部張力，而非不同作者之間的爭論）。', sharedThemes: '共同主題', chronology: '時間軸', firstAuthor: '第一作者', cite: (a, b) => `在適當之處，將 A 方引用為 ${a}，將 B 方引用為 ${b}。`, analyze: '請依照你的指示分析這場爭論。' },
  vi: { unknownAuthor: 'tác giả không rõ', noDate: 'không rõ năm', noLocation: 'không rõ vị trí', side: 'Phe', idea: 'ý tưởng', label: 'Nhãn', claim: 'Luận điểm', sideAuthors: 'Tác giả của phe này', work: 'Tác phẩm', development: 'Triển khai', evidence: 'Bằng chứng', refutation: 'bác bỏ', contradiction: 'mâu thuẫn', relation: 'Quan hệ được phát hiện', basis: 'cơ sở', confidence: 'độ tin cậy', year: 'năm', internal: 'Lưu ý: cả hai ý tưởng đều do cùng một tác phẩm triển khai (đây là căng thẳng nội tại, không phải tranh luận giữa các tác giả khác nhau).', sharedThemes: 'Chủ đề chung', chronology: 'Niên biểu', firstAuthor: 'tác giả đầu tiên', cite: (a, b) => `Trích dẫn phe A là ${a} và phe B là ${b} khi thích hợp.`, analyze: 'Hãy phân tích cuộc tranh luận này theo hướng dẫn của bạn.' },
  ja: { unknownAuthor: '著者不明', noDate: '日付なし', noLocation: '場所なし', side: '陣営', idea: 'アイデア', label: 'ラベル', claim: '主張', sideAuthors: 'この陣営の著者', work: '著作', development: '展開', evidence: '証拠', refutation: '反駁', contradiction: '矛盾', relation: '検出された関係', basis: '根拠', confidence: '信頼度', year: '年', internal: '注：両方のアイデアは同じ著作によって展開されています（異なる著者間の論争ではなく、内部的な緊張です）。', sharedThemes: '共通テーマ', chronology: '年表', firstAuthor: '筆頭著者', cite: (a, b) => `適切な箇所で、陣営Aを ${a}、陣営Bを ${b} として引用してください。`, analyze: '指示に従ってこの論争を分析してください。' },
  ru: { unknownAuthor: 'автор неизвестен', noDate: 'б. г.', noLocation: 'б. м.', side: 'Сторона', idea: 'идея', label: 'Метка', claim: 'Утверждение', sideAuthors: 'Авторы этой стороны', work: 'Работа', development: 'Разработка', evidence: 'Доказательство', refutation: 'опровержение', contradiction: 'противоречие', relation: 'Обнаруженная связь', basis: 'основание', confidence: 'уверенность', year: 'год', internal: 'Примечание: обе идеи раскрываются в одной и той же работе (это внутреннее напряжение, а не спор между разными авторами).', sharedThemes: 'Общие темы', chronology: 'Хронология', firstAuthor: 'первый автор', cite: (a, b) => `Ссылайтесь на сторону A как ${a}, а на сторону B как ${b}, где это уместно.`, analyze: 'Проанализируйте этот спор в соответствии с вашими инструкциями.' },
  uk: { unknownAuthor: 'автор невідомий', noDate: 'без дати', noLocation: 'без місця', side: 'Сторона', idea: 'ідея', label: 'Мітка', claim: 'Твердження', sideAuthors: 'Автори цієї сторони', work: 'Праця', development: 'Розробка', evidence: 'Доказ', refutation: 'спростування', contradiction: 'суперечність', relation: 'Виявлений зв’язок', basis: 'підстава', confidence: 'впевненість', year: 'рік', internal: 'Примітка: обидві ідеї розкриває та сама праця (це внутрішня напруга, а не суперечка між різними авторами).', sharedThemes: 'Спільні теми', chronology: 'Хронологія', firstAuthor: 'перший автор', cite: (a, b) => `Посилайтеся на сторону A як ${a}, а на сторону B як ${b}, де це доречно.`, analyze: 'Проаналізуйте цю суперечку відповідно до ваших інструкцій.' },
  ko: { unknownAuthor: '저자 미상', noDate: '연도 미상', noLocation: '장소 미상', side: '측', idea: '아이디어', label: '레이블', claim: '주장', sideAuthors: '이 측의 저자', work: '저작', development: '전개', evidence: '근거', refutation: '반박', contradiction: '모순', relation: '감지된 관계', basis: '기준', confidence: '신뢰도', year: '연도', internal: '참고: 두 아이디어 모두 같은 저작에서 전개됩니다(서로 다른 저자 간의 논쟁이 아니라 내적 긴장입니다).', sharedThemes: '공통 주제', chronology: '연대기', firstAuthor: '제1저자', cite: (a, b) => `해당되는 경우 A측은 ${a}, B측은 ${b}로 인용하십시오.`, analyze: '지침에 따라 이 논쟁을 분석하십시오.' },
};

function clip(value: string, max: number): string {
  const clean = (value || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

function authorYear(side: DebateSide, copy: DebatePromptCopy): string {
  const first = side.works[0];
  const author = first?.authors[0] ?? copy.unknownAuthor;
  const year = first?.year ?? copy.noDate;
  return `${author}, ${year}`;
}

/** Render one side as a compact, citable block for the model context. */
function renderSide(label: 'A' | 'B', side: DebateSide, copy: DebatePromptCopy): string {
  const lines: string[] = [];
  lines.push(`### ${copy.side} ${label} — ${copy.idea} ${side.ideaId} (${side.type})`);
  lines.push(`${copy.label}: ${side.label}`);
  lines.push(`${copy.claim}: ${clip(side.statement, 600)}`);
  if (side.authors.length) lines.push(`${copy.sideAuthors}: ${side.authors.slice(0, 10).join('; ')}`);
  for (const work of side.works.slice(0, MAX_WORKS_PER_SIDE)) {
    const author = work.authors[0] ?? copy.unknownAuthor;
    lines.push(
      `- ${copy.work} ${work.nodus_id} · ${author}, ${work.year ?? copy.noDate} · «${clip(work.title, 140)}» (${work.role})`
    );
    if (work.development) lines.push(`  ${copy.development}: ${clip(work.development, 280)}`);
    for (const ev of work.evidence.slice(0, MAX_EVIDENCE_PER_WORK)) {
      lines.push(`  ${copy.evidence} (${ev.location ?? copy.noLocation}): "${clip(ev.quote, QUOTE_CLIP)}"`);
    }
  }
  return lines.join('\n');
}

export function buildDebatePrompt(debate: Debate, language: PromptLanguage = getSettings().promptLanguage ?? 'es'): { system: string; user: string } {
  const copy = DEBATE_PROMPT_COPY[language] ?? DEBATE_PROMPT_COPY.es;
  const relationLabel = debate.relation === 'refutes' ? copy.refutation : copy.contradiction;
  const chronology = debate.timeline
    .filter((e) => e.year != null)
    .map((e) => `${e.year} · ${copy.side.toLocaleLowerCase(language)} ${e.side} · ${e.authors[0] ?? copy.unknownAuthor}`)
    .join('\n');

  const user = [
    `${copy.relation}: ${relationLabel} (${copy.basis} ${debate.basis}, ${copy.confidence} ${debate.confidence.toFixed(2)}).`,
    debate.internal
      ? copy.internal
      : '',
    debate.sharedThemes.length ? `${copy.sharedThemes}: ${debate.sharedThemes.join('; ')}.` : '',
    '',
    renderSide('A', debate.sideA, copy),
    '',
    renderSide('B', debate.sideB, copy),
    '',
    chronology ? `## ${copy.chronology} (${copy.year} · ${copy.side.toLocaleLowerCase(language)} · ${copy.firstAuthor})\n${chronology}` : '',
    '',
    copy.cite(
      `[${authorYear(debate.sideA, copy)}](nodus://idea/${debate.sideA.ideaId})`,
      `[${authorYear(debate.sideB, copy)}](nodus://idea/${debate.sideB.ideaId})`,
    ),
    copy.analyze,
  ]
    .filter(Boolean)
    .join('\n');

  return { system: coreStructuredPrompt('debate', language), user };
}

/**
 * User-triggered, streamed AI synthesis of a single debate. Grounded strictly in the
 * debate's two ideas and their verbatim evidence (closed set → no invented sources).
 * Optional: the Debate view works fully without ever calling this.
 */
export async function streamDebateAnalysis(
  request: DebateAnalysisRequest,
  onDelta: (delta: string, kind?: 'content' | 'reasoning') => void
): Promise<DebateAnalysisResponse> {
  const debate = getDebate(request.debateId);
  if (!debate) throw new AiError('No se encontró el debate solicitado.', false, false);
  const { system, user } = buildDebatePrompt(debate);
  const analysis = await completeTextStream(
    { system, user, temperature: 0.3, maxTokens: 1400 },
    onDelta,
    request.model
  );
  return { analysis };
}
