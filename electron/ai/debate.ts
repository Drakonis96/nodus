import type {
  Debate,
  DebateAnalysisRequest,
  DebateAnalysisResponse,
  DebateSide,
} from '@shared/types';
import { getDebate } from '../graph/graphService';
import { AiError, completeTextStream } from './aiClient';
import { PROMPT_DEBATE } from './prompts';

const MAX_WORKS_PER_SIDE = 6;
const MAX_EVIDENCE_PER_WORK = 2;
const QUOTE_CLIP = 320;

function clip(value: string, max: number): string {
  const clean = (value || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

function authorYear(side: DebateSide): string {
  const first = side.works[0];
  const author = first?.authors[0] ?? 'autor desconocido';
  const year = first?.year ?? 's. f.';
  return `${author}, ${year}`;
}

/** Render one side as a compact, citable block for the model context. */
function renderSide(label: 'A' | 'B', side: DebateSide): string {
  const lines: string[] = [];
  lines.push(`### Bando ${label} — idea ${side.ideaId} (${side.type})`);
  lines.push(`Etiqueta: ${side.label}`);
  lines.push(`Afirmación: ${clip(side.statement, 600)}`);
  if (side.authors.length) lines.push(`Autores del bando: ${side.authors.slice(0, 10).join('; ')}`);
  for (const work of side.works.slice(0, MAX_WORKS_PER_SIDE)) {
    const author = work.authors[0] ?? 'autor desconocido';
    lines.push(
      `- Obra ${work.nodus_id} · ${author}, ${work.year ?? 's. f.'} · «${clip(work.title, 140)}» (${work.role})`
    );
    if (work.development) lines.push(`  Desarrollo: ${clip(work.development, 280)}`);
    for (const ev of work.evidence.slice(0, MAX_EVIDENCE_PER_WORK)) {
      lines.push(`  Evidencia (${ev.location ?? 's. l.'}): "${clip(ev.quote, QUOTE_CLIP)}"`);
    }
  }
  return lines.join('\n');
}

function buildDebatePrompt(debate: Debate): { system: string; user: string } {
  const relationLabel = debate.relation === 'refutes' ? 'refutación' : 'contradicción';
  const chronology = debate.timeline
    .filter((e) => e.year != null)
    .map((e) => `${e.year} · bando ${e.side} · ${e.authors[0] ?? 'autor desconocido'}`)
    .join('\n');

  const user = [
    `Relación detectada: ${relationLabel} (base ${debate.basis}, confianza ${debate.confidence.toFixed(2)}).`,
    debate.internal
      ? 'Nota: ambas ideas las desarrolla la misma obra (tensión interna, no debate entre autores distintos).'
      : '',
    debate.sharedThemes.length ? `Temas compartidos: ${debate.sharedThemes.join('; ')}.` : '',
    '',
    renderSide('A', debate.sideA),
    '',
    renderSide('B', debate.sideB),
    '',
    chronology ? `## Cronología (año · bando · primer autor)\n${chronology}` : '',
    '',
    `Cita el bando A como [${authorYear(debate.sideA)}](nodus://idea/${debate.sideA.ideaId}) y el bando B como [${authorYear(
      debate.sideB
    )}](nodus://idea/${debate.sideB.ideaId}) cuando corresponda.`,
    'Analiza este debate siguiendo tus instrucciones.',
  ]
    .filter(Boolean)
    .join('\n');

  return { system: PROMPT_DEBATE, user };
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
