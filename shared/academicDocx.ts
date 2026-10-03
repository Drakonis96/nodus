import { Document, Packer, Paragraph, Footer, PageNumber, AlignmentType, TextRun, HeadingLevel, FootnoteReferenceRun, EndnoteReferenceRun, Table, TableRow, TableCell, ImageRun, ExternalHyperlink, Bookmark, InternalHyperlink, TableOfContents, ImportedXmlComponent, type ParagraphChild } from 'docx';
import { DOMParser } from '@xmldom/xmldom';
import katex from 'katex';
import type { BlockNoteDocument, NativeInline } from './blockNoteDocument';
import {academicTargets, academicHeadingLevel, type CompiledAcademicDocument } from './academicDocument';
import { htmlEscape, cslEntries, academicColor, type AcademicAssets } from './academicRender';
function math(formula:string):ParagraphChild {
 const markup=katex.renderToString(formula,{output:'mathml',throwOnError:true});
 const doc=new DOMParser().parseFromString(markup,'text/html');
 const children=(node:any)=>Array.from(node.childNodes??[]).filter((n:any)=>n.nodeType===1).map((n:any)=>convert(n)).join('');
 const convert=(node:any):string=>{
  const name=node.localName;const nodes=Array.from(node.childNodes??[]).filter((n:any)=>n.nodeType===1) as any[];
  if(['mi','mn','mo','mtext','ms'].includes(name))return `<m:r><m:t>${htmlEscape(node.textContent)}</m:t></m:r>`;
  if(name==='annotation'||name==='mspace')return '';
  if(name==='mover'||name==='munder')return `<m:${name==='mover'?'limUpp':'limLow'}><m:e>${convert(nodes[0])}</m:e><m:lim>${convert(nodes[1])}</m:lim></m:${name==='mover'?'limUpp':'limLow'}>`;
  if(name==='mfrac')return `<m:f><m:num>${convert(nodes[0])}</m:num><m:den>${convert(nodes[1])}</m:den></m:f>`;
  if(name==='msup'||name==='msub')return `<m:${name==='msup'?'sSup':'sSub'}><m:e>${convert(nodes[0])}</m:e><m:${name==='msup'?'sup':'sub'}>${convert(nodes[1])}</m:${name==='msup'?'sup':'sub'}></m:${name==='msup'?'sSup':'sSub'}>`;
  if(name==='msubsup')return `<m:sSubSup><m:e>${convert(nodes[0])}</m:e><m:sub>${convert(nodes[1])}</m:sub><m:sup>${convert(nodes[2])}</m:sup></m:sSubSup>`;
  if(name==='msqrt'||name==='mroot')return `<m:rad><m:radPr><m:degHide m:val="${name==='msqrt'?1:0}"/></m:radPr><m:deg>${name==='mroot'?convert(nodes[1]):''}</m:deg><m:e>${name==='msqrt'?children(node):convert(nodes[0])}</m:e></m:rad>`;
  if(name==='mtable')return `<m:m>${nodes.map(row=>`<m:mr>${Array.from(row.childNodes).filter((n:any)=>n.nodeType===1).map((n:any)=>`<m:e>${children(n)}</m:e>`).join('')}</m:mr>`).join('')}</m:m>`;
  if(!['math','semantics','mrow','mstyle','mpadded','mtd','mtr'].includes(name))throw new Error('La fórmula contiene un elemento no compatible con Word: '+name);
  return children(node);
 };
 const root=doc.getElementsByTagName('math')[0];
 return ImportedXmlComponent.fromXmlString(`<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${children(root)}</m:oMath>`) as ParagraphChild;
}
export async function academicDocx(compiled:CompiledAcademicDocument,assets:AcademicAssets={}):Promise<Uint8Array> {
 const {snapshot,references}=compiled;
 const citations=new Map(references.citations.map(c=>[c.citationId,c]));
 const footnotes:Record<number,{children:Paragraph[]}>={},endnotes:Record<number,{children:Paragraph[]}>={};let footnoteNo=0,endnoteNo=0,listInstance=0,noteDepth=0;const targets=academicTargets(snapshot);
 const inline=(value:unknown,chapter:typeof snapshot.chapters[number]):ParagraphChild[]=>typeof value==='string'?[new TextRun(value)]:Array.isArray(value)?value.flatMap((entry:NativeInline):ParagraphChild[]=>{
  if(entry.type==='nodusCitation'){let id='';try{id=JSON.parse(String(entry.props?.payload)).citationId;}catch{}const text=citations.get(id)?.text??'[Cita pendiente]';if(snapshot.metadata.placement==='in-text'||noteDepth)return [...styledCsl(citations.get(id)?.html??text)];if(snapshot.metadata.placement==='endnote'){const no=++endnoteNo;endnotes[no]={children:[new Paragraph({children:styledCsl(citations.get(id)?.html??text)})]};return [new EndnoteReferenceRun(no)];}const no=++footnoteNo;footnotes[no]={children:[new Paragraph({children:styledCsl(citations.get(id)?.html??text)})]};return [new FootnoteReferenceRun(no)];}
  if(entry.type==='nodusFootnote'){const note=chapter.metadata.notes[String(entry.props?.noteId)];noteDepth++;const rendered=note?render(note.document,chapter):[new Paragraph('[Nota ausente]')];noteDepth--;if(!(rendered[0] instanceof Paragraph))rendered.unshift(new Paragraph(''));const body=rendered as Paragraph[];if(note?.placement==='endnote'){const no=++endnoteNo;endnotes[no]={children:body};return [new EndnoteReferenceRun(no)];}const no=++footnoteNo;footnotes[no]={children:body};return [new FootnoteReferenceRun(no)];}
  if(entry.type==='nodusFormula')return [math(String(entry.props?.formula??''))];
  if(entry.type==='nodusCrossReference')return [new InternalHyperlink({anchor:'b'+String(entry.props?.targetId).replace(/[^a-zA-Z0-9_]/g,'_').slice(0,36),children:[new TextRun(targets.get(String(entry.props?.targetId))?.label??String(entry.props?.label??'Referencia'))]})];
  if(entry.type==='link'&&/^https?:\/\//.test(entry.href??''))return [new ExternalHyperlink({link:entry.href!,children:inline(entry.content,chapter)})];
  if(entry.type==='link')return inline(entry.content,chapter);
  if(entry.type==='nodusWiki')return [new TextRun(String(entry.props?.label??entry.props?.reference))];
  const styles=entry.styles??{};return [new TextRun({text:entry.text??'',bold:styles.bold==null?undefined:Boolean(styles.bold),italics:styles.italic==null?undefined:Boolean(styles.italic),strike:styles.strike==null?undefined:Boolean(styles.strike),underline:styles.underline?{}:undefined,font:styles.code?'Courier New':undefined,color:academicColor(styles.textColor)?.slice(1),shading:academicColor(styles.backgroundColor,true)?{fill:academicColor(styles.backgroundColor,true)!.slice(1)}:undefined})];
 }):[];
 const render=(document:BlockNoteDocument,chapter:typeof snapshot.chapters[number],depth=0,parentInstance?:number):Array<Paragraph|Table>=>{let activeList=parentInstance??0;return document.flatMap((block,index)=>{
  if(block.type==='numberedListItem'&&(index===0||document[index-1].type!=='numberedListItem'))activeList=parentInstance??++listInstance;
  let own:Array<Paragraph|Table>;
  const children=inline(block.content,chapter); const bookmark=new Bookmark({id:'b'+block.id.replace(/[^a-zA-Z0-9_]/g,'_').slice(0,36),children:[new TextRun('')]});
  if(block.type==='table') {const rows=(block.content as {rows?:Array<{cells:unknown[]}>})?.rows??[];own=[new Paragraph({children:[bookmark,new TextRun(targets.get(block.id)?.label??String(block.props.caption??''))]}),new Table({rows:rows.map((row,index)=>new TableRow({tableHeader:index===0,children:row.cells.map(cell=>new TableCell({children:[new Paragraph({children:inline(Array.isArray(cell)?cell:(cell as {content?:unknown}).content,chapter)})]}))}))})];}
  else if(block.type==='image'){const asset=assets[String(block.props.url)];if(!asset||!['png','jpg'].includes(asset.type))throw new Error('La imagen no se puede representar sin pérdida en Word. Usa PNG o JPEG.');own=[new Paragraph({children:[bookmark,new ImageRun({type:asset.type as 'png'|'jpg',data:asset.bytes,transformation:imageFit(asset.bytes,Math.min(560,Number(block.props.previewWidth)||560),600)})]}),new Paragraph(targets.get(block.id)?.label??String(block.props.caption??''))];}
  else own=[new Paragraph({children:[bookmark,...(block.type==='heading'?[new TextRun(targets.get(block.id)?.label.match(/^[\d.]+\s/)?.[0]??''),...children]:children.length?children:[new TextRun(String(block.props.markdown??block.props.name??''))])],heading:block.type==='heading'?[HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,HeadingLevel.HEADING_3,HeadingLevel.HEADING_4,HeadingLevel.HEADING_5,HeadingLevel.HEADING_6][academicHeadingLevel(chapter.document,Number(block.props.level),snapshot.chapters.length>1)-1]:undefined,bullet:block.type==='bulletListItem'||block.type==='checkListItem'?{level:Math.min(8,depth)}:undefined,numbering:block.type==='numberedListItem'?{reference:'academic-numbered',instance:activeList,level:Math.min(8,depth)}:undefined,indent:block.type==='quote'?{left:720}:undefined,spacing:{after:160,line:360}})];
  return [...own,...render(block.children??[],chapter,depth+1,block.type==='numberedListItem'?activeList:undefined)];
 });};
 const config=snapshot.metadata.manuscript;const children:Array<Paragraph|Table|TableOfContents>=[new Paragraph({text:snapshot.title,heading:HeadingLevel.TITLE})];
 if(config?.authors)children.push(new Paragraph(config.authors));if(config?.abstract)children.push(new Paragraph({text:'Resumen',heading:HeadingLevel.HEADING_1}),new Paragraph(config.abstract));if(config?.keywords)children.push(new Paragraph('Palabras clave: '+config.keywords));if(config?.includeContents)children.push(new TableOfContents('Índice',{hyperlink:true,headingStyleRange:'1-6'}));
 for(const [index,chapter] of snapshot.chapters.entries()){if(snapshot.chapters.length>1)children.push(new Paragraph({text:`${index+1}. ${chapter.title}`,heading:HeadingLevel.HEADING_1,pageBreakBefore:index>0}));children.push(...render(chapter.document,chapter));}
 if(references.bibliography)children.push(new Paragraph({text:'Bibliografía',heading:HeadingLevel.HEADING_1}),...cslEntries(references.bibliography.html).map(entry=>new Paragraph({children:styledCsl(entry),indent:{left:454,hanging:454},spacing:{after:160}})));
 const margin=Math.round((config?.marginMm??25)*56.6929);
 const document=new Document({creator:config?.authors??'Nodus',title:snapshot.title,footnotes,endnotes,features:{updateFields:true},styles:{default:{document:{run:{font:'Times New Roman',size:22},paragraph:{spacing:{line:360}}}},paragraphStyles:[{id:'Title',name:'Title',basedOn:'Normal',run:{font:'Arial',color:'171717',size:40},paragraph:{spacing:{after:300}}},...Array.from({length:6},(_,index)=>({id:'Heading'+(index+1),name:'Heading '+(index+1),basedOn:'Normal',run:{font:'Arial',color:'171717',bold:true,size:[32,28,26,24,22,22][index]},paragraph:{spacing:{before:280,after:180}}}))]},numbering:{config:[{reference:'academic-numbered',levels:Array.from({length:9},(_,level)=>({level,format:'decimal' as const,text:`%${level+1}.`,alignment:'left' as const,style:{paragraph:{indent:{left:720*(level+1),hanging:360}}}}))}]},sections:[{footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({children:[PageNumber.CURRENT]})]})]})},properties:{page:{size:config?.paper==='Letter'?{width:12240,height:15840}:{width:11906,height:16838},margin:{top:margin,bottom:margin,left:margin,right:margin}}},children}]});
 return new Uint8Array(await Packer.toBuffer(document));
}

