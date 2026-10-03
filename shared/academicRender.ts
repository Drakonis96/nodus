import { academicBlocks, academicCitations, academicTargets, academicHeadingLevel, checkAcademicDocument, type AcademicSnapshot, type CompiledAcademicDocument } from './academicDocument';
import { formatAcademicSnapshot } from './academicCsl';
import type { NativeBlock, NativeInline, BlockNoteDocument } from './blockNoteDocument';
import { nativePlainText } from './blockNoteDocument';
export const htmlEscape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export const texEscape = (value: unknown) => String(value ?? '').replace(/[\\{}%$&#_^~]/g,char=>({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','%':'\\%','$':'\\$','&':'\\&','#':'\\#','_':'\\_','^':'\\textasciicircum{}','~':'\\textasciitilde{}'}[char]!));
export function compileAcademicSnapshot(snapshot: AcademicSnapshot): CompiledAcademicDocument {
  const allTargets=new Set(snapshot.chapters.flatMap(ch=>academicBlocks(ch.document).map(b=>b.id)));
  const issues = snapshot.chapters.flatMap(chapter=>checkAcademicDocument(chapter.document,chapter.metadata,chapter.unresolvedComments??0,allTargets).map(issue=>({...issue,id:chapter.id+':'+issue.id,message:chapter.title+': '+issue.message})));
  const blockIds=snapshot.chapters.flatMap(ch=>academicBlocks(ch.document).map(b=>b.id));
  if(new Set(blockIds).size!==blockIds.length)issues.push({id:'duplicate-block',severity:'error',message:'Hay identificadores de bloque repetidos entre capítulos.'});
  if(snapshot.metadata.manuscript&&!snapshot.metadata.manuscript.authors.trim())issues.push({id:'manuscript-author',severity:'warning',message:'Revisa la autoría del manuscrito.'});
  const citations = snapshot.chapters.flatMap(chapter=>academicCitations(chapter.document,chapter.metadata));
  if (new Set(citations.map(cite=>cite.citationId)).size !== citations.length) issues.push({id:'duplicate-citation',severity:'error',message:'Hay citas duplicadas entre capítulos.'});
  let references:CompiledAcademicDocument['references'];
  try{references=formatAcademicSnapshot(snapshot);}catch(error){issues.push({id:'citation-state',severity:'error',message:error instanceof Error?error.message:String(error)});references={style:snapshot.metadata.style,styleTitle:snapshot.metadata.style,locale:snapshot.metadata.locale,citationFormat:'author-date',citations:[],bibliography:null};}
  return {snapshot,references,issues};
}
export function safeCslHtml(html:string): string {
  return html.replace(/<\/?([^\s>/]+)[^>]*>/g,(tag,name:string)=> {
    const allowed = ['i','em','b','strong','span','div','sup','sub'];
    if (!allowed.includes(name.toLowerCase())) return '';
    const close = tag.startsWith('</');
    return close ? `</${name}>` : `<${name}>`;
  });
}
export function cslText(html:string):string { return html.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#(x[\da-f]+|\d+);/gi,(_,code)=>{const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);return n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&nbsp;/g,' '); }
export interface AcademicAssets { [url:string]: { dataUrl:string; name:string; bytes:Uint8Array; type:'png'|'jpg'|'svg'|'other' } }
export function academicHtml(compiled:CompiledAcademicDocument, assets:AcademicAssets = {}, formulas:Record<string,string> = {}):string {
  const {snapshot,references} = compiled;
  const citations = new Map(references.citations.map(c=>[c.citationId,c]));
  const targets = academicTargets(snapshot);
  let noteNo=0, noteDepth=0;
  const endnotes:string[]=[];
  const inline = (value:unknown, chapter:AcademicSnapshot['chapters'][number]):string => {
    if (typeof value === 'string') return htmlEscape(value);
    if (!Array.isArray(value)) return '';
    return value.map((entry:NativeInline)=>{
      if (entry.type==='nodusCitation') {
        let id=''; try {id=JSON.parse(String(entry.props?.payload)).citationId;} catch { return '<span>[Cita inválida]</span>'; }
        const text=safeCslHtml(citations.get(id)?.html ?? '[Cita pendiente]');
        if (snapshot.metadata.placement==='in-text'||noteDepth) return `<span class="citation">${text}</span>`;
        const no=++noteNo;
        if (snapshot.metadata.placement==='endnote') { endnotes.push(`<li value="${no}">${text}</li>`); return `<sup>${no}</sup>`; }
        return `<sup>${no}</sup><span class="footnote" data-note-number="${no}">${text}</span>`;
      }
      if (entry.type==='nodusFootnote') {
        const note=chapter.metadata.notes[String(entry.props?.noteId)];
        const no=++noteNo;noteDepth++;const content=note ? render(note.document,chapter) : '[Nota ausente]';noteDepth--;
        if (note?.placement==='endnote') {endnotes.push(`<li value="${no}">${content}</li>`);return `<sup>${no}</sup>`;}
        return `<sup>${no}</sup><span class="footnote" data-note-number="${no}">${footnotePhrasing(content)}</span>`;
      }
      if (entry.type==='nodusCrossReference') return `<a href="#${htmlEscape(entry.props?.targetId)}">${htmlEscape(targets.get(String(entry.props?.targetId))?.label || entry.props?.label || 'Referencia')}</a>`;
      if (entry.type==='nodusFormula') return formulas[String(entry.props?.formula)] ?? `<span class="formula">${htmlEscape(entry.props?.formula)}</span>`;
      if (entry.type==='nodusWiki') return htmlEscape(entry.props?.label ?? entry.props?.reference);
      if (entry.type==='link') return /^(https?:\/\/|nodus:\/\/)/.test(entry.href??'') ? `<a href="${htmlEscape(entry.href)}">${inline(entry.content,chapter)}</a>` : inline(entry.content,chapter);
      let text=htmlEscape(entry.text);
      const styles=entry.styles??{};
      if (styles.bold) text=`<strong>${text}</strong>`;
      if (styles.italic) text=`<em>${text}</em>`;
      if (styles.underline) text=`<u>${text}</u>`;
      if (styles.strike) text=`<s>${text}</s>`;
      if (styles.code) text=`<code>${text}</code>`;
      const color=academicColor(styles.textColor),background=academicColor(styles.backgroundColor,true);if(color||background)text=`<span style="${color?'color:'+color+';':''}${background?'background-color:'+background:''}">${text}</span>`;
      return text;
    }).join('');
  };
  const render=(document:BlockNoteDocument,chapter:AcademicSnapshot['chapters'][number]):string=>groupAcademicLists(document,block=>{
    const content=inline(block.content,chapter), id=` id="${htmlEscape(block.id)}"`;
    let own='';
    switch(block.type) {
      case 'heading': {const level=academicHeadingLevel(chapter.document,Number(block.props.level),snapshot.chapters.length>1);own=`<h${level}${id}>${htmlEscape(targets.get(block.id)?.label.match(/^[\d.]+\s/)?.[0]??'')}${content}</h${level}>`;break;}
      case 'bulletListItem':case 'numberedListItem':case 'checkListItem':return `<li${id}>${block.type==='checkListItem'?(block.props.checked?'☑ ':'☐ '):''}${content}${render(block.children??[],chapter)}</li>`;
      case 'quote':own=`<blockquote${id}>${content}</blockquote>`;break;
      case 'codeBlock':own=`<pre${id}>${content}</pre>`;break;
      case 'image': {const asset=assets[String(block.props.url)];own=`<figure${id}>${asset?`<img src="${asset.dataUrl}" alt="${htmlEscape(block.props.caption)}">`:'[Imagen ausente]'}<figcaption>${htmlEscape(targets.get(block.id)?.label)}</figcaption></figure>`;break;}
      case 'table': {const rows=(block.content as {rows?:Array<{cells:unknown[]}>})?.rows??[];own=`<table${id}><caption>${htmlEscape(targets.get(block.id)?.label)}</caption>${rows.map((row,index)=>`<tr>${row.cells.map(cell=>`<${index?'td':'th'}>${inline(Array.isArray(cell)?cell:(cell as {content?:unknown}).content,chapter)}</${index?'td':'th'}>`).join('')}</tr>`).join('')}</table>`;break;}
      case 'audio':case 'video':case 'file':own=`<p${id}>${htmlEscape(block.props.name || block.type)} · ${htmlEscape(assets[String(block.props.url)]?.name ?? 'Adjunto')}</p>`;break;
      default:own=`<p${id}>${content || htmlEscape(block.props.markdown)}</p>`;
    }
    return own+render(block.children??[],chapter);
  },'html');
  const config=snapshot.metadata.manuscript;
  const headings=snapshot.chapters.map((ch,index)=>{const sections=academicBlocks(ch.document).filter(b=>b.type==='heading').map(b=>`<li><a href="#${htmlEscape(b.id)}">${htmlEscape(targets.get(b.id)?.label??'')}</a></li>`).join('');return snapshot.chapters.length>1?`<li class="contents-chapter"><a href="#chapter-${htmlEscape(ch.id)}">${index+1}. ${htmlEscape(ch.title)}</a><ol>${sections}</ol></li>`:sections;}).join('');
  const body=snapshot.chapters.map((chapter,index)=>`<section class="chapter">${snapshot.chapters.length>1?`<h1 id="chapter-${htmlEscape(chapter.id)}">${index+1}. ${htmlEscape(chapter.title)}</h1>`:''}${render(chapter.document,chapter)}</section>`).join('');
  return `<!doctype html><html lang="${htmlEscape(snapshot.metadata.locale)}"><head><meta charset="utf-8"><title>${htmlEscape(snapshot.title)}</title><style>
  @page{size:${config?.paper??'A4'};margin:${config?.marginMm??25}mm;@bottom-center{content:counter(page);font-size:9pt} @footnote{float:bottom;border-top:1px solid #aaa;padding-top:3mm}}body{font-family:Georgia,'Times New Roman',serif;font-size:11pt;line-height:1.5;color:#171717}h1,h2,h3,h4,h5,h6{break-after:avoid;font-family:Arial,sans-serif}p{orphans:3;widows:3}h1{font-size:22pt}h2{font-size:16pt}h3{font-size:13pt}.chapter+.chapter{break-before:page}.footnote{float:footnote;font-size:9pt;line-height:1.3}::footnote-call{content:'';vertical-align:super;font-size:0.75em}::footnote-marker{content:attr(data-note-number) '. ';font-weight:bold}img{max-width:100%;max-height:220mm}figure{break-inside:avoid}figcaption,caption{font-size:10pt;text-align:left;margin:2mm 0}table{border-collapse:collapse;width:100%;margin:4mm 0}th,td{border:1px solid #bbb;padding:2mm;vertical-align:top}thead{display:table-header-group}pre{white-space:pre-wrap;font-size:9pt}a{color:inherit;text-decoration:none}.contents ol{list-style:none;padding:0}.contents ol ol{padding-left:8mm}.contents li{margin:2mm 0}.contents a{display:block}.contents a::after{content:target-counter(attr(href),page);float:right}.bibliography>div>div{margin:0 0 3mm 0;padding-left:8mm;text-indent:-8mm}.footnote .note-p:first-child{display:inline!important}.note-table{display:table!important;width:100%}.note-tr{display:table-row!important}.note-td,.note-th{display:table-cell!important;padding:2mm;border:1px solid #bbb}.formula svg{vertical-align:middle}svg{max-width:100%}
  </style></head><body><h1>${htmlEscape(snapshot.title)}</h1>${config?.authors?`<p>${htmlEscape(config.authors)}</p>`:''}${config?.abstract?`<h2>Resumen</h2><p>${htmlEscape(config.abstract)}</p>`:''}${config?.keywords?`<p><strong>Palabras clave:</strong> ${htmlEscape(config.keywords)}</p>`:''}${config?.includeContents?`<nav class="contents"><h2>Índice</h2><ol>${headings}</ol></nav>`:''}${body}${endnotes.length?`<h1>Notas</h1><ol>${endnotes.join('')}</ol>`:''}${references.bibliography?`<section class="bibliography"><h1>Bibliografía</h1>${safeCslHtml(references.bibliography.html)}</section>`:''}</body></html>`;
}
export function academicLatex(compiled:CompiledAcademicDocument, assets:AcademicAssets={}):Record<string,string|Uint8Array> {
  const {snapshot,references}=compiled;
  const citations=new Map(references.citations.map(c=>[c.citationId,c.html]));
  const files:Record<string,string|Uint8Array>={};
  const notes:string[]=[];let noteDepth=0;const targets=academicTargets(snapshot);
  const inline=(value:unknown,chapter:AcademicSnapshot['chapters'][number]):string=>typeof value==='string'?texEscape(value):Array.isArray(value)?value.map((entry:NativeInline)=>{
    if(entry.type==='nodusFormula')return `$${String(entry.props?.formula??'').replace(/\\(input|include|write|openout|read|catcode|csname|usepackage|documentclass)\b/g,'')}$`;
    if(entry.type==='nodusCitation'){let id='';try{id=JSON.parse(String(entry.props?.payload)).citationId;}catch{} const text=cslLatex(citations.get(id)??'[Cita pendiente]');if(snapshot.metadata.placement==='in-text'||noteDepth)return text;if(snapshot.metadata.placement==='endnote'){notes.push(text);return `\\textsuperscript{${notes.length}}`;}return `\\footnote{${text}}`;}
    if(entry.type==='nodusFootnote'){const note=chapter.metadata.notes[String(entry.props?.noteId)];noteDepth++;const text=note?render(note.document,chapter):'[Nota ausente]';noteDepth--;if(note?.placement==='endnote'){notes.push(text);return `\\textsuperscript{${notes.length}}`;}return `\\footnote{${text}}`;}
    if(entry.type==='nodusCrossReference')return `\\hyperref[${texEscape(entry.props?.targetId)}]{${texEscape(targets.get(String(entry.props?.targetId))?.label??entry.props?.label)}}`;
    if(entry.type==='link')return /^(https?:\/\/)/.test(entry.href??'')?`\\href{${texEscape(entry.href)}}{${inline(entry.content,chapter)}}`:inline(entry.content,chapter);
    if(entry.type==='nodusWiki')return texEscape(entry.props?.label??entry.props?.reference);
    let text=texEscape(entry.text);if(entry.styles?.bold)text=`\\textbf{${text}}`;if(entry.styles?.italic)text=`\\emph{${text}}`;if(entry.styles?.code)text=`\\texttt{${text}}`;if(entry.styles?.underline)text=`\\underline{${text}}`;if(entry.styles?.strike)text=`\\nodusstrike{${text}}`;const color=academicColor(entry.styles?.textColor),background=academicColor(entry.styles?.backgroundColor,true);if(color)text=`\\textcolor[HTML]{${color.slice(1)}}{${text}}`;if(background)text=`\\colorbox[HTML]{${background.slice(1)}}{${text}}`;return text;
  }).join(''):'';
  const render=(document:BlockNoteDocument,chapter:AcademicSnapshot['chapters'][number]):string=>groupAcademicLists(document,block=>{
    const text=inline(block.content,chapter),label=`\\label{${texEscape(block.id)}}`;
    let own='';switch(block.type){
      case 'heading':{const command=['section','subsection','subsubsection','paragraph','subparagraph','subparagraph'][academicHeadingLevel(chapter.document,Number(block.props.level),snapshot.chapters.length>1)-1];const prefix=texEscape(targets.get(block.id)?.label.match(/^[\d.]+\s/)?.[0]??'');own=`\\${command}*{${prefix}${text}}\\phantomsection${label}\\addcontentsline{toc}{${command}}{${prefix}${texEscape(nativePlainText(block.content))}}`;break;}
      case 'bulletListItem':case 'numberedListItem':case 'checkListItem':{return `\\item ${block.type==='checkListItem'?(block.props.checked?'[x] ':'[ ] '):''}${text}\n${render(block.children??[],chapter)}`;}
      case 'quote':own=`\\begin{quote}${text}\\end{quote}`;break;
      case 'codeBlock':own=`\\begin{quote}\\ttfamily ${text.replace(/\n/g,'\\par\n').replace(/ /g,'~')}\\end{quote}`;break;
      case 'image':{const asset=assets[String(block.props.url)];if(asset){files['assets/'+asset.name]=asset.bytes;own=`\\begin{figure}[htbp]\\centering\\includegraphics[width=\\linewidth,height=.7\\textheight,keepaspectratio]{assets/${asset.name}}\\caption{${texEscape(block.props.caption??'')}}${label}\\end{figure}`;}else own='[Imagen ausente]';break;}
      case 'table':{const rows=(block.content as {rows?:Array<{cells:unknown[]}>})?.rows??[];const width=rows[0]?.cells.length??1;own=`\\begin{longtable}{${Array(width).fill(`p{${(0.9/width).toFixed(3)}\\linewidth}`).join('')}}\n\\caption{${texEscape(block.props.caption??'')}}${label}\\\\\n${rows.map(row=>row.cells.map(cell=>inline(Array.isArray(cell)?cell:(cell as {content?:unknown}).content,chapter)).join(' & ')+' \\\\ \\hline').join('\n')}\n\\end{longtable}`;break;}
      case 'file':case 'audio':case 'video':{const asset=assets[String(block.props.url)];if(asset)files['assets/'+asset.name]=asset.bytes;own=texEscape(block.props.name||block.type)+' · '+texEscape(asset?.name??'Adjunto');break;}
      default:own=text||texEscape(block.props.markdown);
    }return own+'\n\n'+render(block.children??[],chapter);
  },'latex');
  for(const [index,chapter] of snapshot.chapters.entries())files[`chapter-${index+1}.tex`]=(snapshot.chapters.length>1?`\\section*{${index+1}. ${texEscape(chapter.title)}}\\phantomsection\\addcontentsline{toc}{section}{${index+1}. ${texEscape(chapter.title)}}\n`:'')+render(chapter.document,chapter);
  const sources=new Map(snapshot.chapters.flatMap(ch=>academicCitations(ch.document,ch.metadata)).flatMap(c=>c.sources).map(source=>[source.id,source]));
  files['references.bib']=[...sources.values()].map((source,index)=>{
    const metadata=source.metadata,key=(source.citationKey??'nodus'+(index+1)).replace(/[^a-zA-Z0-9_:-]/g,'_');
    const kind=metadata.itemType==='book'?'book':metadata.itemType==='chapter'?'incollection':metadata.itemType==='article-journal'?'article':'misc';
    const fields={title:metadata.title,author:metadata.creators.map(c=>c.name?'{'+texEscape(c.name)+'}':texEscape([c.lastName,c.firstName].filter(Boolean).join(', '))).join(' and '),year:metadata.year,doi:metadata.doi,publisher:metadata.publisher,journal:kind==='article'?metadata.publicationTitle:undefined,booktitle:kind==='incollection'?metadata.publicationTitle:undefined,volume:metadata.volume,number:metadata.issue,pages:metadata.pages,edition:metadata.edition,address:metadata.place,url:metadata.url,isbn:metadata.isbn};
    return `@${kind}{${key},\n${Object.entries(fields).filter(([,value])=>value!=null&&value!=='').map(([key,value])=>'  '+key+'={'+(key==='author'?value:texEscape(value))+'}').join(',\n')}\n}`;
  }).join('\n\n');
  files['references.tex']=references.bibliography?`\\section*{Bibliografía}\n${cslEntries(references.bibliography.html).map(line=>'\\begingroup\\hangindent=8mm\\hangafter=1 '+cslLatex(line)+'\\par\\endgroup\\medskip').join('\n')}`:'';
  const config=snapshot.metadata.manuscript;
  files['main.tex']=`\\documentclass[11pt,${config?.paper==='Letter'?'letterpaper':'a4paper'}]{article}\n\\usepackage{fontspec}\n\\setmainfont{Latin Modern Roman}\n\\usepackage[margin=${config?.marginMm??25}mm]{geometry}\n\\usepackage{graphicx,longtable,amsmath,amssymb,hyperref,xcolor}\n\\hypersetup{hidelinks}\n${snapshot.metadata.locale.startsWith('es')?'\\renewcommand{\\figurename}{Figura}\n\\renewcommand{\\tablename}{Tabla}\n\\renewcommand{\\contentsname}{Índice}\n':''}\\newcommand{\\nodusstrike}[1]{\\leavevmode\\setbox0=\\hbox{#1}\\rlap{\\raisebox{.5ex}{\\rule{\\wd0}{.4pt}}}\\box0}\n\\title{${texEscape(snapshot.title)}}\n\\author{${texEscape(config?.authors??'')}}\n\\date{}\n\\begin{document}\n\\maketitle\n${config?.abstract?`\\begin{abstract}${texEscape(config.abstract)}\\end{abstract}`:''}\n${config?.keywords?`\\noindent\\textbf{Palabras clave:} ${texEscape(config.keywords)}\\par`:''}\n${config?.includeContents?'\\tableofcontents\\clearpage':''}\n${snapshot.chapters.map((_,i)=>`\\input{chapter-${i+1}.tex}`).join('\n')}\n${notes.length?`\\section*{Notas}\\begin{enumerate}${notes.map(note=>'\\item '+note).join('\n')}\\end{enumerate}`:''}\n\\input{references.tex}\n\\end{document}\n`;
  files['README.txt']='Compilar con LuaLaTeX (dos pasadas): lualatex -halt-on-error -no-shell-escape main.tex\nLas citas y la bibliografía conservan el estilo CSL de Nodus. references.bib contiene datos reutilizables; no dirige el formato de esta entrega.\n';
  files['manifest.json']=JSON.stringify({compiler:'nodus-academic/1',snapshot},null,2);
  return files;
}

/** Consecutive list items share an environment; nested children remain inside their item. */
function groupAcademicLists(document:BlockNoteDocument,render:(block:NativeBlock)=>string,format:'html'|'latex'):string {
 const result:string[]=[];
 for(let index=0;index<document.length;index++) {
   const block=document[index];
   if(!['bulletListItem','numberedListItem','checkListItem'].includes(block.type)){result.push(render(block));continue;}
   const numbered=block.type==='numberedListItem';let content=render(block);
   while(index+1<document.length&&document[index+1].type===block.type)content+='\n'+render(document[++index]);
   const tag=numbered?'ol':'ul',environment=numbered?'enumerate':'itemize';
   result.push(format==='html'?`<${tag}>${content}</${tag}>`:`\\begin{${environment}}\n${content}\n\\end{${environment}}`);
 }
 return result.join('\n');
}
export function cslEntries(html:string):string[] {
 const entries=html.split(/<div[^>]*class="csl-entry"[^>]*>/).slice(1);
 return entries.length?entries.map(entry=>entry.replace(/<\/div>\s*<\/div>\s*$/,'</div>')):[html];
}
function cslLatex(html:string):string {
 const tokens=html.split(/(<[^>]*>)/);const stack:string[]=[];
 return tokens.map(token=>{
   if(!token.startsWith('<'))return texEscape(cslText(token));
   const closing=/^<\//.test(token),name=token.replace(/^<\/?([a-z]+).*$/i,'$1');
   const command={i:'emph',em:'emph',b:'textbf',strong:'textbf',sup:'textsuperscript',sub:'textsubscript'}[name];
   if(!command)return '';
   if(closing){stack.pop();return '}';}stack.push(name);return `\\${command}{`;
 }).join('')+'}'.repeat(stack.length);
}

/** Keep footnotes inside their call paragraph: block tags otherwise escape during HTML parsing. */
function footnotePhrasing(html:string):string {
 return html.replace(/<(\/?)(p|h[1-6]|div|section|blockquote|ul|ol|li|figure|figcaption|table|tr|td|th|caption|pre)([^>]*)>/g,(_,closing,name,attributes)=>closing?'</span>':`<span class="note-${name}" style="display:block"${attributes}>`);
}

/** BlockNote's default named palette; print colors use its light theme values. */
export function academicColor(value:unknown,background=false):string|undefined {
 const palette:Record<string,[string,string]>={gray:['9b9a97','ebeced'],brown:['64473a','e9e5e3'],red:['e03e3e','fbe4e4'],orange:['d9730d','f6e9d9'],yellow:['dfab01','fbf3db'],green:['4d6461','ddedea'],blue:['0b6e99','ddebf1'],purple:['6940a5','eae4f2'],pink:['ad1a72','f4dfeb']};
 if(typeof value!=='string')return;
 if(palette[value])return '#'+palette[value][background?1:0];
 if(/^#[\da-f]{6}$/i.test(value))return value;
 if(/^#[\da-f]{3}$/i.test(value))return '#'+value.slice(1).split('').map(char=>char+char).join('');
}
