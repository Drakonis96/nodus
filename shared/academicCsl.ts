// Same citeproc engine and metadata mapping as the Office integrations; browser-safe and offline.
import CSL from 'citeproc';
import locales from '@citation-js/plugin-csl/lib/locales.json';
import styles from '@citation-js/plugin-csl/lib/styles.json';
import officialStyles from './academicCslStyles.json';
import { libraryItemCslData } from './libraryCslData';
import type { LibraryItemRecord } from './libraryTypes';
import { academicCitationSequence, type AcademicMetadata, type AcademicSnapshot } from './academicDocument';
import type { OfficeCitationDocumentResult } from './officeCitationTypes';
export const ACADEMIC_STYLES = [
  { id: 'apa', title: 'APA', placement: 'in-text' },
  { id: 'vancouver', title: 'Vancouver', placement: 'in-text' },
  { id: 'harvard1', title: 'Harvard', placement: 'in-text' },
  { id: 'chicago-author-date', title: 'Chicago · autor-fecha', placement: 'in-text' },
  { id: 'chicago-notes-bibliography', title: 'Chicago · notas', placement: 'footnote' },
] as const;
export function academicStyleXml(style: string): string {
  const xml = (officialStyles as Record<string,string>)[style] ?? (styles as Record<string,string>)[style];
  if (!xml) throw new Error('El estilo bibliográfico no está disponible sin conexión.');
  return xml;
}
// Save/load/projection may format the same citation sequence several times in a
// transaction. A bounded semantic cache keeps that work off repeated saves;
// text, block order unrelated to citations and document titles do not affect CSL.
const formattingCache = new Map<string, OfficeCitationDocumentResult>();
export function formatAcademicSnapshot(snapshot: AcademicSnapshot, customStyleXml?: string): OfficeCitationDocumentResult {
  const metadata = snapshot.metadata;
  let citations = academicCitationSequence(snapshot);
  const xml = customStyleXml ?? metadata.customStyleXml ?? academicStyleXml(metadata.style);
  const key = JSON.stringify([metadata.style,metadata.customStyleTitle,metadata.locale,xml,citations]);
  const cached = formattingCache.get(key);
  if (cached) { formattingCache.delete(key); formattingCache.set(key,cached); return structuredClone(cached); }
  const sources = new Map<string,import('./academicDocument').AcademicSource>();
  for(const source of citations.flatMap(citation=>citation.sources)) {
    const previous=sources.get(source.id);
    if(previous&&JSON.stringify(previous.metadata)!==JSON.stringify(source.metadata))throw new Error('Hay versiones diferentes de una fuente. Actualiza sus citas antes de exportar.');
    sources.set(source.id,source);
  }
  const aliases=new Map<string,string>(),doiIds=new Map<string,string>();
  for(const [id,source] of sources){const doi=source.metadata.doi?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//,'');if(!doi)continue;const primary=doiIds.get(doi);if(primary){aliases.set(id,primary);sources.delete(id);}else doiIds.set(doi,id);}
  citations=citations.map(citation=>({...citation,citationItems:citation.citationItems.map(item=>({...item,id:aliases.get(item.id)??item.id})).filter((item,index,items)=>items.findIndex(entry=>entry.id===item.id)===index)}));
  const items = Object.fromEntries([...sources].map(([id,source])=>[id,libraryItemCslData({id, metadata:source.metadata} as LibraryItemRecord)]));
  const run = (mode: 'text'|'html') => {
    const engine = new (CSL as any).Engine({ retrieveItem: (id:string)=>items[id], retrieveLocale: (language:string)=> {
      const available = locales as Record<string,string>;
      const key = Object.keys(available).find(key=>key.toLowerCase()===language.toLowerCase()) ?? Object.keys(available).find(key=>key.startsWith(language.split('-')[0]+'-')) ?? 'en-US';
      return available[key];
    } },xml,metadata.locale);
    const output: Array<[string,number,string]> = engine.rebuildProcessorState(citations.map(citation=>({citationID:citation.citationId,citationItems:citation.citationItems,properties:{noteIndex:citation.noteIndex}})),mode);
    engine.setOutputFormat(mode);
    const bibliography = engine.makeBibliography();
    return { citations: new Map(output.map(([id,,text])=>[id,text])), bibliography: bibliography ? (mode==='html'?`${bibliography[0].bibstart ?? ''}${bibliography[1].join('')}${bibliography[0].bibend ?? ''}`:bibliography[1].join('')) : '' };
  };
  const empty = {citations:new Map<string,string>(),bibliography:''};
  // Known bundled styles are already validated; custom XML still goes through
  // the engines so invalid imports remain errors even in an empty document.
  const noCitations = citations.length === 0 && !customStyleXml && !metadata.customStyleXml;
  const text = noCitations ? empty : run('text'), html = noCitations ? empty : run('html');
  const result: OfficeCitationDocumentResult = { style:metadata.style, styleTitle: ACADEMIC_STYLES.find(style=>style.id===metadata.style)?.title ?? metadata.customStyleTitle ?? metadata.style, locale:metadata.locale, citationFormat:/citation-format="note"/.test(xml)?'note':/citation-format="numeric"/.test(xml)?'numeric':'author-date', citations:citations.map(citation=>({citationId:citation.citationId,noteIndex:citation.noteIndex,itemIds:citation.citationItems.map(item=>item.id),text:text.citations.get(citation.citationId)??'',html:html.citations.get(citation.citationId)??''})), bibliography:sources.size?{itemIds:[...sources.keys()],text:text.bibliography,html:html.bibliography}:null };
  if (key.length < 500_000) {
    formattingCache.set(key,structuredClone(result));
    while (formattingCache.size > 4) formattingCache.delete(formattingCache.keys().next().value!);
  }
  return result;
}
export function singleAcademicSnapshot(id:string,title:string,document:AcademicSnapshot['chapters'][number]['document'], metadata:AcademicMetadata, revision=0): AcademicSnapshot {
  return {formatVersion:1,title,generatedAt:new Date().toISOString(),metadata,chapters:[{id,title,document,metadata,revision}]};
}
