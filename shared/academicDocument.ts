import type { BlockNoteDocument, NativeBlock, NativeInline } from './blockNoteDocument';
import { nativePlainText, validateBlockNoteDocument } from './blockNoteDocument';
import type { LibraryItemMetadata } from './libraryTypes';
import type { OfficeCitationCluster, OfficeCitationDocumentResult } from './officeCitationTypes';

export interface AcademicSource {
  id: string; scope: 'vault' | 'global' | 'snapshot'; refId: string;
  citationKey: string | null; metadata: LibraryItemMetadata;
  href?: string; aliases?: string[];
}
export interface AcademicCitation extends OfficeCitationCluster { sources: AcademicSource[] }
export interface AcademicEvidence {
  id: string; blockId: string; text: string; sourceHref?: string;
  pageLabel?: string; physicalPage?: number;
  status: 'needs-source' | 'pending' | 'checked';
  checkedText?: string; checkedSource?: string;
}
export interface AcademicChapter { documentId: string; kind: 'note' | 'study'; title: string; included: boolean }
export interface AcademicMetadata {
  formatVersion: 1;
  style: string; customStyleXml?:string;customStyleTitle?:string; locale: string; placement: 'in-text' | 'footnote' | 'endnote';
  notes: Record<string, { document: BlockNoteDocument; placement: 'footnote' | 'endnote' }>;
  evidence: AcademicEvidence[];
  manuscript?: {
    kind: 'paper' | 'chapter' | 'thesis'; chapters: AcademicChapter[];
    authors: string; abstract: string; keywords: string; includeContents: boolean;
    paper: 'A4' | 'Letter'; marginMm: number;
  };
}
export const DEFAULT_ACADEMIC_METADATA: AcademicMetadata = {
  formatVersion: 1, style: 'apa', locale: 'es-ES', placement: 'in-text', notes: {}, evidence: [],
};
export function normalizeAcademicMetadata(value: unknown): AcademicMetadata {
  if (value == null) return structuredClone(DEFAULT_ACADEMIC_METADATA);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Metadatos académicos inválidos.');
  const input = value as AcademicMetadata;
  if (input.formatVersion !== 1) throw new Error('Versión académica no compatible. Conserva el borrador.');
  if (JSON.stringify(input).length > 2_000_000) throw new Error('Los metadatos académicos superan el límite permitido.');
  if (!['in-text', 'footnote', 'endnote'].includes(input.placement) || typeof input.style !== 'string' || !input.style || typeof input.locale !== 'string') throw new Error('Preferencias bibliográficas inválidas.');
  if(input.customStyleXml&&(typeof input.customStyleXml!=='string'||input.customStyleXml.length>1_000_000||/<!DOCTYPE|<!ENTITY/i.test(input.customStyleXml)||!/<citation[\s>]/.test(input.customStyleXml)))throw new Error('El estilo CSL debe ser independiente, sin entidades externas y menor de 1 MB.');
  const notes: AcademicMetadata['notes'] = {};
  for (const [id, note] of Object.entries(input.notes ?? {})) {
    if(['__proto__','constructor','prototype'].includes(id))throw new Error('Identificador de nota inválido.');
    if (!['footnote', 'endnote'].includes(note.placement)) throw new Error('Tipo de nota inválido.');
    notes[id] = { document: validateBlockNoteDocument(note.document), placement: note.placement };
  }
  const evidence = (input.evidence ?? []).map(entry => {
    if (entry.sourceHref && !/^nodus:\/\/(idea|passage|work)\/[^\s]+$/.test(entry.sourceHref)) throw new Error('Destino de evidencia inválido.');
    if (entry.physicalPage != null && (!Number.isInteger(entry.physicalPage)||entry.physicalPage<1)) throw new Error('Página física inválida.');
    if (typeof entry.id !== 'string' || typeof entry.blockId !== 'string' || typeof entry.text !== 'string' || !['needs-source','pending','checked'].includes(entry.status)) throw new Error('Anclaje de evidencia inválido.');
    return { ...entry };
  });
  const manuscript = input.manuscript ? { ...input.manuscript, chapters: input.manuscript.chapters.map(chapter => {
    if (!chapter.documentId || !['note','study'].includes(chapter.kind) || typeof chapter.title !== 'string') throw new Error('Capítulo inválido.');
    return { ...chapter, included: chapter.included !== false };
  }) } : undefined;
  if(manuscript&&(![manuscript.authors,manuscript.abstract,manuscript.keywords].every(value=>typeof value==='string')||typeof manuscript.includeContents!=='boolean'))throw new Error('Datos de portada inválidos.');
  if (manuscript && (!['paper','chapter','thesis'].includes(manuscript.kind) || !['A4','Letter'].includes(manuscript.paper) || !Number.isFinite(manuscript.marginMm) || manuscript.marginMm < 10 || manuscript.marginMm > 50 || new Set(manuscript.chapters.map(ch=>`${ch.kind}:${ch.documentId}`)).size !== manuscript.chapters.length)) throw new Error('Configuración de manuscrito inválida.');
  return { formatVersion: 1, style: input.style, ...(input.customStyleXml?{customStyleXml:input.customStyleXml,customStyleTitle:String(input.customStyleTitle??'CSL').slice(0,200)}:{}), locale: input.locale, placement: input.placement, notes, evidence, ...(manuscript ? { manuscript } : {}) };
}
export function academicBlocks(document: BlockNoteDocument): NativeBlock[] { return document.flatMap(block => [block, ...academicBlocks(block.children ?? [])]); }
export function academicHeadingLevel(document: BlockNoteDocument, level: number, composed: boolean): number {
  const minimum = Math.min(...academicBlocks(document).filter(block => block.type === 'heading').map(block => Number(block.props.level) || 1), 6);
  return Math.min(6, Math.max(1, (level || 1) - minimum + 1 + (composed ? 1 : 0)));
}
export function academicInlines(document: BlockNoteDocument): Array<{ blockId: string; inline: NativeInline }> {
  const result: Array<{ blockId: string; inline: NativeInline }> = [];
  const visit = (content: unknown, blockId: string) => {
    if (Array.isArray(content)) for (const inline of content as NativeInline[]) { result.push({ blockId, inline }); if (inline.content) visit(inline.content, blockId); }
    else if (content && typeof content === 'object') for (const row of (content as { rows?: Array<{ cells: unknown[] }> }).rows ?? []) for (const cell of row.cells) visit(Array.isArray(cell) ? cell : (cell as { content?: unknown }).content, blockId);
  };
  for (const block of academicBlocks(document)) visit(block.content, block.id);
  return result;
}
export function parseAcademicCitation(inline: NativeInline): AcademicCitation | null {
  if (inline.type !== 'nodusCitation') return null;
  try {
    const citation = JSON.parse(String(inline.props?.payload ?? '')) as AcademicCitation;
    if (!citation.citationId || !Array.isArray(citation.citationItems) || !citation.citationItems.length || !Array.isArray(citation.sources)) return null;
    for (const item of citation.citationItems) if (!citation.sources.some(source => source.id === item.id && source.metadata?.title && Array.isArray(source.metadata.creators))) return null;
    return citation;
  } catch { return null; }
}
/** Refresh a source snapshot consistently without changing citation or block identifiers. */
export function reconcileAcademicSources(document: BlockNoteDocument, sources: AcademicSource[], replacement?: AcademicCitation): BlockNoteDocument {
  const copy = structuredClone(document), byId = new Map(sources.map(source => [source.id, source]));
  for (const { inline } of academicInlines(copy)) {
    const citation = parseAcademicCitation(inline);
    if (!citation) continue;
    const next = citation.citationId === replacement?.citationId ? replacement : {
      ...citation, sources: citation.sources.map(source => byId.get(source.id) ?? source),
      citationItems: citation.citationItems.map(item => byId.has(item.id) ? { ...item, snapshot: { citationKey: byId.get(item.id)!.citationKey, metadata: byId.get(item.id)!.metadata } } : item),
    };
    inline.props = { ...inline.props, payload: JSON.stringify(next) };
  }
  return copy;
}
export function academicCitations(document: BlockNoteDocument, metadata?: AcademicMetadata): AcademicCitation[] {
  const citations: AcademicCitation[] = [];
  const visited = new Set<string>();
  const visit = (doc: BlockNoteDocument) => {
    for (const { inline } of academicInlines(doc)) {
      const citation = parseAcademicCitation(inline);
      if (citation) citations.push(citation);
      if (inline.type === 'nodusFootnote') {
        const id = String(inline.props?.noteId ?? '');
        if (metadata?.notes[id] && !visited.has(id)) { visited.add(id); visit(metadata.notes[id].document); }
      }
    }
  };
  visit(document);
  return citations.map((citation,index) => ({ ...citation, noteIndex: citation.placement === 'in-text' ? 0 : index+1 }));
}
export interface AcademicIssue { id: string; severity: 'error' | 'warning'; message: string; blockId?: string; href?: string }
export function checkAcademicDocument(document: BlockNoteDocument, metadata: AcademicMetadata, unresolvedComments = 0, externalTargets?:Set<string>): AcademicIssue[] {
  const blocks = new Map(academicBlocks(document).map(block=>[block.id,block]));
  const issues: AcademicIssue[] = [];
  const add = (severity: AcademicIssue['severity'], message: string, blockId?: string) => issues.push({ id: `${issues.length}:${blockId ?? ''}`, severity, message, blockId });
  const citationIds = new Set<string>();
  const noteCalls = new Set<string>();
  for (const { blockId, inline } of academicInlines(document)) {
    if (inline.type === 'nodusCitation') {
      const citation = parseAcademicCitation(inline);
      if (!citation) add('error','Cita sin una fuente bibliográfica recuperable.',blockId);
      else {
        if (citationIds.has(citation.citationId)) add('error','Identificador de cita duplicado.',blockId);
        citationIds.add(citation.citationId);
        for (const source of citation.sources) {
          if (!source.metadata.title) add('error','Fuente sin título.',blockId);
          if(source.metadata.itemType==='book'&&!source.metadata.publisher)add('warning','Fuente de tipo libro pendiente de editorial.',blockId);
          if(['article-journal','journal-article','chapter','book-chapter','book-section'].includes(source.metadata.itemType)&&!source.metadata.publicationTitle)add('warning','Fuente pendiente de revista o libro contenedor.',blockId);
          if (!source.metadata.creators.length || !source.metadata.year) add('warning','Revisa la autoría o fecha de la fuente.',blockId);
        }
      }
    }
    if (inline.type === 'nodusCrossReference' && !blocks.has(String(inline.props?.targetId)) && !externalTargets?.has(String(inline.props?.targetId))) add(inline.props?.documentId&&!externalTargets?'warning':'error','Referencia cruzada sin destino en el documento abierto; se comprobará en el manuscrito.',blockId);
    if (inline.type === 'nodusFootnote') {
      const id = String(inline.props?.noteId ?? ''); noteCalls.add(id);
      if (!metadata.notes[id]) add('error','Llamada de nota sin contenido.',blockId);
      else {
        if (academicInlines(metadata.notes[id].document).some(item => item.inline.type === 'nodusFootnote')) add('error','Una nota contiene otra nota anidada.',blockId);
        const noteIssues=checkAcademicDocument(metadata.notes[id].document,{...metadata,notes:{},evidence:[]},0,externalTargets);issues.push(...noteIssues.map(issue=>({...issue,id:'note:'+id+':'+issue.id,blockId})));
      }
    }
  }
  for (const id of Object.keys(metadata.notes)) if (!noteCalls.has(id)) add('warning','Nota sin llamada en el documento.');
  for (const evidence of metadata.evidence) {
    const block = blocks.get(evidence.blockId);
    const attached = block && nativePlainText(block.content).includes(evidence.text);
    if (!attached) add('warning','El anclaje de una comprobación necesita revisión.', evidence.blockId);
    else if (evidence.status !== 'checked' || evidence.checkedText !== evidence.text || evidence.checkedSource !== academicEvidenceIdentity(evidence)) add('warning', evidence.status === 'needs-source' ? 'Fragmento pendiente de fuente.' : 'Fragmento pendiente de comprobar.', evidence.blockId);
  }
  for (const block of blocks.values()) {
    if(['image','table'].includes(block.type)&&!block.props.caption)add('warning',block.type==='image'?'Figura pendiente de pie.':'Tabla pendiente de título.',block.id);
    if (['image','file','audio','video'].includes(block.type) && !block.props.url) add('error','Recurso adjunto sin archivo.',block.id);
    if (['audio','video','file'].includes(block.type)) add('warning','El recurso interactivo se entregará como archivo adjunto.',block.id);
    if (!['paragraph','heading','bulletListItem','numberedListItem','checkListItem','quote','codeBlock','image','table','audio','video','file'].includes(block.type)) add('error','Bloque de compatibilidad: conviértelo antes de la entrega académica.',block.id);
  }
  if (unresolvedComments) add('warning',`${unresolvedComments} comentarios sin resolver.`);
  return issues;
}
export interface AcademicSnapshot {
  formatVersion: 1; title: string; generatedAt: string; metadata: AcademicMetadata;
  chapters: Array<{ id: string; title: string; revision: number; unresolvedComments?:number; document: BlockNoteDocument; metadata: AcademicMetadata }>;
}
export interface CompiledAcademicDocument {
  snapshot: AcademicSnapshot; references: OfficeCitationDocumentResult; issues: AcademicIssue[];
}
export type AcademicExportFormat = 'docx' | 'pdf' | 'latex';
export function citationInline(citation: AcademicCitation): NativeInline {
  return { type: 'nodusCitation', props: { payload: JSON.stringify(citation), label: citation.sources.map(source=>source.metadata.title).join('; ') } };
}

