import crypto from 'node:crypto';
import os from 'node:os';
import type {
  CloudflareCapabilityDocument,
  CloudflareCompleteDirectDeployInput,
  CloudflareDeployState,
  CloudflareDeployStep,
  CloudflareDeployStepId,
  CloudflareDeploymentRecord,
  CloudflareDirectDeployPreparation,
  CloudflareVaultInventory,
} from '@shared/cloudflare';
import {
  NODUS_CLOUDFLARE_DEPLOY_ORIGIN,
  NODUS_CLOUDFLARE_PROTOCOL,
  NODUS_CLOUDFLARE_SERVICE,
  NODUS_CLOUDFLARE_TEMPLATE_URL,
} from '@shared/cloudflare';
import { NodusCloudClient } from '@shared/cloudflareClient';
import { getSettings, updateSettings } from '../db/settingsRepo';
import {
  clearCloudflareBootstrapSecret,
  clearLegacyCloudflareAuthorization,
  getCloudflareBootstrapSecret,
  setCloudflareBootstrapSecret,
  setCloudflareRecoveryKey,
  setNodusServerTokenFor,
} from '../secrets/secretStore';
import { restartNodusServerSync, syncNodusServerVaultNow } from '../serverSync/serverSyncService';
import { getActiveVault } from '../vaults/vaultRegistry';
import { cloudflareDeployPreview } from './inventory';
import { deploymentFor, saveDeployment } from './storage';

const labels: Record<CloudflareDeployStepId, string> = {
  inventory: 'Calcular tamaño y coste',
  prepare: 'Crear el código privado de configuración',
  'cloudflare-deploy': 'Crear Worker, D1 y R2 en Cloudflare',
  verify: 'Comprobar el servicio desplegado',
  bootstrap: 'Crear el acceso privado del vault',
  publish: 'Publicar el vault',
};
const order = Object.keys(labels) as CloudflareDeployStepId[];
const steps = (): CloudflareDeployStep[] => order.map((id) => ({ id, label: labels[id], state: 'pending', detail: null }));

let state: CloudflareDeployState = {
  phase: 'idle', estimate: null, steps: steps(), deployment: null,
  deployUrl: null, setupCode: null, error: null, recoveryKey: null,
};
let running: Promise<CloudflareDeployState> | null = null;

function update(id: CloudflareDeployStepId, stepState: CloudflareDeployStep['state'], detail: string | null = null): void {
  state = { ...state, steps: state.steps.map((entry) => entry.id === id ? { ...entry, state: stepState, detail } : entry) };
}
function begin(id: CloudflareDeployStepId): void { update(id, 'running'); }
function done(id: CloudflareDeployStepId, detail: string | null = null): void { update(id, 'complete', detail); }

function templateUrl(): string {
  const candidate = String(process.env.NODUS_CLOUDFLARE_TEMPLATE_URL || NODUS_CLOUDFLARE_TEMPLATE_URL).trim();
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'https:' || !['github.com', 'gitlab.com'].includes(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error('La plantilla de Nodus Cloud debe ser un repositorio público HTTPS de GitHub o GitLab.');
  }
  return parsed.toString();
}

function officialDeployUrl(source: string): string {
  const url = new URL('/', NODUS_CLOUDFLARE_DEPLOY_ORIGIN);
  url.searchParams.set('url', source);
  return url.toString();
}

