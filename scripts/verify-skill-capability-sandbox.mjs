// Real Chromium verification for third-party capabilities. No credentials or external network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-sandbox-'));
try {
  const outfile = path.join(temporary, 'main.cjs');
  // The child reports through this file: a killed or crashed run leaves it absent
  // rather than being mistaken for success.
  const verdict = path.join(temporary, 'verdict.txt');
  await build({ stdin: { contents: `
    import { app } from 'electron';
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { runCapabilitySandbox, registerCapabilitySchemePrivileges } from './skill-capabilities/sandbox/runtime';
    registerCapabilitySchemePrivileges();
    app.setPath('userData', ${JSON.stringify(temporary)}); app.on('window-all-closed', () => {});
    const manifest = (tools, permissions={}) => ({schemaVersion:1,id:'calculate',version:'1.0.0',description:'Test',runtime:'javascript-sandbox-v1',entry:'runtime.js',tools,permissions});
    const runtime = (source, tools, permissions={}) => ({pluginId:'sandbox-test',pluginVersion:'1.0.0',pluginDigest:'a'.repeat(64),capabilityId:'sandbox-test:calculate',manifest:manifest(tools,permissions),source,permissions});
    const tool = (id='inspect', resultKinds=['json']) => ({id,description:'Test',inputSchema:{type:'object',additionalProperties:true},resultKinds});
    const invoke = (source, input={}, tools=[tool()], permissions={}) => runCapabilitySandbox(runtime(source,tools,permissions),{skillId:'test',capabilityId:'sandbox-test:calculate',toolId:tools[0].id,input});
    let stage='start';
    app.whenReady().then(async()=>{try{
      // Isolation: no Node, no require, no app bridge, no WebRTC, no secret handle.
      stage='assertion 1';
      assert.deepEqual(await invoke('(request,host)=>({kind:"json",value:{sum:request.input.values.reduce((a,b)=>a+b,0),node:typeof process,require:typeof require,bridge:typeof window.nodus,webrtc:typeof RTCPeerConnection,secrets:typeof host.secrets}})',{values:[2,4,6]}),{kind:'json',value:{sum:12,node:'undefined',require:'undefined',bridge:'undefined',webrtc:'undefined',secrets:'undefined'}});
      // Storage is namespaced, survives within a call and is refused without permission.
      stage='assertion 2';
      assert.deepEqual(await invoke('async (_request,host)=>{await host.storage.set({count:7});return {kind:"json",value:await host.storage.get()}}',{},[tool()],{storage:{maxBytes:2048}}),{kind:'json',value:{count:7}});
      stage='assertion 3';
      assert.deepEqual(await invoke('async (_request,host)=>{try{await host.storage.get();return {kind:"text",text:"allowed"}}catch(error){return {kind:"text",text:error.message}}}',{},[tool('inspect',['text'])]),{kind:'text',text:'Capability storage is not permitted.'});
      // Quota is enforced by the host, never by the runtime.
      stage='assertion 4';
      assert.deepEqual(await invoke('async (_request,host)=>{try{await host.storage.set({blob:"x".repeat(4096)});return {kind:"text",text:"allowed"}}catch(error){return {kind:"text",text:error.message}}}',{},[tool('inspect',['text'])],{storage:{maxBytes:64}}),{kind:'text',text:'Capability storage quota exceeded.'});
      // Network allowlist: undeclared endpoints, private hosts, unpermitted paths and methods.
      stage='assertion 5';
      assert.deepEqual(await invoke('async (_request,host)=>{try{await host.network.request("other",{path:"/v1"});return {kind:"text",text:"allowed"}}catch(error){return {kind:"text",text:error.message}}}',{},[tool('inspect',['text'])],{network:[{id:'local',origin:'https://localhost',pathPrefixes:['/v1'],methods:['GET']}]}),{kind:'text',text:'Capability endpoint is not permitted.'});
      stage='assertion 6';
      assert.deepEqual(await invoke('async (_request,host)=>{try{await host.network.request("local",{path:"/v1",method:"GET"});return {kind:"text",text:"allowed"}}catch(error){return {kind:"text",text:error.message}}}',{},[tool('inspect',['text'])],{network:[{id:'local',origin:'https://localhost',pathPrefixes:['/v1'],methods:['GET']}]}),{kind:'text',text:'Capability network target is not public.'});
      stage='assertion 7';
      assert.deepEqual(await invoke('async (_request,host)=>{try{await host.network.request("api",{path:"/other"});return {kind:"text",text:"allowed"}}catch(error){return {kind:"text",text:error.message}}}',{},[tool('inspect',['text'])],{network:[{id:'api',origin:'https://example.com',pathPrefixes:['/v1'],methods:['GET']}]}),{kind:'text',text:'Capability network request exceeds its permission.'});
      stage='assertion 8';
      assert.deepEqual(await invoke('async (_request,host)=>{try{await host.network.request("api",{path:"/v1",method:"DELETE"});return {kind:"text",text:"allowed"}}catch(error){return {kind:"text",text:error.message}}}',{},[tool('inspect',['text'])],{network:[{id:'api',origin:'https://example.com',pathPrefixes:['/v1'],methods:['GET']}]}),{kind:'text',text:'Capability network request exceeds its permission.'});
      // Direct network and unknown host operations never reach the outside world.
      stage='assertion 9';
      assert.deepEqual(await invoke('async()=>{try{await fetch("https://example.com");return {kind:"text",text:"allowed"}}catch{return {kind:"text",text:"denied"}}}',{},[tool('inspect',['text'])]),{kind:'text',text:'denied'});
      stage='assertion 10';
      assert.deepEqual(await invoke('async()=>{try{const r=await fetch("nodus-capability://host/rpc",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({method:"shell.exec",args:{}})});const p=await r.json();return {kind:"text",text:p.ok?"allowed":p.error}}catch{return {kind:"text",text:"denied"}}}',{},[tool('inspect',['text'])]),{kind:'text',text:'Unknown capability host operation.'});
      // Results are inert data: markup and undeclared kinds are refused.
      stage='assertion 11';
      await assert.rejects(invoke('()=>({kind:"text",text:"<b>executable markup</b>"})',{},[tool('inspect',['text'])]),/HTML is not accepted/);
      stage='assertion 12';
      await assert.rejects(invoke('()=>({kind:"text",text:"<script>alert(1)</script>"})',{},[tool('inspect',['json'])]),/undeclared result kind/);
      const strictTool={id:'sum',description:'Sum',inputSchema:{type:'object',properties:{values:{type:'array',items:{type:'number'}}},required:['values'],additionalProperties:false},resultKinds:['json']};
      stage='assertion 13';
      await assert.rejects(invoke('()=>({kind:"json",value:null})',{values:['bad']},[strictTool]),/does not match/);
      // A runaway or cancelled capability never hangs the caller.
      stage='assertion 14';
      await assert.rejects(invoke('()=>new Promise(()=>{})'),/time limit/);
      const aborter=new AbortController(); const pending=runCapabilitySandbox(runtime('()=>new Promise(()=>{})',[tool()]),{skillId:'test',capabilityId:'sandbox-test:calculate',toolId:'inspect',input:{}},aborter.signal); setTimeout(()=>aborter.abort(),50); await assert.rejects(pending,{name:'AbortError'});
      fs.writeFileSync(${JSON.stringify(verdict)},'PASS');
      console.log('CAPABILITY SANDBOX PASS: Chromium isolation, no Node/bridge/WebRTC/direct network, RPC allowlist, storage quota, schemas, timeout and cancellation.');
      app.exit(0);
    }catch(error){console.error(error);fs.writeFileSync(${JSON.stringify(verdict)},'FAIL at '+stage+': '+(error&&error.stack||error));app.exit(1)}});`, resolveDir: root, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' });
  const env = { ...process.env, NODUS_CAPABILITY_TEST_TIMEOUT_MS: '2000' }; delete env.ELECTRON_RUN_AS_NODE;
  let stdout = '';
  try {
    ({ stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [outfile], { env, timeout: 120_000 }));
  } catch (error) {
    process.stderr.write(`${error.stdout ?? ''}${error.stderr ?? ''}`);
    throw new Error(`The capability sandbox run did not complete (code ${error.code ?? 'none'}, signal ${error.signal ?? 'none'}): ${fs.existsSync(verdict) ? fs.readFileSync(verdict, 'utf8') : 'no verdict was written'}`);
  }
  const recorded = fs.existsSync(verdict) ? fs.readFileSync(verdict, 'utf8') : '';
  if (recorded !== 'PASS') throw new Error(`The capability sandbox run exited without passing: ${recorded || 'no verdict was written'}`);
  console.log(stdout.trim() || 'CAPABILITY SANDBOX PASS');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
