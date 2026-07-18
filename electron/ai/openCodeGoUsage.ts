import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { OpenCodeGoUsagePeriod, OpenCodeGoUsageStatus } from '@shared/types';
import type { OpenCodeGoNormalizedUsage } from './openCodeGoCompletion';
import { estimateOpenCodeGoCostUsd } from './openCodeGoPricing';

interface UsageEvent {
  at: string;
  model: string;
  estimatedCostUsd: number | null;
}

interface UsageFile {
  version: 1;
  events: UsageEvent[];
}

const LIMITS = { fiveHours: 12, week: 30, month: 60 } as const;
const OFFICIAL_USAGE_URL = 'https://opencode.ai/auth';
const listeners = new Set<(status: OpenCodeGoUsageStatus) => void>();
let writeQueue = Promise.resolve();

function usageFile(): string {
  return path.join(app.getPath('userData'), 'opencode-go-usage.json');
}

function readEvents(): UsageEvent[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(usageFile(), 'utf8')) as UsageFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.events)) return [];
    return parsed.events.filter((event) => Number.isFinite(Date.parse(event.at)) && typeof event.model === 'string');
  } catch {
    return [];
  }
}

function observed(events: UsageEvent[], cutoff: number): OpenCodeGoUsagePeriod {
  const selected = events.filter((event) => Date.parse(event.at) >= cutoff);
  return {
    requests: selected.length,
    estimatedCostUsd: selected.reduce((sum, event) => sum + (event.estimatedCostUsd ?? 0), 0),
    unpricedRequests: selected.filter((event) => event.estimatedCostUsd === null).length,
  };
}

function statusFrom(events: UsageEvent[]): OpenCodeGoUsageStatus {
  const now = Date.now();
  return {
    officialUsageUrl: OFFICIAL_USAGE_URL,
    limitsUsd: LIMITS,
    observed: {
      fiveHours: observed(events, now - 5 * 60 * 60 * 1_000),
      week: observed(events, now - 7 * 24 * 60 * 60 * 1_000),
      month: observed(events, now - 30 * 24 * 60 * 60 * 1_000),
    },
    lastUpdatedAt: events.at(-1)?.at ?? null,
  };
}

export function getOpenCodeGoUsageStatus(): OpenCodeGoUsageStatus {
  return statusFrom(readEvents());
}

export function onOpenCodeGoUsageStatusChanged(listener: (status: OpenCodeGoUsageStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stores only timestamp/model/cost—never prompts, responses, credentials or raw
 * token payloads. The local meter is deliberately labelled non-authoritative. */
export async function recordOpenCodeGoUsage(model: string, usage: OpenCodeGoNormalizedUsage | null): Promise<void> {
  const run = async () => {
    const cutoff = Date.now() - 32 * 24 * 60 * 60 * 1_000;
    const events = readEvents().filter((event) => Date.parse(event.at) >= cutoff);
    events.push({ at: new Date().toISOString(), model, estimatedCostUsd: estimateOpenCodeGoCostUsd(model, usage) });
    const file = usageFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, events } satisfies UsageFile), { mode: 0o600 });
    fs.renameSync(temporary, file);
    try { fs.chmodSync(file, 0o600); } catch { /* best effort on Windows */ }
    const status = statusFrom(events);
    for (const listener of listeners) listener(status);
  };
  const pending = writeQueue.then(run, run);
  writeQueue = pending.then(() => undefined, () => undefined);
  await pending;
}
