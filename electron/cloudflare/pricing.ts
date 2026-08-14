import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type {
  CloudflareCostEstimate,
  CloudflareCostLine,
  CloudflareCostScenario,
  CloudflarePriceSource,
  CloudflarePricingCatalog,
  CloudflareVaultInventory,
} from '@shared/cloudflare';

const STALE_AFTER_MS = 45 * 86400_000;
const GIB = 1024 ** 3;
// D1 meters rows changed in secondary indexes as well as table rows. Publishing
// also writes the FTS5 index, whose exact amplification depends on the user's
// text. Keep the preview deliberately conservative instead of promising Free on
// the table-row count alone.
const PUBLICATION_WRITE_AMPLIFICATION = 8;
const MUTATION_WRITE_AMPLIFICATION = 4;

function resourceRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'nodus-cloudflare') : path.join(app.getAppPath(), 'cloudflare');
}

function catalogFile(): string {
  const root = resourceRoot();
  const candidates = [path.join(root, 'pricing.v1.json'), path.join(root, 'catalog', 'pricing.v1.json')];
  return candidates.find((file) => fs.existsSync(file)) || candidates[0];
}

function validateCatalog(value: unknown): CloudflarePricingCatalog {
  const input = value as Partial<CloudflarePricingCatalog>;
  if (input?.schemaVersion !== 1 || input.currency !== 'USD' || !input.workers || !input.d1 || !input.r2 || !input.vectorize || !input.sources) {
    throw new Error('El catálogo de precios de Cloudflare no tiene un formato compatible.');
  }
  return input as CloudflarePricingCatalog;
}

function updateConfig(): { url: string; key: string } {
  let packaged: { schemaVersion?: number; catalogUrl?: string; ed25519PublicKeyPem?: string } = {};
  try { packaged = JSON.parse(fs.readFileSync(path.join(resourceRoot(), 'catalog-config.json'), 'utf8')); } catch { packaged = {}; }
  if (packaged.schemaVersion !== undefined && packaged.schemaVersion !== 1) throw new Error('La configuración del catálogo de Cloudflare no es compatible.');
  return {
    url: String(process.env.NODUS_CLOUDFLARE_CATALOG_URL || packaged.catalogUrl || '').trim(),
    key: String(process.env.NODUS_CLOUDFLARE_CATALOG_PUBLIC_KEY || packaged.ed25519PublicKeyPem || '').trim(),
  };
}

function verifyRemote(catalog: unknown, signature: string, key: string): boolean {
  if (!key || !signature) return false;
  try {
    return crypto.verify(null, Buffer.from(JSON.stringify(catalog)), key, Buffer.from(signature, 'base64'));
  } catch { return false; }
}

export function bundledPricingCatalog(): CloudflarePricingCatalog {
  return validateCatalog(JSON.parse(fs.readFileSync(catalogFile(), 'utf8')));
}

export async function currentPricingCatalog(): Promise<{ catalog: CloudflarePricingCatalog; live: boolean; warning: string | null }> {
  const fallback = bundledPricingCatalog();
  const { url, key } = updateConfig();
  if (!url) return { catalog: fallback, live: false, warning: 'Se usa el catálogo incluido en esta versión de Nodus. Comprueba los enlaces oficiales antes de contratar un plan.' };
  try {
    if (new URL(url).protocol !== 'https:') throw new Error('catalog URL must use HTTPS');
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const envelope = await response.json() as { catalog?: unknown; signature?: string };
    if (!envelope.catalog || !verifyRemote(envelope.catalog, String(envelope.signature || ''), key)) throw new Error('firma no válida');
    return { catalog: validateCatalog(envelope.catalog), live: true, warning: null };
  } catch {
    return { catalog: fallback, live: false, warning: 'No se pudo verificar el catálogo actualizado; la estimación usa la copia incluida y muestra siempre la documentación oficial.' };
  }
}

function line(service: CloudflareCostLine['service'], metric: string, amount: number, unit: string, allowance: number, estimatedUsd: number, source: CloudflarePriceSource): CloudflareCostLine {
  return { service, metric, amount, unit, freeAllowance: allowance, estimatedUsd: Math.max(0, estimatedUsd), withinFreeAllowance: amount <= allowance, sourceUrl: source.url };
}

