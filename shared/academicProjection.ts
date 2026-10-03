import { blockNoteToMarkdown, type BlockNoteDocument } from './blockNoteDocument';
import { academicInlines, normalizeAcademicMetadata, parseAcademicCitation } from './academicDocument';
import { formatAcademicSnapshot, singleAcademicSnapshot } from './academicCsl';

/** Readable projection for search, MCP and old readers; native JSON remains authoritative. */
export function academicMarkdownProjection(document:BlockNoteDocument, value:unknown):string {
 const metadata=normalizeAcademicMetadata(value);
 let markdown=blockNoteToMarkdown(document);
 try {
  const formatted=formatAcademicSnapshot(singleAcademicSnapshot('projection','Documento',document,metadata));
  for(const {inline} of academicInlines(document)) {
   const citation=parseAcademicCitation(inline);if(!citation)continue;
   const label=formatted.citations.find(c=>c.citationId===citation.citationId)?.text??String(inline.props?.label??'');
   const marker=`<!--nodus:inline:${encodeURIComponent(JSON.stringify(inline))}-->`;
   const start=markdown.indexOf(marker),end=markdown.indexOf('<!--/nodus:inline-->',start);
   if(start>=0&&end>=0)markdown=markdown.slice(0,start+marker.length)+label+markdown.slice(end);
  }
  const notes:string[]=[],seen=new Set<string>();
  for(const {inline} of academicInlines(document))if(inline.type==='nodusFootnote') {
   const id=String(inline.props?.noteId),note=metadata.notes[id];if(!note||seen.has(id))continue;seen.add(id);
   notes.push(`[^${seen.size}]: ${blockNoteToMarkdown(note.document).replace(/\n/g,'\n    ')}`);
  }
  const bibliography=formatted.bibliography?.text.trim();
  if(notes.length||bibliography)markdown+=`\n\n<!--nodus:academic-projection-->\n${notes.join('\n\n')}${bibliography?'\n\n## Bibliografía\n\n'+bibliography:''}\n<!--/nodus:academic-projection-->`;
 }catch{/* Incomplete citations remain editable; the delivery checker reports the cause. */}
 return markdown.trimEnd();
}

export function assertAcademicSupplement(previous:string,next:string):void {
 const section=(value:string)=>value.match(/<!--nodus:academic-projection-->[\s\S]*?<!--\/nodus:academic-projection-->/)?.[0];
 const before=section(previous),after=section(next);
 if(before&&after&&before!==after)throw new Error('ACADEMIC_PROJECTION_CONFLICT: Edita las notas y la bibliografía desde el contexto académico.');
}
