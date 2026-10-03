import { mathjax } from '@mathjax/src/mjs/mathjax.js';
import { TeX } from '@mathjax/src/mjs/input/tex.js';
import { SVG } from '@mathjax/src/mjs/output/svg.js';
import { liteAdaptor } from '@mathjax/src/mjs/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/mjs/handlers/html.js';
import '@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/mjs/input/tex/newcommand/NewcommandConfiguration.js';
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/mjs/svg.js';
const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
const document=mathjax.document('',{InputJax:new TeX({packages:['base','ams','newcommand']}),OutputJax:new SVG({fontCache:'none',fontData:MathJaxNewcmFont})});
export function academicFormulaSvg(formula:string):string {
 if(formula.length>10000 || /\\(?:input|include|write|openout|read|catcode|csname|usepackage|documentclass|href|url|html)/i.test(formula))throw new Error('Fórmula no compatible con una entrega segura.');
 const node=document.convert(formula,{display:false});const svg=adaptor.outerHTML(node);if(svg.includes('data-mjx-error'))throw new Error('Fórmula inválida.');return svg;
}
