/** File attachments belong exclusively to a Research chat conversation. */
export type ResearchAttachmentSurface = 'research' | 'database' | 'study' | 'world';
export interface ResearchAttachmentOwner {
  surface: ResearchAttachmentSurface;
  conversationId: string;
}
export interface ResearchAttachment {
  id: string;
  name: string;
  size: number;
  kind: 'text' | 'image' | 'pdf' | 'unsupported';
  textChars: number;
  imageCount: number;
  warning?: string;
}
export interface ResearchAttachmentImportResult {
  attachments: ResearchAttachment[];
  errors: string[];
}
