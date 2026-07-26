import AdmZip from 'adm-zip';
import { isToolkitAppManifest, type ToolkitAppManifest } from '@shared/toolkitApps';
import { localizedIncludedToolkitAppMeta } from '@shared/toolkitAppsI18n';
import type { AppLanguage } from '@shared/types';

function safeFileStem(value: string): string {
  const normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'nodus-app';
}

function scriptText(value: string): string {
  return value.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

export function toolkitAppPackageFileName(manifest: ToolkitAppManifest, language: AppLanguage = 'es'): string {
  return `${safeFileStem(localizedIncludedToolkitAppMeta(manifest, language).title)}.zip`;
}

type PackageCopy = {
  openHeading: string;
  openBody: string;
  contentsHeading: string;
  indexItem: string;
  manifestItem: string;
  sourceItem: string;
  multiplayer: string;
};

const PACKAGE_COPY: Record<AppLanguage, PackageCopy> = {
  es: { openHeading: 'Abrir la app', openBody: 'Abre `index.html` en un navegador moderno. La app funciona sin instalar nada y guarda sus datos localmente en ese navegador.', contentsHeading: 'Contenido del paquete', indexItem: 'versión lista para usar.', manifestItem: 'paquete original compatible con Nodus Apps.', sourceItem: 'HTML, CSS y JavaScript separados para conservar y modificar la app.', multiplayer: 'La conexión multijugador por QR requiere ejecutar la app dentro de Nodus. La versión descargada permanece sin conexión a Internet.' },
  en: { openHeading: 'Open the app', openBody: 'Open `index.html` in a modern browser. The app works without installation and stores its data locally in that browser.', contentsHeading: 'Package contents', indexItem: 'ready-to-use version.', manifestItem: 'original package compatible with Nodus Apps.', sourceItem: 'separate HTML, CSS and JavaScript files for preserving and modifying the app.', multiplayer: 'QR multiplayer requires running the app inside Nodus. The downloaded version remains offline.' },
  fr: { openHeading: 'Ouvrir l’app', openBody: 'Ouvrez `index.html` dans un navigateur récent. L’app fonctionne sans installation et enregistre ses données localement dans ce navigateur.', contentsHeading: 'Contenu du paquet', indexItem: 'version prête à l’emploi.', manifestItem: 'paquet original compatible avec Nodus Apps.', sourceItem: 'fichiers HTML, CSS et JavaScript séparés pour conserver et modifier l’app.', multiplayer: 'La connexion multijoueur par QR nécessite d’exécuter l’app dans Nodus. La version téléchargée reste hors ligne.' },
  de: { openHeading: 'App öffnen', openBody: 'Öffnen Sie `index.html` in einem modernen Browser. Die App funktioniert ohne Installation und speichert ihre Daten lokal in diesem Browser.', contentsHeading: 'Paketinhalt', indexItem: 'sofort verwendbare Version.', manifestItem: 'mit Nodus Apps kompatibles Originalpaket.', sourceItem: 'getrennte HTML-, CSS- und JavaScript-Dateien zum Aufbewahren und Bearbeiten der App.', multiplayer: 'QR-Mehrspielerfunktionen erfordern, dass die App in Nodus ausgeführt wird. Die heruntergeladene Version bleibt offline.' },
  pt: { openHeading: 'Abrir a app', openBody: 'Abre `index.html` num navegador moderno. A app funciona sem instalação e guarda os dados localmente nesse navegador.', contentsHeading: 'Conteúdo do pacote', indexItem: 'versão pronta a usar.', manifestItem: 'pacote original compatível com o Nodus Apps.', sourceItem: 'ficheiros HTML, CSS e JavaScript separados para conservar e modificar a app.', multiplayer: 'A ligação multijogador por QR requer a execução da app no Nodus. A versão transferida permanece offline.' },
  'pt-BR': { openHeading: 'Abrir o app', openBody: 'Abra `index.html` em um navegador moderno. O app funciona sem instalação e salva os dados localmente nesse navegador.', contentsHeading: 'Conteúdo do pacote', indexItem: 'versão pronta para uso.', manifestItem: 'pacote original compatível com o Nodus Apps.', sourceItem: 'arquivos HTML, CSS e JavaScript separados para preservar e modificar o app.', multiplayer: 'A conexão multijogador por QR exige que o app seja executado no Nodus. A versão baixada permanece offline.' },
  it: { openHeading: 'Apri l’app', openBody: 'Apri `index.html` in un browser moderno. L’app funziona senza installazione e salva i dati localmente nel browser.', contentsHeading: 'Contenuto del pacchetto', indexItem: 'versione pronta all’uso.', manifestItem: 'pacchetto originale compatibile con Nodus Apps.', sourceItem: 'file HTML, CSS e JavaScript separati per conservare e modificare l’app.', multiplayer: 'La connessione multigiocatore tramite QR richiede l’esecuzione dell’app in Nodus. La versione scaricata rimane offline.' },
  tr: { openHeading: 'Uygulamayı açın', openBody: '`index.html` dosyasını modern bir tarayıcıda açın. Uygulama kurulum gerektirmeden çalışır ve verilerini o tarayıcıda yerel olarak saklar.', contentsHeading: 'Paket içeriği', indexItem: 'kullanıma hazır sürüm.', manifestItem: 'Nodus Apps ile uyumlu özgün paket.', sourceItem: 'uygulamayı saklamak ve değiştirmek için ayrı HTML, CSS ve JavaScript dosyaları.', multiplayer: 'QR ile çok oyunculu bağlantı için uygulamanın Nodus içinde çalıştırılması gerekir. İndirilen sürüm çevrimdışı kalır.' },
};

/** A local compatibility layer keeps storage-backed apps useful outside Nodus. */
export function renderStandaloneToolkitApp(manifest: ToolkitAppManifest, language: AppLanguage = 'es'): string {
  if (!isToolkitAppManifest(manifest)) throw new Error('La app no es válida y no se puede empaquetar.');
  const meta = localizedIncludedToolkitAppMeta(manifest, language);
  const storageKey = `nodus-export:${safeFileStem(manifest.title)}`;
  const shim = `(()=>{'use strict';const key=${JSON.stringify(storageKey)};let memory={};const read=()=>{try{const value=JSON.parse(localStorage.getItem(key)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return memory}};const write=(value)=>{memory=value;try{localStorage.setItem(key,JSON.stringify(value))}catch{}};const storage=Object.freeze({available:true,get:async(name)=>read()[String(name)]??null,set:async(name,value)=>{const state=read();state[String(name)]=value;write(state);return true},remove:async(name)=>{const state=read();delete state[String(name)];write(state);return true},clear:async()=>{write({});return true}});const session=Object.freeze({available:false,role:'host',participant:null,send:()=>false,onMessage:()=>()=>{}});Object.defineProperty(window,'nodus',{value:Object.freeze({locale:${JSON.stringify(language)},storage,session}),writable:false,configurable:false});})();`;
  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${meta.title.replace(/[<>&"]/g, '')}</title><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select,textarea{font:inherit}${manifest.files.css}</style></head>
<body>${manifest.files.html}<script>${scriptText(shim)}</script><script>${scriptText(manifest.files.javascript)}</script></body></html>`;
}

export function buildToolkitAppPackage(manifest: ToolkitAppManifest, language: AppLanguage = 'es'): Buffer {
  if (!isToolkitAppManifest(manifest)) throw new Error('La app no es válida y no se puede empaquetar.');
  const copy = PACKAGE_COPY[language];
  const meta = localizedIncludedToolkitAppMeta(manifest, language);
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from(renderStandaloneToolkitApp(manifest, language), 'utf8'));
  zip.addFile('nodus-app.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
  zip.addFile('src/index.html', Buffer.from(`${manifest.files.html}\n`, 'utf8'));
  zip.addFile('src/styles.css', Buffer.from(`${manifest.files.css}\n`, 'utf8'));
  zip.addFile('src/app.js', Buffer.from(`${manifest.files.javascript}\n`, 'utf8'));
  zip.addFile('README.md', Buffer.from(`# ${meta.title}\n\n${meta.summary}\n\n## ${copy.openHeading}\n\n${copy.openBody}\n\n## ${copy.contentsHeading}\n\n- \`index.html\`: ${copy.indexItem}\n- \`nodus-app.json\`: ${copy.manifestItem}\n- \`src/\`: ${copy.sourceItem}\n\n${copy.multiplayer}\n`, 'utf8'));
  return zip.toBuffer();
}