/** Documents reached by note calls, in reading order, for assets and technical checks. */
export function academicContentDocuments(chapter:AcademicSnapshot['chapters'][number]):BlockNoteDocument[] {
  const result=[chapter.document],seen=new Set<string>();
  for(const document of result) for(const {inline} of academicInlines(document)) if(inline.type==='nodusFootnote') {
    const id=String(inline.props?.noteId);const note=chapter.metadata.notes[id];
    if(note&&!seen.has(id)){seen.add(id);result.push(note.document);}
  }
  return result;
}
export function academicTargets(snapshot:AcademicSnapshot):Map<string,{label:string;chapterId:string}> {
  const result=new Map<string,{label:string;chapterId:string}>();let figure=0,table=0;
  for(const [chapterIndex,chapter] of snapshot.chapters.entries()) {
    const levels=Array(6).fill(0);
    for(const block of academicBlocks(chapter.document)) {
      let label=nativePlainText(block.content);
      if(block.type==='heading') {
        const level=Math.max(0,Math.min(5,Number(block.props.level||1)-1));levels[level]++;levels.fill(0,level+1);
        const section=levels.slice(0,level+1).filter(n=>n>0).join('.');
        label=(snapshot.chapters.length>1?`${chapterIndex+1}.`:'')+section+' '+label;
      }
      if(block.type==='image')label=`Figura ${++figure}`+(block.props.caption?'. '+block.props.caption:'');
      if(block.type==='table')label=`Tabla ${++table}`+(block.props.caption?'. '+block.props.caption:'');
      result.set(block.id,{label,chapterId:chapter.id});
    }
  }
  return result;
}
/** Number every actual note call, including citations inside explanatory notes. */
export function academicCitationSequence(snapshot:AcademicSnapshot):AcademicCitation[] {
  let noteNo=0;const citations:AcademicCitation[]=[];
  for(const chapter of snapshot.chapters) {
    const visit=(doc:BlockNoteDocument,inNote=false)=>{
      for(const {inline} of academicInlines(doc)) {
        const citation=parseAcademicCitation(inline);
        if(citation)citations.push({...citation,noteIndex:inNote?noteNo:snapshot.metadata.placement==='in-text'?0:++noteNo});
        if(inline.type==='nodusFootnote'&&!inNote){noteNo++;const note=chapter.metadata.notes[String(inline.props?.noteId)];if(note)visit(note.document,true);}
      }
    };visit(chapter.document);
  }
  return citations;
}
export function academicScaffold(kind:'paper'|'chapter'|'thesis'):string {
  const titles=kind==='paper'?['Introducción','Método y fuentes','Resultados','Discusión','Conclusiones']:kind==='chapter'?['Introducción','Desarrollo','Conclusiones']:['Introducción y objetivos','Estado de la cuestión','Marco teórico','Metodología y fuentes','Análisis','Discusión','Conclusiones'];
  return titles.map(title=>`## ${title}\n\n`).join('\n');
}