function styledCsl(html:string):ParagraphChild[] {
 const document=new DOMParser().parseFromString('<div>'+html+'</div>','text/html');
 const runs:ParagraphChild[]=[];
 const visit=(node:any,style:{italics?:boolean;bold?:boolean;superScript?:boolean;subScript?:boolean}={})=>{
   if(node.nodeType===3){runs.push(new TextRun({text:node.textContent,...style}));return;}
   const name=node.localName;
   const next={...style,...(['i','em'].includes(name)?{italics:true}:{}),...(['b','strong'].includes(name)?{bold:true}:{}),...(name==='sup'?{superScript:true}:{}),...(name==='sub'?{subScript:true}:{})};
   for(const child of Array.from(node.childNodes??[]))visit(child,next);
 };visit(document.documentElement);return runs;
}
function imageFit(bytes:Uint8Array,maxWidth:number,maxHeight:number):{width:number;height:number} {
 const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width=0,height=0;
 if(bytes.length>=24&&data.getUint32(0)===0x89504e47){width=data.getUint32(16);height=data.getUint32(20);}
 else if(bytes.length>4&&bytes[0]===255&&bytes[1]===216){let offset=2;while(offset+9<bytes.length){if(bytes[offset]!==255){offset++;continue;}const marker=bytes[offset+1],length=data.getUint16(offset+2);if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker)){height=data.getUint16(offset+5);width=data.getUint16(offset+7);break;}if(!length)break;offset+=2+length;}}
 if(!width||!height)throw new Error('No se pueden recuperar las dimensiones de la imagen.');
 const scale=Math.min(maxWidth/width,maxHeight/height,1);return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
