import { completeTextStream } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { getActiveVault, listVaults } from '../vaults/vaultRegistry';
import { resolveModelRef } from './aiClient';
import type { NodiChatRequest } from '@shared/types';

const VAULT_TYPE_LABEL: Record<string, string> = {
  standard: 'investigación académica',
  genealogy: 'genealogía',
  databases: 'bases de datos',
  primary_sources: 'fuentes primarias',
};

// A deliberately compact system prompt: enough for Nodi to explain Nodus and the
// user's current configuration, without spending much context.
function buildSystemPrompt(allVaults: boolean): string {
  const s = getSettings();
  const active = getActiveVault();
  const lang = s.uiLanguage === 'en' ? 'English' : 'Spanish';
  const chat = resolveModelRef(s.chatModel);

  const lines: string[] = [
    'Eres Nodi, la mascota y asistente de Nodus: un nodo de luz curioso, cálido y conciso.',
    'Nodus es un espacio de investigación académica local-first (todos los datos viven en el equipo del usuario).',
    'Capacidades de Nodus que puedes explicar: analiza obras de Zotero para extraer ideas, temas y conexiones; grafo de conocimiento; fichas y matriz de autores; debates y contradicciones; huecos de investigación; Deep Research (informes citados); modo Inmersión; taller de escritura; tutor; genealogía (árboles y archivo); bases de datos tipo Notion; búsqueda semántica; narración por voz (TTS); servidor MCP y copiloto de Word/LibreOffice.',
    'Tus propias funciones como acompañante: chat contigo, centro de notificaciones y ayuda. (Por ahora eres sobre todo visual; el resto de acciones aún se están cableando.)',
    `Configuración actual — Bóveda activa: "${active.name}" (tipo: ${VAULT_TYPE_LABEL[active.type] ?? active.type}). Idioma de interfaz: ${s.uiLanguage}. Modelo de chat: ${chat.provider}/${chat.model}. Tema: ${s.theme}.`,
  ];
  if (allVaults) {
    const vaults = listVaults();
    lines.push(
      `El usuario tiene ${vaults.length} bóveda(s): ${vaults
        .map((v) => `"${v.name}" (${VAULT_TYPE_LABEL[v.type] ?? v.type})`)
        .join(', ')}. Puedes razonar sobre todas ellas, pero solo tienes acceso a datos de la bóveda activa.`
    );
  }
  lines.push(
    `Responde SIEMPRE en el mismo idioma en el que te escribe el usuario en su último mensaje (si no queda claro, usa ${lang}). Sé breve y útil (2-5 frases salvo que pidan más). No inventes datos concretos del corpus del usuario que no conozcas; si no lo sabes, dilo y sugiere dónde mirarlo en Nodus.`
  );
  return lines.join('\n');
}

export async function streamNodiChat(
  request: NodiChatRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const system = buildSystemPrompt(request.allVaults);
  const transcript = request.messages
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Nodi'}: ${m.content}`)
    .join('\n\n');
  const user = `${transcript}\n\nNodi:`;
  const s = getSettings();
  return completeTextStream(
    { system, user, maxTokens: 900, temperature: 0.5, reasoning: 'off' },
    (delta, kind) => {
      if (kind === 'content') onDelta(delta);
    },
    s.chatModel,
    signal
  );
}
