import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { academicDelivery, inspectAcademicSnapshot } from './generated/academicDelivery.mjs';
import { normalizeAcademicMetadata, academicHasContent, academicContentDocuments, academicBlocks } from './generated/academicDocument.mjs';
import { parseNativeDocument, markdownToBlockNote } from './generated/blockNoteDocument.mjs';
let activeExports=0;
async function academicPdf(html,onPaginated) {
 const { chromium }=await import('playwright-core');
 const browser=await chromium.launch({executablePath:process.env.NODUS_CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
 try {const context=await browser.newContext();await context.route('**/*',route=>route.abort());const page=await context.newPage();page.setDefaultTimeout(60000);await page.setContent(html,{waitUntil:'load'});await page.evaluate(()=>{window.PagedConfig={auto:false};});await page.addScriptTag({content:fs.readFileSync(fileURLToPath(new URL('./generated/paged.polyfill.js',import.meta.url)),'utf8')});await page.evaluate(async()=>{await new window.Paged.Previewer().preview();return true;});onPaginated?.(await page.content());return new Uint8Array(await page.pdf({preferCSSPageSize:true,printBackground:true}));}
 finally{await browser.close();}
}
export async function exportAcademicArtifact(artifact,input,artifacts,userId) {
 if(artifact.kind!=='workspace-note'){const error=new Error('La entrega académica requiere un documento de Scriptor.');error.status=422;throw error;}
 if(activeExports>=2){const error=new Error('Hay dos entregas en preparación. Reintenta en unos segundos.');error.status=429;throw error;}
 if(input.expectedRevision!==artifact.revision){const error=new Error('REVISION_CONFLICT: Guarda o recarga antes de exportar.');error.status=409;throw error;}
 const metadata=normalizeAcademicMetadata(artifact.metadata?.academicMetadata);
 const refs=metadata.manuscript?.chapters.filter(ch=>ch.included)??[];
 const entries=refs.length?refs.map(ref=>{const chapter=artifacts.get(userId,ref.documentId);if(!chapter||chapter.kind!=='workspace-note'||chapter.vaultId!==artifact.vaultId)throw new Error('Un capítulo no está disponible en esta bóveda.');return chapter;}):[artifact];
 if(refs.length&&academicHasContent(parseNativeDocument(artifact.metadata?.nativeDocument)??markdownToBlockNote(artifact.content))&&!entries.some(entry=>entry.id===artifact.id))entries.unshift(artifact);
 const snapshot={formatVersion:1,title:artifact.title,generatedAt:new Date().toISOString(),metadata,chapters:entries.map(ch=>({id:ch.id,title:ch.title,revision:ch.revision,document:parseNativeDocument(ch.metadata?.nativeDocument)??markdownToBlockNote(ch.content),metadata:normalizeAcademicMetadata(ch.metadata?.academicMetadata)}))};
 const assets={};let assetIndex=0;
 for(const chapter of snapshot.chapters)for(const block of academicContentDocuments(chapter).flatMap(academicBlocks))if(['image','audio','video','file'].includes(block.type)){
  const url=String(block.props.url??'');const match=/^data:(image\/(?:png|jpeg)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/pdf);base64,([a-zA-Z0-9+/=]+)$/.exec(url);if(!match)continue;
  const bytes=new Uint8Array(Buffer.from(match[2],'base64'));if(bytes.length>20_000_000)throw new Error('El adjunto supera 20 MB.');const type=match[1]==='image/png'?'png':match[1]==='image/jpeg'?'jpg':'other';assets[url]={bytes,type,name:`resource-${++assetIndex}.${type==='other'?(match[1]==='application/pdf'?'pdf':match[1].split('/')[1]?.replace(/[^a-z0-9]/g,'')||'bin'):type}`,dataUrl:url};
 }
 if(input.format==='check')return {issues:inspectAcademicSnapshot(snapshot,assets).issues};
 activeExports++;
 try {let paginatedHtml;const result=await academicDelivery(snapshot,input.format,assets,html=>academicPdf(html,rendered=>{paginatedHtml=rendered;}),input.acceptWarnings===true);return {base64:Buffer.from(result.bytes).toString('base64'),mime:result.mime,fileName:artifact.title.replace(/[^\p{L}\p{N}._ -]/gu,'_')+'.'+result.extension,html:paginatedHtml??result.html};}
 finally{activeExports--;}
}