/** Duplicate academic documents without reusing block, note or citation identities. */
export function cloneAcademicDocument(document:BlockNoteDocument,value:unknown):{document:BlockNoteDocument;metadata:AcademicMetadata} {
 const metadata=normalizeAcademicMetadata(value),copy=structuredClone(document),ids=new Map<string,string>(),notes=new Map<string,string>();
 for(const doc of [copy,...Object.values(metadata.notes).map(note=>note.document)])for(const block of academicBlocks(doc))ids.set(block.id,crypto.randomUUID());
 for(const id of Object.keys(metadata.notes))notes.set(id,crypto.randomUUID());
 const rewrite=(doc:BlockNoteDocument)=>{
  for(const block of academicBlocks(doc))block.id=ids.get(block.id)!;
  for(const {inline} of academicInlines(doc)){
   if(inline.type==='nodusCrossReference'&&ids.has(String(inline.props?.targetId))){inline.props!.targetId=ids.get(String(inline.props!.targetId));inline.props!.documentId='';}
   if(inline.type==='nodusFootnote'&&notes.has(String(inline.props?.noteId)))inline.props!.noteId=notes.get(String(inline.props!.noteId));
   const citation=parseAcademicCitation(inline);if(citation)inline.props!.payload=JSON.stringify({...citation,citationId:crypto.randomUUID()});
  }
 };
 rewrite(copy);
 metadata.notes=Object.fromEntries(Object.entries(metadata.notes).map(([id,note])=>{rewrite(note.document);return [notes.get(id)!,note];}));
 metadata.evidence=metadata.evidence.map(evidence=>({...evidence,id:crypto.randomUUID(),blockId:ids.get(evidence.blockId)??evidence.blockId}));
 return {document:copy,metadata};
}

export function academicHasContent(document:BlockNoteDocument):boolean{return academicBlocks(document).some(block=>Boolean(nativePlainText(block.content).trim())||['image','table','audio','video','file'].includes(block.type));}

export function academicEvidenceIdentity(evidence:AcademicEvidence):string{return evidence.pageLabel||evidence.physicalPage?JSON.stringify([evidence.sourceHref??'',evidence.pageLabel??'',evidence.physicalPage??null]):evidence.sourceHref??'';}
