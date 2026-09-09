// Installs and checks the real SDK in a disposable profile. No credentials or API calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installRuntimeHooks, repoRoot } from './lib/tsRuntimeHooks.mjs';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-genomics-runtime-qa-'));
installRuntimeHooks(scratch);
const runtime = createRequire(import.meta.url)(path.join(repoRoot, 'electron/genomics.ts'));
try {
  assert.equal(runtime.getGenomicsStatus().runtimeReady, false);
  const status = await runtime.installGenomicsRuntime();
  assert.deepEqual(status, { runtimeReady: true, hasKey: false, termsAccepted: false, installing: false });
  console.log('Real runtime installer and SDK import passed in a disposable profile. No live prediction was requested.');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
