import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Single campaign ledger shared by every test/provider; reservations are durable
 * before network dispatch and unknown/failed usage keeps the full reservation. */
export class ResearchCostLedger {
  constructor(file, limit = 5) { this.file = file; this.limit = Math.min(5, limit); }
  reserve({ provider, model, maximumUsd }) {
    if (!((provider === 'deepseek' && model === 'deepseek-flash') || (provider === 'openrouter' && model === 'baai/bge-m3'))) throw new Error('Unapproved research model');
    if (!Number.isFinite(maximumUsd) || maximumUsd <= 0) throw new Error('A conservative cost bound is required');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const lock = fs.openSync(`${this.file}.lock`, 'wx', 0o600);
    try {
      const ledger = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { limitUsd: this.limit, calls: [] };
      const committed = ledger.calls.reduce((total, call) => total + (call.actualUsd ?? call.maximumUsd), 0);
      if (committed + maximumUsd >= Math.min(this.limit, ledger.limitUsd)) throw new Error('Research cost budget would be exhausted');
      const id = randomUUID();
      ledger.calls.push({ id, provider, model, maximumUsd, reservedAt: new Date().toISOString(), actualUsd: null });
      const temporary = `${this.file}.${id}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(ledger, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
      return id;
    } finally { fs.closeSync(lock); fs.unlinkSync(`${this.file}.lock`); }
  }
  settle(id, { actualUsd, inputTokens, outputTokens }) {
    const lock = fs.openSync(`${this.file}.lock`, 'wx', 0o600);
    try {
      const ledger = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const call = ledger.calls.find(call => call.id === id);
      if (!call || !Number.isFinite(actualUsd) || actualUsd < 0 || actualUsd > call.maximumUsd) throw new Error('Invalid cost settlement');
      Object.assign(call, { actualUsd, inputTokens, outputTokens, settledAt: new Date().toISOString() });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(ledger, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } finally { fs.closeSync(lock); fs.unlinkSync(`${this.file}.lock`); }
  }
}
