import { findNativeBlock, nativeDocumentText, nativePlainText, type BlockNoteDocument } from './blockNoteDocument';
import type { StudyAnnotation } from './studyEditor';

/** Anchors survive block moves; older positional comments remain recoverable by text. */
export function resolveBlockAnnotations(annotations: StudyAnnotation[], document?: BlockNoteDocument | null): StudyAnnotation[] {
  if (!document) return annotations;
  const fullText = nativeDocumentText(document);
  return annotations.map(annotation => {
    const block = annotation.anchor && findNativeBlock(document, annotation.anchor.blockId);
    if (block) {
      const text = nativePlainText(block.content);
      if (!annotation.selectedText) return { ...annotation, anchorStatus: 'attached' };
      if (annotation.anchor && text.slice(annotation.anchor.from,annotation.anchor.to) === annotation.selectedText) return { ...annotation, anchorStatus: 'attached' };
      if (annotation.anchor?.endBlockId && annotation.anchor.endBlockId !== block.id) {
        const flat: Array<{ id: string; text: string }> = [];
        const visit = (blocks: BlockNoteDocument) => blocks.forEach(item => {flat.push({id:item.id,text:nativePlainText(item.content)});if(item.children) visit(item.children);}); visit(document);
        const start=flat.findIndex(item=>item.id===block.id); const end=flat.findIndex(item=>item.id===annotation.anchor?.endBlockId);
        if (end>=start && flat.slice(start,end+1).map(item=>item.text).join('\n').includes(annotation.selectedText)) return {...annotation,anchorStatus:'attached'};
      }
      const matches = text.split(annotation.selectedText).length - 1;
      return { ...annotation, anchorStatus: matches === 1 ? 'attached' : matches > 1 ? 'ambiguous' : 'missing' };
    }
    if (annotation.anchor) return { ...annotation, anchorStatus: 'missing' };
    const matches = annotation.selectedText ? fullText.split(annotation.selectedText).length - 1 : 0;
    return { ...annotation, anchorStatus: matches === 1 ? 'attached' : matches > 1 ? 'ambiguous' : 'missing' };
  });
}