function scenario(inventory: CloudflareVaultInventory, catalog: CloudflarePricingCatalog, id: CloudflareCostScenario['id'], multiplier: number): CloudflareCostScenario {
  const activity = inventory.activity;
  const requests = Math.ceil(activity.estimatedWorkerRequestsPerMonth * multiplier);
  const d1Reads = Math.ceil((activity.apiReadsPerMonth * 35 + activity.semanticQueriesPerMonth * 10) * multiplier);
  const vectorMembers = inventory.vectors.filter((entry) => entry.mode === 'vectorize').reduce((sum, entry) => sum + entry.count, 0);
  const publicationWrites = inventory.structured.rows * PUBLICATION_WRITE_AMPLIFICATION + vectorMembers * 2 + 16;
  const d1Writes = Math.ceil((publicationWrites * activity.publicationsPerMonth
    + activity.mutationRowsPerMonth * MUTATION_WRITE_AMPLIFICATION) * multiplier);
  const d1Bytes = inventory.structured.estimatedD1Bytes + inventory.structured.estimatedIndexBytes;
  const r2Bytes = inventory.objects.structuredOverflowBytes + inventory.objects.assetBytes + inventory.objects.libraryBytes + inventory.objects.snapshotBytes
    + inventory.objects.vectorBackupBytes + inventory.objects.retainedGenerationBytes;
  const r2A = Math.ceil((inventory.objects.uniqueObjects + activity.publicationsPerMonth * 4) * multiplier);
  const r2B = Math.ceil((activity.apiReadsPerMonth * 0.15 + activity.publicationsPerMonth * 2) * multiplier);
  const vectorIndexes = inventory.vectors.filter((entry) => entry.mode === 'vectorize');
  const vectorStored = vectorIndexes.reduce((sum, entry) => sum + entry.count * entry.dimensions, 0);
  // Vectorize bills each search for the dimensions traversed in the selected index:
  // (stored vectors + the query vector) × dimensions. With both Nodus indexes enabled,
  // user queries are estimated as evenly distributed between them.
  const averageQueriedDimensions = vectorIndexes.length
    ? vectorIndexes.reduce((sum, entry) => sum + (entry.count + 1) * entry.dimensions, 0) / vectorIndexes.length : 0;
  const vectorQueried = Math.ceil(activity.semanticQueriesPerMonth * averageQueriedDimensions * multiplier);
  const workerFree = catalog.workers.freeRequestsPerDay * 30;
  const sources = catalog.sources;
  const workerExceeded = requests > workerFree || activity.averageWorkerCpuMs > catalog.workers.freeCpuMsPerInvocation;
  const d1Exceeded = d1Reads > catalog.d1.freeRowsReadPerDay * 30
    || d1Writes > catalog.d1.freeRowsWrittenPerDay * 30 || d1Bytes > catalog.d1.freeDatabaseBytes;
  const r2Exceeded = r2Bytes > catalog.r2.freeStandardStorageBytesMonth || r2A > catalog.r2.freeClassAOpsPerMonth || r2B > catalog.r2.freeClassBOpsPerMonth;
  const vectorExceeded = vectorStored > catalog.vectorize.freeStoredDimensions || vectorQueried > catalog.vectorize.freeQueriedDimensionsPerMonth;
  const platformPaid = workerExceeded || d1Exceeded || vectorExceeded;
  const monthlyCpuMs = requests * activity.averageWorkerCpuMs;
  const workerCost = platformPaid ? catalog.workers.paidMinimumPerMonth
    + Math.max(0, requests - catalog.workers.paidIncludedRequestsPerMonth) / 1_000_000 * catalog.workers.paidRequestPerMillion
    + Math.max(0, monthlyCpuMs - catalog.workers.paidIncludedCpuMsPerMonth) / 1_000_000 * catalog.workers.paidCpuPerMillionMs : 0;
  const lines: CloudflareCostLine[] = [
    line('Workers', 'Peticiones', requests, 'peticiones/mes', workerFree, workerCost, sources.workers),
    line('Workers', 'CPU media estimada', activity.averageWorkerCpuMs, 'ms/petición', catalog.workers.freeCpuMsPerInvocation, 0, sources.workers),
    line('D1', 'Filas leídas', d1Reads, 'filas/mes', catalog.d1.freeRowsReadPerDay * 30, d1Exceeded ? Math.max(0, d1Reads - catalog.d1.paidIncludedRowsReadPerMonth) / 1_000_000 * catalog.d1.paidRowsReadPerMillion : 0, sources.d1),
    line('D1', 'Filas escritas', d1Writes, 'filas/mes', catalog.d1.freeRowsWrittenPerDay * 30, d1Exceeded ? Math.max(0, d1Writes - catalog.d1.paidIncludedRowsWrittenPerMonth) / 1_000_000 * catalog.d1.paidRowsWrittenPerMillion : 0, sources.d1),
    line('D1', 'Almacenamiento', d1Bytes, 'bytes', catalog.d1.freeDatabaseBytes, d1Exceeded ? Math.max(0, d1Bytes - catalog.d1.paidIncludedStorageBytes) / GIB * catalog.d1.paidStoragePerGbMonth : 0, sources.d1),
    line('R2', 'Almacenamiento Standard', r2Bytes, 'bytes-mes', catalog.r2.freeStandardStorageBytesMonth, Math.max(0, r2Bytes - catalog.r2.freeStandardStorageBytesMonth) / GIB * catalog.r2.standardStoragePerGbMonth, sources.r2),
    line('R2', 'Operaciones de escritura', r2A, 'operaciones/mes', catalog.r2.freeClassAOpsPerMonth, Math.max(0, r2A - catalog.r2.freeClassAOpsPerMonth) / 1_000_000 * catalog.r2.classAPerMillion, sources.r2),
    line('R2', 'Operaciones de lectura', r2B, 'operaciones/mes', catalog.r2.freeClassBOpsPerMonth, Math.max(0, r2B - catalog.r2.freeClassBOpsPerMonth) / 1_000_000 * catalog.r2.classBPerMillion, sources.r2),
    line('R2', 'Tráfico saliente', Math.ceil(activity.estimatedEgressBytesPerMonth * multiplier), 'bytes/mes', Number.MAX_SAFE_INTEGER, 0, sources.r2),
  ];
  if (vectorIndexes.length) lines.push(
    line('Vectorize', 'Dimensiones almacenadas', vectorStored, 'dimensiones', catalog.vectorize.freeStoredDimensions, vectorExceeded ? Math.max(0, vectorStored - catalog.vectorize.paidIncludedStoredDimensions) / 100_000_000 * catalog.vectorize.storedPerHundredMillion : 0, sources.vectorize),
    line('Vectorize', 'Dimensiones consultadas', vectorQueried, 'dimensiones/mes', catalog.vectorize.freeQueriedDimensionsPerMonth, vectorExceeded ? Math.max(0, vectorQueried - catalog.vectorize.paidIncludedQueriedDimensionsPerMonth) / 1_000_000 * catalog.vectorize.queriedPerMillion : 0, sources.vectorize),
  );
  const blockers = lines.filter((entry) => !entry.withinFreeAllowance).map((entry) => `${entry.service}: ${entry.metric}`);
  return { id, multiplier, withinFreeTier: !workerExceeded && !d1Exceeded && !r2Exceeded && !vectorExceeded, blockers, lines, estimatedUsdPerMonth: lines.reduce((sum, entry) => sum + entry.estimatedUsd, 0) };
}

export function estimateCloudflareCost(inventory: CloudflareVaultInventory, catalog: CloudflarePricingCatalog): CloudflareCostEstimate {
  const scenarios = [scenario(inventory, catalog, 'reduced', 0.5), scenario(inventory, catalog, 'expected', 1), scenario(inventory, catalog, 'intensive', 3)];
  const expected = scenarios[1];
  return {
    inventory, catalogCheckedAt: catalog.checkedAt, catalogEffectiveAt: catalog.effectiveAt,
    catalogStale: Date.now() - Date.parse(catalog.checkedAt) > STALE_AFTER_MS,
    scenarios,
    summary: expected.withinFreeTier
      ? 'Con el uso esperado, este vault cabe en los niveles gratuitos indicados por el catálogo comprobado.'
      : `El uso esperado supera ${expected.blockers.join(', ')}. Coste orientativo: US$${expected.estimatedUsdPerMonth.toFixed(2)} al mes.`,
  };
}
