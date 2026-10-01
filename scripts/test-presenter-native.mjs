import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), temp = mkdtempSync(path.join(os.tmpdir(), 'nodus-native-'));
try {
  const output = path.join(temp, 'protocol.cjs');
  buildSync({ entryPoints: ['electron/toolkit/presenter/nativeProtocol.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: output });
  const { nativeAction, CommandWindow } = require(output);
  for (const value of [null, {}, {type:'setTotal',total:900}, {type:'timerSync',timerSeconds:2}, {type:'navigate',slide:NaN}, {type:'videoSeek',time:Infinity}, {type:'toolData',data:{tool:'draw',x:101,y:4}}, {type:'setToolColor',color:'url(secret)'}]) assert.equal(nativeAction(value), null);
  assert.deepEqual(nativeAction({type:'next',path:'/private'}), {type:'next'});
  assert.equal(nativeAction({type:'toolData',data:{tool:'draw',x:12,y:25,action:'start',color:'#abcdef',lineWidth:4}})?.data.x, 12);
  const window = new CommandWindow(), id = '12345678-1234-1234-1234-123456789abc';
  assert.equal(window.accept(id), true); assert.equal(window.accept(id), false); assert.equal(window.accept('bad'), false);
  console.log('PASS: bounded native actions and duplicate command rejection');
  if (process.platform === 'darwin') {
    execFileSync(process.execPath, ['scripts/build-presenter-native.cjs'], {stdio:'inherit'});
    const binary = path.join(temp,'native-test');
    execFileSync('xcrun', ['swiftc','-swift-version','5', 'build/presenter-native/Protocol.swift','build/presenter-native/Transport.swift','scripts/native-presenter/main.swift','-o',binary], {stdio:'inherit'});
    execFileSync(binary, [path.resolve(`build/presenter-native/${process.arch}/nodus-presenter-native`)], {stdio:'inherit',timeout:30000});
  }
} finally { rmSync(temp,{recursive:true,force:true}); }
