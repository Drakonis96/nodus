import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import vm from 'node:vm';

const code = buildSync({entryPoints:['src/lib/presenter/tools.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
function overlay() {
  class Element {
    style = {}; children = []; clientWidth = 640; clientHeight = 360;
    append(...elements) { this.children.push(...elements); }
    appendChild(element) { this.children.push(element); }
    getContext() { return {clearRect(){}}; }
    remove() {}
  }
  const context = {module:{exports:{}},exports:{}, document:{createElement:()=>new Element()},getComputedStyle:()=>({position:'static'})};
  vm.runInNewContext(code,context);
  const stage = new Element(), controller = new context.module.exports.ToolOverlayController(stage,()=>null);
  return {controller,pointer:stage.children[0].children[2]};
}
test('pointer colour and halo change immediately, including before the next movement',()=>{
  const {controller,pointer}=overlay();
  controller.setActiveTool('pointer');controller.applyToolData({tool:'pointer',x:23,y:62,size:20});
  controller.setColor('#10b981');
  assert.equal(pointer.style.background,'rgba(16,185,129,0.9)');
  assert.equal(pointer.style.boxShadow,'0 0 12px 3px rgba(16,185,129,0.7)');
  assert.equal(pointer.style.left,'23%');assert.equal(pointer.style.top,'62%');
  controller.setActiveTool(null);controller.setColor('#3b82f6');controller.setActiveTool('pointer');
  assert.equal(pointer.style.background,'rgba(59,130,246,0.9)');
  controller.setColor('url(secret)');assert.equal(pointer.style.background,'rgba(59,130,246,0.9)');
});
