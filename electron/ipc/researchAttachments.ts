import fs from 'node:fs';
import path from 'node:path';
import { dialog } from 'electron';
import type { IpcContext } from './context';
import type { ResearchAttachmentOwner, ResearchAttachmentImportResult } from '../../shared/researchAttachments';
import { activeVaultDir } from '../vaults/vaultRegistry';
import { getConversation } from '../db/chatRepo';
import { getDatabaseChatConversation } from '../db/databaseChatRepo';
import { getWorldChatConversation } from '../db/worldChatRepo';
import { getStudyAssistantConversation } from '../ai/studyAssistant';
import { importResearchAttachment, listResearchAttachments, removeResearchAttachment, researchAttachmentOriginal } from '../researchAttachments';
function conversation(owner: ResearchAttachmentOwner): { messages: Array<{ attachments?: Array<{ id: string }> }> } {
  const readers = { research: getConversation, database: getDatabaseChatConversation, world: getWorldChatConversation, study: getStudyAssistantConversation };
  const chat = owner && Object.hasOwn(readers, owner.surface) ? readers[owner.surface](owner.conversationId) : null;
  if (!chat) throw new Error('La conversación ya no está disponible.');
  return chat;
}
export function registerResearchAttachmentIpc({ h, getWindow }: IpcContext): void {
  h('research:attachments:pick', async (_event, owner: ResearchAttachmentOwner) => {
    conversation(owner);
    const vaultDir = activeVaultDir();
    const current = () => activeVaultDir() === vaultDir && Boolean(conversation(owner));
    const result = await dialog.showOpenDialog(getWindow() ?? undefined!, { properties: ['openFile', 'multiSelections'] });
    return importFiles(owner, result.canceled ? [] : result.filePaths, current);
  });
  h('research:attachments:import', async (_event, owner: ResearchAttachmentOwner, filePaths: string[]) => {
    conversation(owner);
    if (!Array.isArray(filePaths) || filePaths.some(file => typeof file !== 'string' || !path.isAbsolute(file))) {
      throw new Error('Elige archivos de tu equipo.');
    }
    const vaultDir = activeVaultDir();
    return importFiles(owner, filePaths, () => activeVaultDir() === vaultDir && Boolean(conversation(owner)));
  });
  h('research:attachments:list', (_event, owner: ResearchAttachmentOwner) => { conversation(owner); return listResearchAttachments(owner); });
  h('research:attachments:remove', (_event, owner: ResearchAttachmentOwner, id: string) => {
    if (conversation(owner).messages.some(message => message.attachments?.some(file => file.id === id))) throw new Error('Este adjunto forma parte del historial. Elimina la conversación para borrarlo.');
    removeResearchAttachment(owner, id);
  });
  h('research:attachments:save', async (_event, owner: ResearchAttachmentOwner, id: string) => {
    conversation(owner);
    const original = researchAttachmentOriginal(owner, id);
    const result = await dialog.showSaveDialog(getWindow() ?? undefined!, { defaultPath: original.name });
    if (!result.canceled && result.filePath) await fs.promises.copyFile(original.path, result.filePath);
  });
}

/** Picker and drop imports share extraction, limits and conversation/vault guards. */
async function importFiles(owner: ResearchAttachmentOwner, filePaths: string[], current: () => boolean): Promise<ResearchAttachmentImportResult> {
  const output: ResearchAttachmentImportResult = { attachments: [], errors: [] };
  for (const file of [...new Set(filePaths)]) {
    try { output.attachments.push(await importResearchAttachment(owner, file, current)); }
    catch (error) { output.errors.push(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return output;
}
