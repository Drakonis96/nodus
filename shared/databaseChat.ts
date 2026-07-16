/**
 * Pure helpers for the database chat: the analyst system prompt and the context
 * assembly (statistical profile + a bounded sample of rows). Dependency-free so the
 * context builder is unit-tested; the electron orchestrator fills in the profile/sample
 * from the repo and streams the answer.
 */

/**
 * The context carries two very different things: a profile computed over every row, and a
 * handful of example rows. A model shown 15 numbered rows will answer "15" when asked how
 * many rows there are — it counts what it can see — so the split has to be spelled out, and
 * the profile named as the only source of any figure.
 */
export const DB_CHAT_SYSTEM = `Eres un analista de datos que conversa sobre una o varias bases de datos del usuario. Responde ÚNICAMENTE con la información de los datos proporcionados; no inventes cifras, filas ni columnas.

Los datos llegan en dos bloques MUY distintos:
1. El PERFIL: se ha calculado sobre TODAS las filas de la tabla. Es la única fuente válida para totales, recuentos, mínimos, máximos, medias y distribuciones.
2. La MUESTRA: solo unas pocas filas de ejemplo para que veas qué aspecto tienen. NO es la tabla. Nunca cuentes las filas de la muestra, ni deduzcas de ella totales, máximos, mínimos ni "cuántos hay de X".

Si la pregunta pide una cifra que el perfil no incluye, dilo claramente en lugar de estimarla a partir de la muestra. Cita cifras concretas cuando ayuden. Cuando un gráfico aclare la respuesta, incluye UN bloque de código con el lenguaje "chart" y un JSON válido con esta forma exacta, usando solo datos reales:
\`\`\`chart
{"type":"bar","title":"…","items":[{"label":"…","value":10}]}
\`\`\`
(usa "pie" en lugar de "bar" para proporciones). Explica en texto lo que muestra el gráfico. Sé conciso y claro; usa Markdown.`;

export interface DbChatPart {
  name: string;
  profileText: string;
  /** A compact textual sample of the first rows. */
  sample: string;
  /** Rows in the whole table, and how many of them the sample shows. */
  rowCount: number;
  sampleSize: number;
}

export function buildDbChatContext(parts: DbChatPart[]): string {
  return parts
    .map(
      (p) =>
        `=== BASE DE DATOS: ${p.name} ===\n` +
        `--- PERFIL (calculado sobre las ${p.rowCount} filas) ---\n${p.profileText}\n\n` +
        `--- MUESTRA: ${p.sampleSize} filas de ejemplo de ${p.rowCount}. Solo ilustra el formato; no cuentes sobre ella ---\n` +
        `${p.sample || '(sin filas)'}`
    )
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
