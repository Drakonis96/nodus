import type { ToolkitAppManifest } from './toolkitApps';
import type { AppLanguage } from './types';

export interface ToolkitAppRuntimeConfig {
  token: string;
  language: AppLanguage;
  storage: boolean;
  session: {
    available: boolean;
    role: 'host' | 'participant';
    participant: { id: number; name: string } | null;
  };
}

export interface ToolkitAppDocumentOptions {
  runtimeScriptUrl?: string;
  appScriptUrl?: string;
}

function scriptText(value: string): string {
  return value.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

function jsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function buildToolkitAppRuntimeScript(config: ToolkitAppRuntimeConfig): string {
  return `(()=>{
    'use strict';
    const config=${jsonScript(config)};
    const pending=new Map();
    const listeners=new Set();
    let requestId=0;
    const send=(type,data={})=>window.parent.postMessage({source:'nodus-miniapp',token:config.token,type,...data},'*');
    const request=(type,data={})=>new Promise((resolve,reject)=>{
      const id=String(++requestId);pending.set(id,{resolve,reject});send(type,{id,...data});
      setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error('Nodus no respondió a tiempo.'))}},5000);
    });
    window.addEventListener('message',(event)=>{
      const message=event.data;
      if(!message||message.source!=='nodus-host'||message.token!==config.token)return;
      if(message.type==='response'){
        const item=pending.get(message.id);if(!item)return;pending.delete(message.id);
        if(message.ok)item.resolve(message.value);else item.reject(new Error(message.error||'Operación no disponible.'));
      }
      if(message.type==='session:message')listeners.forEach(listener=>{try{listener(message.message)}catch(error){console.error(error)}});
    });
    const unavailable=()=>Promise.reject(new Error('Esta capacidad no está activada para la app.'));
    const api=Object.freeze({
      locale:config.language,
      storage:Object.freeze({
        available:config.storage,
        get:(key)=>config.storage?request('storage:get',{key}):unavailable(),
        set:(key,value)=>config.storage?request('storage:set',{key,value}):unavailable(),
        remove:(key)=>config.storage?request('storage:remove',{key}):unavailable(),
        clear:()=>config.storage?request('storage:clear'):unavailable(),
      }),
      session:Object.freeze({
        available:config.session.available,
        role:config.session.role,
        participant:config.session.participant,
        send:(channel,payload)=>{if(!config.session.available)return false;send('session:send',{channel,payload});return true},
        onMessage:(listener)=>{if(typeof listener!=='function')return()=>{};listeners.add(listener);return()=>listeners.delete(listener)},
      }),
    });
    Object.defineProperty(window,'nodus',{value:api,writable:false,configurable:false,enumerable:true});
    window.addEventListener('error',(event)=>send('runtime:error',{message:String(event.message||'Error en la mini-app').slice(0,500)}));
    window.addEventListener('unhandledrejection',(event)=>send('runtime:error',{message:String(event.reason?.message||event.reason||'Promesa rechazada').slice(0,500)}));
    send('runtime:ready');
  })();`;
}

/** Build the only document in which generated code is allowed to execute. */
export function buildToolkitAppDocument(manifest: ToolkitAppManifest, config: ToolkitAppRuntimeConfig, options: ToolkitAppDocumentOptions = {}): string {
  const runtime = buildToolkitAppRuntimeScript(config);
  const externalScripts = Boolean(options.runtimeScriptUrl && options.appScriptUrl);
  const scriptPolicy = externalScripts ? 'blob: data:' : "'unsafe-inline'";
  const scripts = externalScripts
    ? `<script src="${options.runtimeScriptUrl}"></script>\n<script src="${options.appScriptUrl}"></script>`
    : `<script>${scriptText(runtime)}</script>\n<script>${scriptText(manifest.files.javascript)}</script>`;

  return `<!doctype html>
<html lang="${config.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${scriptPolicy}; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select,textarea{font:inherit}${manifest.files.css}</style></head>
<body>${manifest.files.html}
${scripts}
</body></html>`;
}
