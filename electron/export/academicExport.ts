import {getDb} from '../db/database';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { BrowserWindow } from 'electron';
import { academicDelivery, inspectAcademicSnapshot } from '@shared/academicDelivery';
import { academicHasContent, academicContentDocuments, academicBlocks, normalizeAcademicMetadata, type AcademicExportFormat, type AcademicSnapshot } from '@shared/academicDocument';
import { markdownToBlockNote } from '@shared/blockNoteDocument';
import type { AcademicAssets } from '@shared/academicRender';
import { getWorkspaceNoteEditorData } from '../db/workspaceRepo';
import { getStudyDocEditorData } from '../db/studyEditorRepo';
import { getPageAsset } from '../db/pagesRepo';
const require=createRequire(import.meta.url);
export async function academicPdf(html:string,onPaginated?:(html:string)=>void):Promise<Uint8Array> {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-academic-'));const file=path.join(directory,'document.html');
 fs.writeFileSync(file,html);
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:true,partition:`academic-${path.basename(directory)}`}});
 // Only the generated local document is readable. No user HTML or remote resource executes.
 win.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:details.url!==new URL(`file://${file}`).href && !details.url.startsWith('data:')}));
 try {await win.loadFile(file);const script=fs.readFileSync(path.resolve(path.dirname(require.resolve('pagedjs')),'../dist/paged.polyfill.js'),'utf8');await win.webContents.executeJavaScript('window.PagedConfig={auto:false};');await win.webContents.executeJavaScript(script+';void 0;');await win.webContents.executeJavaScript('(async()=>{await new Paged.Previewer().preview();return true;})()');onPaginated?.(await win.webContents.executeJavaScript('document.documentElement.outerHTML'));return new Uint8Array(await win.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,margins:{top:0,bottom:0,left:0,right:0}}));}
 finally{setImmediate(()=>{win.destroy();fs.rmSync(directory,{recursive:true,force:true});});}
}
export function loadAcademicSnapshot(id:string,kind:'note'|'study',expectedRevision?:number):AcademicSnapshot {
 const load=(id:string,kind:'note'|'study')=>kind==='note'?getWorkspaceNoteEditorData(id):getStudyDocEditorData(id);
 const root=load(id,kind);if(expectedRevision!==undefined&&root.revision!==expectedRevision)throw new Error('REVISION_CONFLICT: Guarda o recarga el manuscrito antes de exportar.');
 const metadata=normalizeAcademicMetadata(root.academicMetadata);
 const refs=metadata.manuscript?.chapters.filter(ch=>ch.included)??[];
 const cover={documentId:id,kind,title:root.documentTitle??'Documento',included:true};
 const rootDocument=root.nativeDocument??markdownToBlockNote(root.contentMarkdown??'');
 const entries=refs.length?[...(academicHasContent(rootDocument)&&!refs.some(ref=>ref.documentId===id)?[cover]:[]),...refs]:[cover];
 return {formatVersion:1,title:root.documentTitle??'Documento',generatedAt:new Date().toISOString(),metadata,chapters:entries.map(chapter=>{const data=load(chapter.documentId,chapter.kind);return {id:chapter.documentId,title:data.documentTitle??chapter.title,revision:data.revision??0,unresolvedComments:data.annotations.filter(a=>!a.resolvedAt).length,document:data.nativeDocument??markdownToBlockNote(data.contentMarkdown??''),metadata:normalizeAcademicMetadata(data.academicMetadata)};})};
}
export function academicAssets(snapshot:AcademicSnapshot):AcademicAssets {
 const assets:AcademicAssets={};let index=0;
 for(const chapter of snapshot.chapters)for(const block of academicContentDocuments(chapter).flatMap(academicBlocks))if(['image','audio','video','file'].includes(block.type)){
  const url=String(block.props.url??'');if(assets[url])continue;let bytes:Uint8Array|null=null,mime='application/octet-stream';
  const data=/^data:(image\/(?:png|jpeg)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/pdf);base64,([a-zA-Z0-9+/=]+)$/.exec(url);
  const blob=/^nodus-blob:\/\/([a-f0-9]{64})$/.exec(url);
  if(data){mime=data[1];bytes=new Uint8Array(Buffer.from(data[2],'base64'));}
  if(blob){mime=String((getDb().prepare('SELECT mime_type FROM db_blobs WHERE hash=?').get(blob[1]) as {mime_type?:string}|undefined)?.mime_type??mime);bytes=getPageAsset(blob[1]);if(bytes&&bytes[0]===137&&bytes[1]===80)mime='image/png';else if(bytes&&bytes[0]===255&&bytes[1]===216)mime='image/jpeg';}
  if(!bytes)continue;if(bytes.byteLength>20_000_000)throw new Error('El adjunto supera 20 MB.');
  const type=mime==='image/png'?'png':mime==='image/jpeg'?'jpg':'other';const name=`resource-${++index}.${type==='other'?(mime==='application/pdf'?'pdf':mime.split('/')[1]?.replace(/[^a-z0-9]/g,'')||'bin'):type}`;
  assets[url]={bytes,type,name,dataUrl:`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`};
 }
 return assets;
}
export async function exportAcademicDocument(input:{documentId:string;kind:'note'|'study';expectedRevision?:number;format:AcademicExportFormat;acceptWarnings?:boolean}) {
 const snapshot=loadAcademicSnapshot(input.documentId,input.kind,input.expectedRevision);
 let paginatedHtml:string|undefined;
 const result=await academicDelivery(snapshot,input.format,academicAssets(snapshot),html=>academicPdf(html,rendered=>{paginatedHtml=rendered;}),input.acceptWarnings);
 return {base64:Buffer.from(result.bytes).toString('base64'),mime:result.mime,fileName:snapshot.title.replace(/[^\p{L}\p{N}._ -]/gu,'_')+'.'+result.extension,html:paginatedHtml??result.html};
}

export function inspectAcademicDocument(input:{documentId:string;kind:'note'|'study';expectedRevision?:number}){const snapshot=loadAcademicSnapshot(input.documentId,input.kind,input.expectedRevision);return inspectAcademicSnapshot(snapshot,academicAssets(snapshot)).issues;}
