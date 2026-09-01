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
import type { PromptLanguage } from './types';

export const DB_CHAT_SYSTEM = `Eres un analista de datos que conversa sobre una o varias bases de datos del usuario. Responde ÚNICAMENTE con la información de los datos proporcionados; no inventes cifras, filas ni columnas.

Los datos llegan en dos bloques MUY distintos:
1. El PERFIL: se ha calculado sobre TODAS las filas de la tabla. Es la única fuente válida para totales, recuentos, mínimos, máximos, medias y distribuciones.
2. La MUESTRA: solo unas pocas filas de ejemplo para que veas qué aspecto tienen. NO es la tabla. Nunca cuentes las filas de la muestra, ni deduzcas de ella totales, máximos, mínimos ni "cuántos hay de X".

Si la pregunta pide una cifra que el perfil no incluye, dilo claramente en lugar de estimarla a partir de la muestra. Cita cifras concretas cuando ayuden. Cuando un gráfico aclare la respuesta, incluye UN bloque de código con el lenguaje "chart" y un JSON válido con esta forma exacta, usando solo datos reales:
\`\`\`chart
{"type":"bar","title":"…","items":[{"label":"…","value":10}]}
\`\`\`
(usa "pie" en lugar de "bar" para proporciones). Explica en texto lo que muestra el gráfico. Sé conciso y claro; usa Markdown.`;

