// Real Chromium sandbox verification; no provider calls, no user profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-skill-sandbox-'));
try {
  const outfile = path.join(temporary, 'main.cjs');
  await build({ stdin: { contents: `
    import { app } from 'electron';
    import assert from 'node:assert/strict';
    import { runSkillTool } from './electron/skillToolSandbox';
    app.setPath('userData', ${JSON.stringify(temporary)});
    app.on('window-all-closed', () => {});
    app.whenReady().then(async () => {
      const run = source => runSkillTool({ id: 'test', description: 'Test', source }, { values: [2,4,6] });
      try {
        assert.equal(await run('(input) => ({ sum: input.values.reduce((a,b)=>a+b,0) })'), '{"sum":12}');
        assert.equal(await run('() => ({node: typeof process, require: typeof require, bridge: typeof window.nodus})'), '{"node":"undefined","require":"undefined","bridge":"undefined"}');
        assert.equal(await run('() => typeof RTCPeerConnection'), '"undefined"');
        assert.equal(await run('async () => { try { await fetch("https://example.com"); return "network allowed"; } catch { return "network denied"; } }'), '"network denied"');
        await assert.rejects(run('() => { while(true) {} }'), /time limit/);
        await assert.rejects(run('() => "x".repeat(64001)'), /64 KB/);
        const aborter = new AbortController();
        const pending = runSkillTool({ id: 'pending', description: 'Test cancellation', source: 'async () => new Promise(() => {})' }, {}, aborter.signal);
        setTimeout(() => aborter.abort(), 100);
        await assert.rejects(pending, { name: 'AbortError' });
        console.log('SANDBOX PASS: computation, no Node/bridge/network, timeout, output limit, cancellation.');
        app.exit(0);
      } catch (e) { console.error(e); app.exit(1); }
    });`, resolveDir: process.cwd(), loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = await promisify(execFile)(createRequire(import.meta.url)('electron'), [outfile], { env, timeout: 25000 });
  console.log(result.stdout);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
