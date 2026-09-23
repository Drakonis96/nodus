import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResearchCostLedger } from './research-cost-ledger.mjs';

test('campaign reservations survive restart and fail closed at the shared five-dollar boundary', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ledger-test-'));
  try {
    const file = path.join(root, 'cost.json');
    for (const value of [NaN, Infinity, 0, -1, 6]) assert.throws(() => new ResearchCostLedger(file, value));
    const ledger = new ResearchCostLedger(file);
    const call = { provider: 'deepseek', model: 'deepseek-flash', maximumUsd: 2 };
    assert.throws(() => ledger.reserve({ ...call, model: 'unapproved' }));
    const first = ledger.reserve(call);
    const second = new ResearchCostLedger(file).reserve(call);
    assert.notEqual(first, second);
    assert.throws(() => ledger.reserve({ ...call, maximumUsd: 1 }), /exhausted/);
    assert.throws(() => ledger.settle(first, { actualUsd: 0.5, inputTokens: -1, outputTokens: 10 }));
    const usage = { actualUsd: 0.5, inputTokens: 1000, outputTokens: 100 };
    ledger.settle(first, usage);
    ledger.settle(first, usage);
    assert.throws(() => ledger.settle(first, { ...usage, actualUsd: 0.1 }), /Conflicting/);
    assert.throws(() => ledger.settle(second, { ...usage, actualUsd: 3 }));
    ledger.reserve({ provider: 'openrouter', model: 'baai/bge-m3', maximumUsd: 0.25 });
    assert.equal(ledger.read().calls[1].actualUsd, null, 'unknown or failed calls keep their entire reservation');
    const corrupted = ledger.read();
    corrupted.calls[0].actualUsd = -10;
    fs.writeFileSync(file, JSON.stringify(corrupted));
    assert.throws(() => ledger.reserve(call), /Invalid research ledger/);
    assert.equal(fs.existsSync(`${file}.lock`), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