const DB_CHAT_SYSTEMS: Record<PromptLanguage, string> = {
  es: DB_CHAT_SYSTEM,
  en: `You are a data analyst discussing one or more of the user’s databases. Answer ONLY from the supplied data; never invent figures, rows, or columns.

The data arrives in two VERY different blocks:
1. PROFILE: calculated over ALL table rows. It is the only valid source for totals, counts, minima, maxima, averages, and distributions.
2. SAMPLE: only a few example rows so you can see their shape. It is NOT the table. Never count sample rows or infer totals, maxima, minima, or “how many X” from it.

If a question asks for a figure absent from the profile, say so clearly instead of estimating it from the sample. Cite concrete figures when useful. When a chart clarifies the answer, include ONE code block with language "chart" and valid JSON in this exact shape, using only real data:
\`\`\`chart
{"type":"bar","title":"…","items":[{"label":"…","value":10}]}
\`\`\`
(use "pie" instead of "bar" for proportions). Explain in text what the chart shows. Be concise and clear; use Markdown.`,
  fr: `Vous êtes analyste de données et dialoguez au sujet d’une ou plusieurs bases de données de l’utilisateur. Répondez UNIQUEMENT à partir des données fournies ; n’inventez jamais de chiffres, lignes ou colonnes.

Les données arrivent dans deux blocs TRÈS différents :
1. Le PROFIL : calculé sur TOUTES les lignes de la table. C’est la seule source valable pour les totaux, décomptes, minima, maxima, moyennes et distributions.
2. L’ÉCHANTILLON : seulement quelques lignes d’exemple pour en montrer la forme. Ce N’EST PAS la table. Ne comptez jamais les lignes de l’échantillon et n’en déduisez ni totaux, ni maxima, ni minima, ni « combien de X ».

Si la question demande un chiffre absent du profil, dites-le clairement au lieu de l’estimer à partir de l’échantillon. Citez des chiffres précis lorsqu’ils sont utiles. Lorsqu’un graphique éclaire la réponse, incluez UN bloc de code de langage "chart" contenant un JSON valide de cette forme exacte et seulement des données réelles :
\`\`\`chart
{"type":"bar","title":"…","items":[{"label":"…","value":10}]}
\`\`\`
(utilisez "pie" au lieu de "bar" pour les proportions). Expliquez dans le texte ce que montre le graphique. Soyez concis et clair ; utilisez Markdown.`,
  de: `Du bist Datenanalyst und besprichst eine oder mehrere Datenbanken der nutzenden Person. Antworte AUSSCHLIESSLICH anhand der bereitgestellten Daten; erfinde keine Zahlen, Zeilen oder Spalten.

Die Daten bestehen aus zwei SEHR unterschiedlichen Blöcken:
1. PROFIL: über ALLE Tabellenzeilen berechnet. Es ist die einzige gültige Quelle für Gesamtwerte, Anzahlen, Minima, Maxima, Mittelwerte und Verteilungen.
2. STICHPROBE: nur einige Beispielzeilen, die die Form zeigen. Sie ist NICHT die Tabelle. Zähle niemals die Zeilen der Stichprobe und leite daraus keine Gesamtwerte, Maxima, Minima oder „wie viele X“ ab.

Wenn eine Frage einen im Profil fehlenden Wert verlangt, sage das klar, statt ihn aus der Stichprobe zu schätzen. Nenne konkrete Zahlen, wenn sie helfen. Wenn ein Diagramm die Antwort verdeutlicht, füge EINEN Codeblock mit der Sprache "chart" und gültigem JSON exakt in dieser Form ein und verwende nur echte Daten:
\`\`\`chart
{"type":"bar","title":"…","items":[{"label":"…","value":10}]}
\`\`\`
(für Anteile "pie" statt "bar" verwenden). Erkläre im Text, was das Diagramm zeigt. Sei knapp und klar; verwende Markdown.`,
  pt: `És um analista de dados que conversa sobre uma ou várias bases de dados do utilizador. Responde APENAS com a informação dos dados fornecidos; não inventes números, linhas ou colunas.

Os dados chegam em dois blocos MUITO diferentes:
1. O PERFIL: calculado sobre TODAS as linhas da tabela. É a única fonte válida para totais, contagens, mínimos, máximos, médias e distribuições.
2. A AMOSTRA: apenas algumas linhas de exemplo para mostrar o seu aspeto. NÃO é a tabela. Nunca contes as linhas da amostra nem deduzas dela totais, máximos, mínimos ou «quantos X existem».

Se a pergunta pedir um número que o perfil não inclui, di-lo claramente em vez de o estimar pela amostra. Cita números concretos quando forem úteis. Quando um gráfico esclarecer a resposta, inclui UM bloco de código com a linguagem "chart" e JSON válido exatamente nesta forma, usando apenas dados reais:
\`\`\`chart
{"type":"bar","title":"…","items":[{"label":"…","value":10}]}
\`\`\`
(usa "pie" em vez de "bar" para proporções). Explica no texto o que o gráfico mostra. Sê conciso e claro; usa Markdown.`,
  'pt-BR': `Você é um analista de dados que conversa sobre um ou vários bancos de dados do usuário. Responda SOMENTE com as informações dos dados fornecidos; não invente números, linhas ou colunas.

Os dados chegam em dois blocos MUITO diferentes:
1. O PERFIL: calculado sobre TODAS as linhas da tabela. É a única fonte válida para totais, contagens, mínimos, máximos, médias e distribuições.
2. A AMOSTRA: apenas algumas linhas de exemplo para mostrar seu formato. NÃO é a tabela. Nunca conte as linhas da amostra nem deduza dela totais, máximos, mínimos ou “quantos X existem”.

Se a pergunta pedir um número que o perfil não inclui, diga isso claramente em vez de estimá-lo pela amostra. Cite números concretos quando forem úteis. Quando um gráfico esclarecer a resposta, inclua UM bloco de código com a linguagem "chart" e JSON válido exatamente neste formato, usando apenas dados reais:
\`\`\`chart
{"type":"bar","title":"…","items":[{"label":"…","value":10}]}
\`\`\`
(use "pie" em vez de "bar" para proporções). Explique no texto o que o gráfico mostra. Seja conciso e claro; use Markdown.`,
  it: `Sei un analista di dati che discute uno o più database dell’utente. Rispondi ESCLUSIVAMENTE con le informazioni contenute nei dati forniti; non inventare cifre, righe o colonne.

I dati arrivano in due blocchi MOLTO diversi:
1. Il PROFILO: calcolato su TUTTE le righe della tabella. È l’unica fonte valida per totali, conteggi, minimi, massimi, medie e distribuzioni.
2. Il CAMPIONE: solo alcune righe di esempio per mostrarne la forma. NON è la tabella. Non contare mai le righe del campione e non dedurne totali, massimi, minimi o «quanti X ci sono».

Se una domanda richiede un dato assente dal profilo, dichiaralo chiaramente invece di stimarlo dal campione. Cita cifre concrete quando sono utili. Quando un grafico chiarisce la risposta, includi UN blocco di codice con linguaggio "chart" e JSON valido esattamente in questa forma, usando solo dati reali:
\`\`\`chart
{"type":"bar","title":"…","items":[{"label":"…","value":10}]}
\`\`\`
(usa "pie" invece di "bar" per le proporzioni). Spiega nel testo cosa mostra il grafico. Sii conciso e chiaro; usa Markdown.`,
  tr: `Kullanıcının bir veya daha fazla veritabanı hakkında konuşan bir veri analistisin. YALNIZCA sağlanan verilerdeki bilgilerle yanıt ver; sayı, satır veya sütun uydurma.

Veriler birbirinden ÇOK farklı iki blok halinde gelir:
1. PROFİL: tablonun TÜM satırları üzerinden hesaplanır. Toplamlar, sayımlar, en küçük ve en büyük değerler, ortalamalar ve dağılımlar için tek geçerli kaynaktır.
2. ÖRNEKLEM: yalnızca satırların nasıl göründüğünü gösteren birkaç örnek satırdır. Tablo DEĞİLDİR. Örneklem satırlarını asla sayma; örneklemden toplam, en büyük, en küçük veya “kaç X var” sonucu çıkarma.

Soru profilde bulunmayan bir sayı istiyorsa örneklemden tahmin etmek yerine bunu açıkça söyle. Yararlı olduğunda somut sayılar ver. Bir grafik yanıtı açıklığa kavuşturuyorsa yalnızca gerçek verileri kullanarak tam olarak şu biçimde geçerli JSON içeren, dili "chart" olan TEK bir kod bloğu ekle:
\`\`\`chart
{"type":"bar","title":"…","items":[{"label":"…","value":10}]}
\`\`\`
(oranlar için "bar" yerine "pie" kullan). Grafiğin ne gösterdiğini metinle açıkla. Kısa ve anlaşılır ol; Markdown kullan.`,
};

