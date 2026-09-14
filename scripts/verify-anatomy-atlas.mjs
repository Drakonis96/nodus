// Real package import, real Chromium, real chat-result routing. Synthetic conversations only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const checkout=process.env.NODUS_MARKETPLACE_CHECKOUT;
if(!checkout)throw new Error('Set NODUS_MARKETPLACE_CHECKOUT to the marketplace under test.');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-anatomy-atlas-'));
const verdict=path.join(scratch,'verdict.json');
try{
 const outfile=path.join(scratch,'main.cjs');
 await build({stdin:{contents:`
 import {app} from 'electron';
 import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
 import {initializePluginStore,readPluginDirectory,installPluginPackage,resolveInstalledCapability,readActivePluginPackage,pluginPackageDigest} from './electron/skillPlugins';
 import {registerCapabilitySchemePrivileges,runCapabilitySandbox} from './skill-capabilities/sandbox/runtime';
 import {executeExternalCapability} from './skill-capabilities/external/main';
 import {getCapabilityFile,reconcileChatAssets} from './electron/chatAssets';
 import {validateModelAsset} from './packages/capability-api/src/models';
 import {SANDBOXED_CALL_LIMIT} from './skill-capabilities/contracts';
 import {excludeInvisibleArtifacts} from './electron/capabilities/modelHistory';
 registerCapabilitySchemePrivileges();app.setPath('userData',${JSON.stringify(scratch)});app.on('window-all-closed',()=>{});
 app.whenReady().then(async()=>{try{
  initializePluginStore();const pkg=readPluginDirectory(${JSON.stringify(path.join(checkout,'anatomy-visualization'))});
  const installed=installPluginPackage(pkg,{sourceId:'atlas-test'});assert.equal(installed.activated,true);
  const stored=readActivePluginPackage(pkg.manifest.id);assert.equal(pluginPackageDigest(pkg),pluginPackageDigest(stored));
  const runtime=resolveInstalledCapability('anatomy-visualization:anatomy');assert.ok(runtime);
  assert.throws(()=>runtime.readAsset('../other-plugin'),/not declared/);
  assert.throws(()=>runtime.readAsset('/etc/passwd'),/not declared/);
  const skill={id:'atlas-test',name:'Anatomy Visualization',instructions:'Synthetic fixture',capabilities:['anatomy-visualization:anatomy','nodus:3d'],tools:[],enabled:{assistant:true,nodi:true},plugin:{id:pkg.manifest.id,version:installed.state.activeVersion,digest:installed.state.activeDigest}};
  const tests=[['render-anatomy',{structures:['liver','kidneys'],labelMode:'numbers',legend:false}],['list-supported-structures',{dimension:'model',search:'femur'}],['query-anatomy',{structure:'kidney',relation:'has-part'}],['render-anatomy-3d',{structures:['kidneys','uterus','ovaries','prostate'],sex:'both'}]];
  const snapshots=[];
  for(const [surface,owner] of [['assistant','a'.repeat(64)],['nodi','b'.repeat(64)]]){
    const budget={sandboxed:0,metered:0},messages=[];
    for(const [toolId,input] of tests){
      const invocation={skillId:skill.id,capabilityId:'anatomy-visualization:anatomy',toolId,input};
      const output=await executeExternalCapability(JSON.stringify(invocation),true,{skills:[skill],owner,version:0,isCurrent:()=>true},budget);
      assert.ok(!output.includes('Capability error:'),output.slice(0,600));messages.push({content:output});
      if(toolId==='render-anatomy-3d'){
        assert.equal(excludeInvisibleArtifacts(output).trim(),'[3D model result retained on this device]');
        assert.ok(!excludeInvisibleArtifacts(JSON.stringify({history:output})).includes('HuBMAP'));
        assert.ok(output.includes('HuBMAP'),'Attribution remains in application-managed presentation');
        const references=[...output.matchAll(/nodus-capability:\\/\\/chat\\/[a-f0-9]{64}\\/[a-f0-9-]{36}/g)].map(m=>m[0]);
        assert.ok(references.length>=4);
        reconcileChatAssets(owner,messages);
        for(const reference of references){const file=getCapabilityFile(reference);assert.ok(file);const info=validateModelAsset(file.blob,file.mimeType);assert.ok(info.meshes);}
      }
    }
    assert.equal(budget.sandboxed,4);assert.equal(budget.metered,0);snapshots.push({surface,tools:tests.length,status:'passed'});
  }
  const invocation={skillId:skill.id,capabilityId:'anatomy-visualization:anatomy',toolId:'render-anatomy-3d',input:{structures:['kidney']}};
  const execution={skills:[{...skill,capabilities:['anatomy-visualization:anatomy']}],owner:'c'.repeat(64),version:0,isCurrent:()=>true};
  assert.match(await executeExternalCapability(JSON.stringify(invocation),true,execution,{sandboxed:0,metered:0}),/nodus:3d/);
  assert.match(await executeExternalCapability(JSON.stringify(invocation),true,{...execution,skills:[]},{sandboxed:0,metered:0}),/not enabled/);
  assert.match(await executeExternalCapability(JSON.stringify(invocation),true,{...execution,skills:[skill]},{sandboxed:SANDBOXED_CALL_LIMIT,metered:0}),/sandboxed tool and capability calls/);
  await assert.rejects(executeExternalCapability(JSON.stringify(invocation),true,{...execution,skills:[skill],isCurrent:()=>false},{sandboxed:0,metered:0}),/deleted or changed/);
  const queryInvocation={...invocation,toolId:'query-anatomy',input:{structure:'kidney',relation:'has-part'}};
  await assert.rejects(runCapabilitySandbox({...runtime,source:'(async (request,host)=>({kind:"json",value:await host.assets.read("bodyparts3d-male")}))'},queryInvocation),/Only bounded JSON/);
  await assert.rejects(runCapabilitySandbox({...runtime,source:'(async (request,host)=>({kind:"json",value:await host.assets.read("other-plugin")}))'},queryInvocation),/not declared/);
  await assert.rejects(runCapabilitySandbox(runtime,{...invocation,input:{structures:['kidney'],url:'https://example.com'}}),/schema/);
  const aborter=new AbortController();aborter.abort();await assert.rejects(runCapabilitySandbox(runtime,invocation,aborter.signal),{name:'AbortError'});
  const file=path.join(${JSON.stringify(scratch)},'plugins/installed/anatomy-visualization/versions',installed.state.activeVersion+'-'+installed.state.activeDigest,'capabilities/anatomy/assets/atlas.json');
  const original=fs.readFileSync(file);fs.chmodSync(file,0o600);const corrupt=Buffer.from(original);corrupt[corrupt.length-10]^=1;fs.writeFileSync(file,corrupt);
  assert.throws(()=>runtime.readAsset('atlas'),/SHA-256/);fs.writeFileSync(file,original);
  fs.unlinkSync(file);fs.symlinkSync(path.join(${JSON.stringify(checkout)},'anatomy-visualization/capabilities/anatomy/assets/atlas.json'),file);
  assert.throws(()=>runtime.readAsset('atlas'),/symlinks/);
  fs.writeFileSync(${JSON.stringify(verdict)},JSON.stringify({status:'passed',snapshots}));app.exit(0);
 }catch(e){fs.writeFileSync(${JSON.stringify(verdict)},JSON.stringify({status:'failed',error:String(e.stack||e)}));app.exit(1)}});
 `,resolveDir:root,loader:'ts'},outfile,bundle:true,platform:'node',format:'cjs',external:['electron','better-sqlite3'],logLevel:'silent'});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 try{await promisify(execFile)(createRequire(import.meta.url)('electron'),[outfile],{env,timeout:180_000,maxBuffer:4_000_000});}
 catch(e){throw new Error(fs.existsSync(verdict)?fs.readFileSync(verdict,'utf8'):String(e.stderr||e));}
 const result=JSON.parse(fs.readFileSync(verdict,'utf8'));assertPassed(result);console.log(JSON.stringify(result));
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
function assertPassed(result){if(result.status!=='passed')throw new Error(JSON.stringify(result));}