function setupVerifier(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function recoveryKeyFromBootstrap(secret: string): string {
  return crypto.createHash('sha256').update('nodus-recovery-v1:').update(secret).digest('base64url');
}

function normalizeWorkerUrl(value: string): string {
  const parsed = new URL(value.trim());
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('La dirección de Nodus Cloud debe usar HTTPS.');
  if (parsed.username || parsed.password) throw new Error('La dirección no puede contener credenciales.');
  parsed.pathname = '/'; parsed.search = ''; parsed.hash = '';
  return parsed.origin;
}

async function capabilityDocument(url: string): Promise<CloudflareCapabilityDocument> {
  const response = await fetch(`${url}/api/v3/capabilities`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json().catch(() => ({})) as Partial<CloudflareCapabilityDocument> & { error_description?: string; detail?: string };
  if (!response.ok) throw new Error(value.error_description || value.detail || `El Worker respondió con HTTP ${response.status}.`);
  if (value.service !== NODUS_CLOUDFLARE_SERVICE || Number(value.protocolVersion) < NODUS_CLOUDFLARE_PROTOCOL) {
    throw new Error('Esta dirección no corresponde a un despliegue compatible de Nodus Cloud.');
  }
  return value as CloudflareCapabilityDocument;
}

interface BootstrapResult {
  installationId: string;
  space: { id: string; name: string };
  deviceToken: string;
  recoveryKey: string;
}

class AlreadyBootstrappedError extends Error {
  constructor() { super('already_bootstrapped'); }
}

async function bootstrap(url: string, secret: string, input: CloudflareCompleteDirectDeployInput): Promise<BootstrapResult> {
  const vault = getActiveVault();
  const response = await fetch(`${url}/api/v3/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bootstrap ${secret}`, accept: 'application/json' },
    body: JSON.stringify({
      email: input.administratorEmail.trim(), password: input.administratorPassword,
      displayName: input.administratorEmail.split('@')[0], serverName: `${vault.name} · Nodus Cloud`,
      language: getSettings().uiLanguage, vault: { id: vault.id, name: vault.name, type: vault.type },
      deviceName: `Nodus Desktop · ${os.hostname()}`,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const value = await response.json().catch(() => ({})) as Partial<BootstrapResult> & { error?: string; error_description?: string; detail?: string };
  if (response.status === 409 && value.error === 'already_bootstrapped') throw new AlreadyBootstrappedError();
  if (!response.ok || !value.installationId || !value.space || !value.deviceToken || !value.recoveryKey) {
    // The Worker reports failures as error_description (see problem() in cloudflare/src/util.mjs).
    // Reading only detail collapsed every Worker error into a bare status code on screen.
    throw new Error(value.error_description || value.detail || `No se pudo inicializar Nodus Cloud (HTTP ${response.status}).`);
  }
  return value as BootstrapResult;
}

async function reconnectAfterInterruptedBootstrap(url: string, secret: string, input: CloudflareCompleteDirectDeployInput, capabilities: CloudflareCapabilityDocument): Promise<BootstrapResult> {
  const vault = getActiveVault();
  const login = await NodusCloudClient.signIn(url, input.administratorEmail, input.administratorPassword);
  const spaces = Array.isArray(login.spaces) ? login.spaces as Array<{ id?: string; name?: string; vault?: { id?: string } | null }> : [];
  const space = spaces.find((entry) => entry.vault?.id === vault.id) || (spaces.length === 1 ? spaces[0] : null);
  if (!space?.id) throw new Error('El Worker ya estaba configurado, pero no contiene un espacio para este vault. Usa la conexión avanzada para elegir el espacio correcto.');
  const paired = await NodusCloudClient.selectSpace(url, login.ticket, space.id, `Nodus Desktop · ${os.hostname()}`);
  const installationId = String(capabilities.server.installationId || '');
  if (!installationId) throw new Error('El Worker ya estaba configurado, pero no publicó su identificador de recuperación. Actualiza la plantilla de Nodus Cloud.');
  return {
    installationId,
    space: { id: paired.space.id, name: paired.space.name },
    deviceToken: paired.deviceToken,
    recoveryKey: recoveryKeyFromBootstrap(secret),
  };
}

export function getCloudflareDeployState(): CloudflareDeployState {
  const vault = (() => { try { return getActiveVault(); } catch { return null; } })();
  const deployment = vault ? deploymentFor(vault.id) : null;
  const pendingSecret = vault ? getCloudflareBootstrapSecret(vault.id) : null;
  const source = templateUrl();
  return {
    ...state,
    deployment: state.deployment || deployment,
    deployUrl: state.deployUrl || (pendingSecret ? officialDeployUrl(source) : null),
    setupCode: state.setupCode || (pendingSecret ? setupVerifier(pendingSecret) : null),
    steps: state.steps.map((entry) => ({ ...entry })),
  };
}

export async function previewCloudflareDeployment(activity: Partial<CloudflareVaultInventory['activity']> = {}): Promise<CloudflareDeployState> {
  state = { phase: 'estimating', estimate: null, steps: steps(), deployment: null, deployUrl: null, setupCode: null, error: null, recoveryKey: null };
  begin('inventory');
  try {
    const preview = await cloudflareDeployPreview(activity);
    state.estimate = preview.estimate; done('inventory', preview.catalogWarning); state.phase = 'ready';
  } catch (error) {
    state.phase = 'error'; state.error = error instanceof Error ? error.message : String(error); update('inventory', 'error', state.error);
  }
  return getCloudflareDeployState();
}

export async function prepareCloudflareDirectDeployment(): Promise<CloudflareDirectDeployPreparation> {
  if (!state.estimate) await previewCloudflareDeployment();
  if (state.phase === 'error') throw new Error(state.error || 'No se pudo preparar la estimación de Cloudflare.');
  const vault = getActiveVault();
  clearLegacyCloudflareAuthorization();
  let secret = getCloudflareBootstrapSecret(vault.id);
  if (!secret) {
    secret = crypto.randomBytes(32).toString('base64url');
    setCloudflareBootstrapSecret(vault.id, secret);
  }
  const source = templateUrl();
  const preparation = { templateUrl: source, deployUrl: officialDeployUrl(source), setupCode: setupVerifier(secret) };
  state = { ...state, phase: 'awaiting-cloudflare', deployUrl: preparation.deployUrl, setupCode: preparation.setupCode, error: null };
  done('prepare', 'El secreto permanece cifrado en este dispositivo');
  return preparation;
}

async function execute(input: CloudflareCompleteDirectDeployInput): Promise<CloudflareDeployState> {
  if (!/^\S+@\S+\.\S+$/.test(input.administratorEmail.trim())) throw new Error('Escribe un correo de administración válido.');
  if (input.administratorPassword.length < 12) throw new Error('La contraseña de Nodus Cloud debe tener al menos 12 caracteres.');
  const vault = getActiveVault();
  const secret = getCloudflareBootstrapSecret(vault.id);
  if (!secret) throw new Error('Prepara primero el despliegue para crear el código de configuración.');
  const url = normalizeWorkerUrl(input.workerUrl);
  state = { ...state, phase: 'connecting', error: null, recoveryKey: null, steps: steps() };
  done('inventory'); done('prepare'); done('cloudflare-deploy', 'Recursos creados directamente por Cloudflare');

  begin('verify');
  const capabilities = await capabilityDocument(url);
  done('verify', `${capabilities.server.name || 'Nodus Cloud'} · protocolo ${capabilities.protocolVersion}`);

  begin('bootstrap');
  let initialized: BootstrapResult;
  try {
    initialized = await bootstrap(url, secret, input);
  } catch (error) {
    if (!(error instanceof AlreadyBootstrappedError)) throw error;
    initialized = await reconnectAfterInterruptedBootstrap(url, secret, input, capabilities);
  }
  const expectedRecoveryKey = recoveryKeyFromBootstrap(secret);
  if (initialized.recoveryKey !== expectedRecoveryKey) throw new Error('El Worker devolvió una clave de recuperación inesperada; Nodus no guardará esta conexión.');
  setCloudflareRecoveryKey(vault.id, initialized.recoveryKey);
  setNodusServerTokenFor(vault.id, initialized.deviceToken);
  updateSettings({
    nodusServerKind: 'cloudflare', nodusServerUrl: url, nodusServerSpaceId: initialized.space.id,
    nodusServerSpaceName: initialized.space.name, nodusServerEnabled: true,
  });
  const record: CloudflareDeploymentRecord = {
    deploymentMethod: 'cloudflare-button', installationId: initialized.installationId,
    spaceId: initialized.space.id, url, workerVersion: capabilities.version,
    deployedAt: new Date().toISOString(), templateUrl: templateUrl(),
  };
  saveDeployment(vault.id, record);
  state.deployment = record; state.recoveryKey = initialized.recoveryKey;
  clearCloudflareBootstrapSecret(vault.id);
  done('bootstrap', 'Cloudflare no compartió credenciales de cuenta con Nodus');

  begin('publish');
  restartNodusServerSync();
  await syncNodusServerVaultNow(vault.id);
  done('publish');
  state.phase = 'complete';
  return getCloudflareDeployState();
}

export async function completeCloudflareDirectDeployment(input: CloudflareCompleteDirectDeployInput): Promise<CloudflareDeployState> {
  if (running) return running;
  running = execute(input).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const current = state.steps.find((entry) => entry.state === 'running');
    if (current) update(current.id, 'error', message);
    state.phase = 'error'; state.error = message;
    return getCloudflareDeployState();
  }).finally(() => { running = null; });
  return running;
}
