/**
 * Pure helpers for the database chat: the analyst system prompt and the context
 * assembly (statistical profile + a bounded sample of rows). Dependency-free so the
 * context builder is unit-tested; the electron orchestrator fills in the profile/sample
 * from the repo and streams the answer.
 */

export const DB_CHAT_SYSTEM = `Eres un analista de datos que conversa sobre una o varias bases de datos del usuario. Responde ÚNICAMENTE con la información de los datos proporcionados (perfil estadístico + muestra de filas); no inventes cifras, filas ni columnas. Cita cifras concretas cuando ayuden. Cuando un gráfico aclare la respuesta, incluye UN bloque de código con el lenguaje "chart" y un JSON válido con esta forma exacta, usando solo datos reales:
\`\`\`chart
{"type":"bar","title":"…","items":[{"label":"…","value":10}]}
\`\`\`
(usa "pie" en lugar de "bar" para proporciones). Explica en texto lo que muestra el gráfico. Sé conciso y claro; usa Markdown.`;

export interface DbChatPart {
  name: string;
  profileText: string;
  /** A compact textual sample of the first rows. */
  sample: string;
}

export function buildDbChatContext(parts: DbChatPart[]): string {
  return parts
    .map((p) => `=== BASE DE DATOS: ${p.name} ===\n${p.profileText}\n\nMuestra de filas:\n${p.sample || '(sin filas)'}`)
    .join('\n\n');
}

export interface DbChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Compose the user message: prior turns (bounded) + the context + the new question. */
export function buildDbChatUser(context: string, question: string, history: DbChatTurn[] = []): string {
  const convo = history
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'Usuario' : 'Asistente'}: ${t.content}`)
    .join('\n');
  const parts = ['=== DATOS ===', context, ''];
  if (convo.trim()) parts.push('=== CONVERSACIÓN PREVIA ===', convo, '');
  parts.push(`=== PREGUNTA ===\n${question}`);
  return parts.join('\n');
}