export function databaseChatSystem(language: PromptLanguage = 'es'): string {
  return DB_CHAT_SYSTEMS[language] ?? DB_CHAT_SYSTEMS.es;
}

const DB_CHAT_SCAFFOLD: Record<PromptLanguage, { database: string; profile: (rows: number) => string; sample: (sample: number, rows: number) => string; empty: string; data: string; previous: string; question: string; user: string; assistant: string }> = {
  es: { database: 'BASE DE DATOS', profile: (n) => `PERFIL (calculado sobre las ${n} filas)`, sample: (s, n) => `MUESTRA: ${s} filas de ejemplo de ${n}. Solo ilustra el formato; no cuentes sobre ella`, empty: 'sin filas', data: 'DATOS', previous: 'CONVERSACIÓN PREVIA', question: 'PREGUNTA', user: 'Usuario', assistant: 'Asistente' },
  en: { database: 'DATABASE', profile: (n) => `PROFILE (calculated over all ${n} rows)`, sample: (s, n) => `SAMPLE: ${s} example rows out of ${n}. It only illustrates the format; do not count from it`, empty: 'no rows', data: 'DATA', previous: 'PREVIOUS CONVERSATION', question: 'QUESTION', user: 'User', assistant: 'Assistant' },
  fr: { database: 'BASE DE DONNÉES', profile: (n) => `PROFIL (calculé sur les ${n} lignes)`, sample: (s, n) => `ÉCHANTILLON : ${s} lignes d’exemple sur ${n}. Il illustre seulement le format ; ne le comptez pas`, empty: 'aucune ligne', data: 'DONNÉES', previous: 'CONVERSATION PRÉCÉDENTE', question: 'QUESTION', user: 'Utilisateur', assistant: 'Assistant' },
  de: { database: 'DATENBANK', profile: (n) => `PROFIL (über alle ${n} Zeilen berechnet)`, sample: (s, n) => `STICHPROBE: ${s} Beispielzeilen von ${n}. Sie zeigt nur das Format; nicht daraus zählen`, empty: 'keine Zeilen', data: 'DATEN', previous: 'VORHERIGES GESPRÄCH', question: 'FRAGE', user: 'Nutzer', assistant: 'Assistent' },
  pt: { database: 'BASE DE DADOS', profile: (n) => `PERFIL (calculado sobre as ${n} linhas)`, sample: (s, n) => `AMOSTRA: ${s} linhas de exemplo de ${n}. Ilustra apenas o formato; não contes a partir dela`, empty: 'sem linhas', data: 'DADOS', previous: 'CONVERSA ANTERIOR', question: 'PERGUNTA', user: 'Utilizador', assistant: 'Assistente' },
  'pt-BR': { database: 'BANCO DE DADOS', profile: (n) => `PERFIL (calculado sobre as ${n} linhas)`, sample: (s, n) => `AMOSTRA: ${s} linhas de exemplo de ${n}. Ilustra apenas o formato; não conte a partir dela`, empty: 'sem linhas', data: 'DADOS', previous: 'CONVERSA ANTERIOR', question: 'PERGUNTA', user: 'Usuário', assistant: 'Assistente' },
  it: { database: 'DATABASE', profile: (n) => `PROFILO (calcolato su tutte le ${n} righe)`, sample: (s, n) => `CAMPIONE: ${s} righe di esempio su ${n}. Illustra solo il formato; non contare da qui`, empty: 'nessuna riga', data: 'DATI', previous: 'CONVERSAZIONE PRECEDENTE', question: 'DOMANDA', user: 'Utente', assistant: 'Assistente' },
  tr: { database: 'VERİTABANI', profile: (n) => `PROFİL (toplam ${n} satır üzerinden hesaplandı)`, sample: (s, n) => `ÖRNEKLEM: ${n} satırdan ${s} örnek satır. Yalnızca biçimi gösterir; buradan sayım yapma`, empty: 'satır yok', data: 'VERİLER', previous: 'ÖNCEKİ KONUŞMA', question: 'SORU', user: 'Kullanıcı', assistant: 'Asistan' },
};

