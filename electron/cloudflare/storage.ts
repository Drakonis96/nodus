import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { CloudflareDeploymentRecord } from '@shared/cloudflare';

function file(): string { return path.join(app.getPath('userData'), 'cloudflare-deployments.json'); }

function isDirectDeployment(value: unknown): value is CloudflareDeploymentRecord {
  const record = value as Partial<CloudflareDeploymentRecord> | null;
  return record?.deploymentMethod === 'cloudflare-button'
    && typeof record.installationId === 'string' && Boolean(record.installationId)
    && typeof record.spaceId === 'string' && Boolean(record.spaceId)
    && typeof record.url === 'string' && typeof record.workerVersion === 'string'
    && typeof record.deployedAt === 'string' && typeof record.templateUrl === 'string';
}

function read(): Record<string, CloudflareDeploymentRecord> {
  try {
    const value = JSON.parse(fs.readFileSync(file(), 'utf8')) as Record<string, unknown>;
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, CloudflareDeploymentRecord] => isDirectDeployment(entry[1])));
  }
  catch { return {}; }
}

export function deploymentFor(vaultId: string): CloudflareDeploymentRecord | null { return read()[vaultId] || null; }

export function saveDeployment(vaultId: string, record: CloudflareDeploymentRecord): void {
  const values = read(); values[vaultId] = record;
  const target = file(); const temporary = `${target}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(temporary, JSON.stringify(values, null, 2), { mode: 0o600 }); fs.renameSync(temporary, target);
}
