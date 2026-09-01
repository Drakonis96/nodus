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
