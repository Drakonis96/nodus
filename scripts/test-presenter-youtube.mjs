import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(os.tmpdir(), 'nodus-youtube-'));
const bundle = path.join(temp, 'youtube.cjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [path.join(root, 'src/lib/presenter/youtube.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`], {stdio:'inherit'});
const source = readFileSync(bundle, 'utf8');
test.after(() => rmSync(temp, {recursive:true, force:true}));

function player(origin = 'file://') {
  const messages = [], intervals = new Map(), listeners = new Map();
  let timer = 0, iframe;
  class Element {
    style = {}; attrs = {}; handlers = new Map();
    contentWindow = { postMessage: (message, target) => messages.push({data:JSON.parse(message),target}) };
    setAttribute(key,value) {this.attrs[key]=value;}
    appendChild() {}
    addEventListener(type,handler) {this.handlers.set(type,handler);}
    removeEventListener(type) {this.handlers.delete(type);}
    remove() {this.removed=true;}
  }
  const stage = new Element();
  const sandbox = {module:{exports:{}}, exports:{}, URL, location:{origin,protocol:origin.startsWith('https:')?'https:':origin.startsWith('http:')?'http:':'file:'},
    window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},
    document:{createElement:tag=>{const el=new Element();if(tag==='iframe')iframe=el;return el;}},
    getComputedStyle:()=>({position:'static'}), setInterval:fn=>{intervals.set(++timer,fn);return timer;}, clearInterval:id=>intervals.delete(id),
  };
  vm.runInNewContext(source,sandbox);
  const controller=new sandbox.module.exports.YouTubeOverlayController(stage,false);
  const video={url:'https://youtu.be/aqz-KE-bpKQ',x:0,y:0,w:100,h:100};
  controller.show(video);
  const id=new URL(iframe.src).searchParams.get('widgetid');
  const deliver=(event='initialDelivery', options={})=>listeners.get('message')?.({origin:'https://www.youtube-nocookie.com',source:iframe.contentWindow,data:JSON.stringify({id,event}),...options});
  return {controller,iframe,messages,intervals,listeners,video,id,deliver};
}

test('file-hosted presenter establishes the widget channel before sending playback',()=>{
  const p=player();
  assert.equal(new URL(p.iframe.src).searchParams.has('origin'),false);
  assert.equal(p.messages[0].data.event,'listening');
  p.controller.play();p.controller.seek(12);
  assert.equal(p.messages.some(m=>m.data.event==='command'),false,'commands wait for the iframe');
  p.deliver();
  const commands=p.messages.filter(m=>m.data.event==='command');
  assert.deepEqual(commands.map(m=>m.data.func),['playVideo','seekTo']);
  assert.deepEqual(commands[1].data.args,[12,true]);
  assert.ok(p.messages.every(m=>m.target==='https://www.youtube-nocookie.com'&&m.data.channel==='widget'&&m.data.id===p.id));
  assert.equal(p.intervals.size,0);
  p.controller.pause();
  assert.equal(p.messages.at(-1).data.func,'pauseVideo');
  p.controller.destroy();
  assert.equal(p.listeners.size,0);
});

test('loading keeps the latest intent and ignores messages from another frame or origin',()=>{
  const p=player('http://localhost:5173');
  assert.equal(new URL(p.iframe.src).searchParams.get('origin'),'http://localhost:5173');
  p.controller.play();p.controller.pause();p.controller.seek(3);p.controller.seek(8);
  p.deliver('initialDelivery',{origin:'https://example.com'});
  p.deliver('initialDelivery',{source:{}});
  p.deliver('initialDelivery',{data:JSON.stringify({id:'other',event:'initialDelivery'})});
  assert.equal(p.messages.some(m=>m.data.event==='command'),false);
  p.deliver();
  assert.deepEqual(p.messages.filter(m=>m.data.event==='command').map(m=>[m.data.func,m.data.args]),[['pauseVideo',''],['seekTo',[8,true]]]);
  p.controller.destroy();
});

test('leaving a slide discards pending playback and stops the handshake',()=>{
  const p=player();p.controller.play();p.controller.hide();p.deliver();
  assert.equal(p.intervals.size,0);
  assert.equal(p.iframe.src,'');
  assert.equal(p.messages.some(m=>m.data.event==='command'),false);
  p.controller.show(p.video);
  p.deliver(); // readiness for the previous widget must not activate the next one
  p.controller.play();
  assert.equal(p.messages.some(m=>m.data.event==='command'),false);
  const id=new URL(p.iframe.src).searchParams.get('widgetid');
  p.deliver('initialDelivery',{data:JSON.stringify({id,event:'initialDelivery'})});
  assert.equal(p.messages.at(-1).data.func,'playVideo');
  p.controller.destroy();
});

test('video volume keeps the latest loading intent, clamps and reaches the active player',()=>{
  const p=player();
  p.controller.setVolume(80);p.controller.setVolume(27);p.controller.setVolume(NaN);
  assert.equal(p.messages.some(m=>m.data.event==='command'),false);
  p.deliver();
  assert.deepEqual(p.messages.filter(m=>m.data.func==='setVolume').map(m=>m.data.args),[[27]]);
  p.controller.setVolume(-10);assert.deepEqual(p.messages.at(-1).data.args,[0]);
  p.controller.setVolume(120);assert.deepEqual(p.messages.at(-1).data.args,[100]);
  p.controller.destroy();
});
