import type { BlockNoteDocument } from '@shared/blockNoteDocument';

export interface EditorialDraft {
  academicMetadata?: import('@shared/academicDocument').AcademicMetadata;
  title: string;
  contentMarkdown: string;
  nativeDocument: BlockNoteDocument | null;
  revision: number;
  style?: unknown;
  savedAt: string;
}
const key = (scope: string, id: string) => `nodus.editorialDraft.${scope}.${id}`;
export function readEditorialDraft(scope: string, id: string): EditorialDraft | null {
  try { const value = JSON.parse(localStorage.getItem(key(scope,id)) ?? 'null'); return value && typeof value.title === 'string' && typeof value.contentMarkdown === 'string' ? value : null; } catch { return null; }
}
export function retainEditorialDraft(scope: string, id: string, draft: Omit<EditorialDraft,'savedAt'>): void {
  try { localStorage.setItem(key(scope,id), JSON.stringify({...draft,savedAt:new Date().toISOString()})); } catch { /* The live draft remains available for download when storage is full. */ }
}
export function clearEditorialDraft(scope: string, id: string): void {
  try { localStorage.removeItem(key(scope,id)); } catch { /* private browser storage may be disabled */ }
}
export function downloadEditorialDraft(draft: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'}));
  const link = document.createElement('a'); link.href=url; link.download='borrador-nodus.json'; link.click(); URL.revokeObjectURL(url);
}
