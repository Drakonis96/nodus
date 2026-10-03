import { zipSync, strToU8 } from 'fflate';
import { academicContentDocuments, academicBlocks, academicInlines, normalizeAcademicMetadata, type AcademicExportFormat, type AcademicSnapshot } from './academicDocument';
import { validateBlockNoteDocument } from './blockNoteDocument';
import { academicHtml, academicLatex, compileAcademicSnapshot, type AcademicAssets } from './academicRender';
import { academicDocx } from './academicDocx';
import { academicFormulaSvg } from './academicMath';
export function validateAcademicSnapshot(value:AcademicSnapshot):AcademicSnapshot {
 if(value.formatVersion!==1||!value.title||!Array.isArray(value.chapters)||!value.chapters.length||value.chapters.length>200||JSON.stringify(value).length>16_000_000)throw new Error('Instantánea académica inválida.');
 return {...value,metadata:normalizeAcademicMetadata(value.metadata),chapters:value.chapters.map(ch=>({...ch,document:validateBlockNoteDocument(ch.document),metadata:normalizeAcademicMetadata(ch.metadata)}))};
}
export function inspectAcademicSnapshot(snapshot:AcademicSnapshot,assets:AcademicAssets) {
 snapshot=validateAcademicSnapshot(snapshot);const compiled=compileAcademicSnapshot(snapshot);
 for(const chapter of snapshot.chapters)for(const block of academicContentDocuments(chapter).flatMap(academicBlocks))if(['image','file','audio','video'].includes(block.type)&&!assets[String(block.props.url)])compiled.issues.push({id:chapter.id+':'+block.id,severity:'error',message:chapter.title+': No se puede recuperar el archivo adjunto.',blockId:block.id});
 return compiled;
}
export async function academicDelivery(snapshot:AcademicSnapshot, format:AcademicExportFormat, assets:AcademicAssets, pdf:(html:string)=>Promise<Uint8Array>, acceptWarnings=false):Promise<{bytes:Uint8Array;mime:string;extension:string;html:string}> {
 snapshot=validateAcademicSnapshot(snapshot);const compiled=inspectAcademicSnapshot(snapshot,assets);
 if(compiled.issues.some(issue=>issue.severity==='error'))throw new Error(compiled.issues.filter(issue=>issue.severity==='error').map(issue=>issue.message).join('\n'));
 if(!acceptWarnings&&compiled.issues.some(issue=>issue.severity==='warning'))throw new Error('Revisa y reconoce las advertencias antes de exportar.\n'+compiled.issues.filter(issue=>issue.severity==='warning').map(issue=>issue.message).join('\n'));
 const formulas:Record<string,string>={};for(const chapter of snapshot.chapters)for(const {inline} of academicContentDocuments(chapter).flatMap(academicInlines))if(inline.type==='nodusFormula'){const formula=String(inline.props?.formula??'');formulas[formula]=academicFormulaSvg(formula);}
 const html=academicHtml(compiled,assets,formulas);
 if(format==='pdf')return {bytes:await pdf(html),mime:'application/pdf',extension:'pdf',html};
 if(format==='docx')return {bytes:await academicDocx(compiled,assets),mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',extension:'docx',html};
 if(format!=='latex')throw new Error('Formato académico desconocido.');
 const files=academicLatex(compiled,assets);return {bytes:zipSync(Object.fromEntries(Object.entries(files).map(([name,value])=>[name,typeof value==='string'?strToU8(value):value]))),mime:'application/zip',extension:'zip',html};
}
