import { createChatOrganizer } from './chatOrganizerRepo';
import { RESEARCH_CHAT_TABLES } from './chatHistoryTables';

/*
 * Research chat projects, their folders and pins: the shared chat organizer over the
 * research chat's tables. The same rules and refusals hold for every chat history kept in
 * the vault's database; see chatOrganizerRepo.ts.
 */
const research = createChatOrganizer(RESEARCH_CHAT_TABLES);

export const {
  listChatProjects, getChatProject, createChatProject, updateChatProject, deleteChatProject,
  listChatProjectFolders, getChatProjectFolder, createChatProjectFolder, renameChatProjectFolder, moveChatProjectFolder, deleteChatProjectFolder,
  placementFor, setConversationProject, setConversationFolder, setConversationPinned, deleteConversationPlacement,
} = research;
