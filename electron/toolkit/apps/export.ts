import AdmZip from 'adm-zip';
import { isToolkitAppManifest, type ToolkitAppManifest } from '@shared/toolkitApps';

function safeFileStem(value: string): string {
  const normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'nodus-app';
}

function scriptText(value: string): string {
  return value.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

export function toolkitAppPackageFileName(manifest: ToolkitAppManifest): string {
  return `${safeFileStem(manifest.title)}.zip`;
}

/** A local compatibility layer keeps storage-backed apps useful outside Nodus. */
export function renderStandaloneToolkitApp(manifest: ToolkitAppManifest): string {
  if (!isToolkitAppManifest(manifest)) throw new Error('La app no es válida y no se puede empaquetar.');
  const storageKey = `nodus-export:${safeFileStem(manifest.title)}`;
  const shim = `(()=>{'use strict';const key=${JSON.stringify(storageKey)};let memory={};const read=()=>{try{const value=JSON.parse(localStorage.getItem(key)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return memory}};const write=(value)=>{memory=value;try{localStorage.setItem(key,JSON.stringify(value))}catch{}};const storage=Object.freeze({available:true,get:async(name)=>read()[String(name)]??null,set:async(name,value)=>{const state=read();state[String(name)]=value;write(state);return true},remove:async(name)=>{const state=read();delete state[String(name)];write(state);return true},clear:async()=>{write({});return true}});const session=Object.freeze({available:false,role:'host',participant:null,send:()=>false,onMessage:()=>()=>{}});Object.defineProperty(window,'nodus',{value:Object.freeze({storage,session}),writable:false,configurable:false});})();`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${manifest.title.replace(/[<>&"]/g, '')}</title><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select,textarea{font:inherit}${manifest.files.css}</style></head>
<body>${manifest.files.html}<script>${scriptText(shim)}</script><script>${scriptText(manifest.files.javascript)}</script></body></html>`;
}

export function buildToolkitAppPackage(manifest: ToolkitAppManifest): Buffer {
  if (!isToolkitAppManifest(manifest)) throw new Error('La app no es válida y no se puede empaquetar.');
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from(renderStandaloneToolkitApp(manifest), 'utf8'));
  zip.addFile('nodus-app.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
  zip.addFile('src/index.html', Buffer.from(`${manifest.files.html}\n`, 'utf8'));
  zip.addFile('src/styles.css', Buffer.from(`${manifest.files.css}\n`, 'utf8'));
  zip.addFile('src/app.js', Buffer.from(`${manifest.files.javascript}\n`, 'utf8'));
  zip.addFile('README.md', Buffer.from(`# ${manifest.title}\n\n${manifest.summary}\n\n## Abrir la app\n\nAbre \`index.html\` en un navegador moderno. La app funciona sin instalar nada y guarda sus datos localmente en ese navegador.\n\n## Contenido del paquete\n\n- \`index.html\`: versión lista para usar.\n- \`nodus-app.json\`: paquete original compatible con Nodus Apps.\n- \`src/\`: HTML, CSS y JavaScript separados para conservar y modificar la app.\n\nLa conexión multijugador por QR requiere ejecutar la app dentro de Nodus. La versión descargada permanece sin conexión a Internet.\n`, 'utf8'));
  return zip.toBuffer();
}