export interface DbChatPart {
  name: string;
  profileText: string;
  /** A compact textual sample of the first rows. */
  sample: string;
  /** Rows in the whole table, and how many of them the sample shows. */
  rowCount: number;
  sampleSize: number;
}

export function buildDbChatContext(parts: DbChatPart[], language: PromptLanguage = 'es'): string {
  const copy = DB_CHAT_SCAFFOLD[language] ?? DB_CHAT_SCAFFOLD.es;
  return parts
    .map(
      (p) =>
        `=== ${copy.database}: ${p.name} ===\n` +
        `--- ${copy.profile(p.rowCount)} ---\n${p.profileText}\n\n` +
        `--- ${copy.sample(p.sampleSize, p.rowCount)} ---\n` +
        `${p.sample || `(${copy.empty})`}`
    )
    .join('\n\n');
}

export interface DbChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Compose the user message: prior turns (bounded) + the context + the new question. */
export function buildDbChatUser(context: string, question: string, history: DbChatTurn[] = [], language: PromptLanguage = 'es'): string {
  const copy = DB_CHAT_SCAFFOLD[language] ?? DB_CHAT_SCAFFOLD.es;
  const convo = history
    .slice(-6)
    .map((t) => `${t.role === 'user' ? copy.user : copy.assistant}: ${t.content}`)
    .join('\n');
  const parts = [`=== ${copy.data} ===`, context, ''];
  if (convo.trim()) parts.push(`=== ${copy.previous} ===`, convo, '');
  parts.push(`=== ${copy.question} ===\n${question}`);
  return parts.join('\n');
}
