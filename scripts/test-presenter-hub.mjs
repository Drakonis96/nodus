import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const temp = mkdtempSync(path.join(os.tmpdir(), 'nodus-hub-')), require = createRequire(import.meta.url);
const m = globalThis.__presenterHubTest = { windows: [], nativeEvents: [], webEvents: [] };
const stubs = {
  electron: `import {EventEmitter} from 'node:events'; const m=globalThis.__presenterHubTest;
    export const app={getPath:()=>'/tmp/nodus-hub-test'};
    export const screen={getAllDisplays:()=>[{bounds:{x:0,y:0,width:1000,height:800}}],getPrimaryDisplay:()=>({bounds:{x:0,y:0,width:1000,height:800}})};
    export const powerSaveBlocker={start:()=>1,isStarted:()=>true,stop:()=>{}};
    export class BrowserWindow extends EventEmitter {
      constructor(){super();this.dead=false;this.webContents={send:(...args)=>m.windowEvents.push(args)};m.windows.push(this)}
      static getAllWindows(){return m.windows.filter(w=>!w.dead)}
      static fromWebContents(wc){return m.windows.find(w=>w.webContents===wc)}
      isDestroyed(){return this.dead} loadURL(){} loadFile(){} close(){this.dead=true;this.emit('closed')}
    }`,
  settingsRepo: `export const getSettings=()=>({uiLanguage:'es'});`,
  server: `const m=globalThis.__presenterHubTest; export const startPresenterServer=async d=>{m.web=d}; export const stopPresenterServer=()=>{}; export const broadcastToClients=(a,id)=>m.webEvents.push({a,id}); export const getPresenterServerInfo=()=>({ip:'127.0.0.1',port:1234,pin:'123456',url:'http://127.0.0.1:1234/presenterRemote.html'});`,
  native: `const m=globalThis.__presenterHubTest; export const startNativePresenter=d=>{m.native=d}; export const stopNativePresenter=()=>{}; export const broadcastNativePresenter=(a,origin)=>m.nativeEvents.push({a,origin}); export const getNativePresenterInfo=()=>({url:'nodus-presenter://pair?test',name:'Test Mac'});`,
  systemAudio: `export const getSystemVolume=async()=>50; export const setSystemVolume=async()=>{};`,
};
try {
  m.windowEvents=[];
  await build({entryPoints:['electron/toolkit/presenter/windows.ts'],outfile:path.join(temp,'hub.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'hub-boundaries',setup(b){
    b.onResolve({filter:/^(electron|.*settingsRepo|\.\/server|\.\/native|\.\/systemAudio)$/}, args=>path.basename(args.importer) === 'windows.ts' ? ({path:args.path==='electron'?'electron':args.path.split('/').at(-1),namespace:'mock'}) : undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:stubs[args.path],loader:'js'}));
  }}]});
  const h = require(path.join(temp,'hub.cjs'));
  h.startPresentation('fixture',1,false);
  assert.equal(h.getPresenterRuntimeState().timerRunning,false);
  h.handlePresenterControl(m.windows[0].webContents,{type:'setTotal',total:5});
  m.native.onAction({type:'next'},'iphone');
  assert.equal(h.getPresenterRuntimeState().currentSlide,2);
  assert.equal(m.webEvents.at(-1).a.type,'next'); assert.equal(m.nativeEvents.at(-1).origin,'iphone');
  m.native.onAction({type:'timerToggle'},'iphone');
  // The tick is anchored at presentation start, before the control message.
  // Its first callback can therefore precede a full elapsed second. Wait for
  // the observed tick with a bounded deadline instead of assuming its phase.
  const tickDeadline = Date.now() + 5000;
  while (h.getPresenterRuntimeState().timerSeconds < 1 && Date.now() < tickDeadline) {
    await new Promise(r=>setTimeout(r,50));
  }
  assert.ok(h.getPresenterRuntimeState().timerSeconds>=1,'Audience-only mode keeps time without presenter window');
  m.web.onRemoteAction({type:'timerToggle'},42);
  const paused=h.getPresenterRuntimeState().timerSeconds;
  await new Promise(r=>setTimeout(r,1100));
  assert.equal(h.getPresenterRuntimeState().timerSeconds,paused);
  m.native.onAction({type:'timerReset'},'iphone'); assert.equal(h.getPresenterRuntimeState().timerSeconds,0);
  const info=await h.getServerInfoWithQr(); assert.equal(info.pin,'123456'); assert.ok(info.native.qr.startsWith('data:image/png')); assert.ok(!info.url.includes('pin'));
  h.stopPresentation(); assert.equal(h.getPresenterRuntimeState().presenting,false);
  console.log('PASS: native/web/window fanout, audience-only timer, stop and QR choices');
} finally { rmSync(temp,{recursive:true,force:true}); delete globalThis.__presenterHubTest; }
