// Localhost TLS material for the copilot HTTPS server — production-ready.
//
// Scheme: a Nodus-owned CA (10 years, trusted once per machine) signs a
// localhost leaf certificate (1 year) that the HTTPS server presents to Word.
// Both are generated in-process with mkcert (pure JS, so it works from the
// packaged app — no dev CLI, no scripts inside the asar). The leaf is silently
// re-issued from the stored CA whenever it is close to expiry, which needs no
// new trust prompt. Trusting the CA uses one inline system command:
// `security add-trusted-cert` (macOS) or `Import-Certificate` (Windows).
//
// Dev machines that already trusted the office-addin-dev-certs CA keep
// working: those files are preferred while they remain valid.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCA, createCert } from 'mkcert';

const execFileAsync = promisify(execFile);

const OFFICE_CERT_DIR = path.join(homedir(), '.office-addin-dev-certs');
const NODUS_CERT_DIR = path.join(homedir(), '.nodus-copilot-certs');

const CA_NAME = 'Nodus Copilot Local CA';
const CA_VALIDITY_DAYS = 3650;
const LEAF_VALIDITY_DAYS = 365;
/** Re-issue the leaf when fewer than this many days remain. */
const RENEW_BEFORE_DAYS = 30;

export interface CopilotCert {
  cert: string;
  key: string;
}

interface CertPaths {
  caCert: string;
  caKey: string;
  cert: string;
  key: string;
  trustMarker: string;
}

function nodusPaths(dir: string = NODUS_CERT_DIR): CertPaths {
  return {
    caCert: path.join(dir, 'ca.crt'),
    caKey: path.join(dir, 'ca.key'),
    cert: path.join(dir, 'localhost.crt'),
    key: path.join(dir, 'localhost.key'),
    trustMarker: path.join(dir, 'ca-trusted.json'),
  };
}

/** Days until the PEM certificate expires; negative when already expired,
 *  null when the input is unparseable. */
export function daysUntilExpiry(certPem: string): number | null {
  try {
    const parsed = new X509Certificate(certPem);
    return (new Date(parsed.validTo).getTime() - Date.now()) / 86_400_000;
  } catch {
    return null;
  }
}

function fileIsValidCert(certPath: string, minDaysLeft = 0): boolean {
  if (!existsSync(certPath)) return false;
  try {
    const days = daysUntilExpiry(readFileSync(certPath, 'utf8'));
    return days !== null && days > minDaysLeft;
  } catch {
    return false;
  }
}

/** The office-addin-dev-certs files, when a dev setup already trusted them. */
function loadOfficeCert(): CopilotCert | null {
  const cert = path.join(OFFICE_CERT_DIR, 'localhost.crt');
  const key = path.join(OFFICE_CERT_DIR, 'localhost.key');
  if (!fileIsValidCert(cert) || !existsSync(key)) return null;
  try {
    return { cert: readFileSync(cert, 'utf8'), key: readFileSync(key, 'utf8') };
  } catch {
    return null;
  }
}

function loadNodusCert(dir: string = NODUS_CERT_DIR): CopilotCert | null {
  const p = nodusPaths(dir);
  if (!fileIsValidCert(p.cert) || !existsSync(p.key) || !existsSync(p.trustMarker)) return null;
  try {
    return { cert: readFileSync(p.cert, 'utf8'), key: readFileSync(p.key, 'utf8') };
  } catch {
    return null;
  }
}

export function certReady(): boolean {
  return loadOfficeCert() !== null || loadNodusCert() !== null;
}

/** Load the localhost cert+key, or null when not generated/trusted yet. */
export function loadCopilotCert(): CopilotCert | null {
  return loadOfficeCert() ?? loadNodusCert();
}

/** The inline system command that trusts the CA for the current user, or null
 *  on platforms without desktop Word. Pure so tests can assert per platform. */
export function trustCommand(platform: NodeJS.Platform, caCertPath: string): { cmd: string; args: string[] } | null {
  if (platform === 'darwin') {
    return {
      cmd: 'security',
      args: [
        'add-trusted-cert',
        '-r',
        'trustRoot',
        '-k',
        path.join(homedir(), 'Library', 'Keychains', 'login.keychain-db'),
        caCertPath,
      ],
    };
  }
  if (platform === 'win32') {
    return {
      cmd: 'powershell',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Import-Certificate -FilePath '${caCertPath}' -CertStoreLocation Cert:\\CurrentUser\\Root`,
      ],
    };
  }
  return null;
}

async function generateCa(p: CertPaths): Promise<void> {
  const ca = await createCA({
    organization: CA_NAME,
    countryCode: 'ES',
    state: 'Local',
    locality: 'Local',
    validity: CA_VALIDITY_DAYS,
  });
  writeFileSync(p.caCert, ca.cert, { mode: 0o600 });
  writeFileSync(p.caKey, ca.key, { mode: 0o600 });
}

async function generateLeaf(p: CertPaths): Promise<void> {
  const ca = { cert: readFileSync(p.caCert, 'utf8'), key: readFileSync(p.caKey, 'utf8') };
  const leaf = await createCert({ ca, domains: ['localhost', '127.0.0.1'], validity: LEAF_VALIDITY_DAYS });
  writeFileSync(p.cert, leaf.cert, { mode: 0o600 });
  writeFileSync(p.key, leaf.key, { mode: 0o600 });
}

function caFingerprint(p: CertPaths): string | null {
  try {
    return new X509Certificate(readFileSync(p.caCert, 'utf8')).fingerprint256;
  } catch {
    return null;
  }
}

function markerMatchesCa(p: CertPaths): boolean {
  try {
    const marker = JSON.parse(readFileSync(p.trustMarker, 'utf8')) as { fingerprint?: string };
    const fingerprint = caFingerprint(p);
    return Boolean(fingerprint && marker.fingerprint === fingerprint);
  } catch {
    return false;
  }
}

function leafSignedByCa(p: CertPaths): boolean {
  try {
    const leaf = new X509Certificate(readFileSync(p.cert, 'utf8'));
    const ca = new X509Certificate(readFileSync(p.caCert, 'utf8'));
    return leaf.checkIssued(ca);
  } catch {
    return false;
  }
}

/**
 * Generate CA + leaf as needed and trust the CA for the current user. Idempotent:
 * with valid trusted material it returns immediately. The directory, platform and
 * trust runner are injectable so tests never touch the real home directory.
 */
export async function ensureNodusCert(
  dir: string = NODUS_CERT_DIR,
  platform: NodeJS.Platform = process.platform,
  runTrust: (cmd: string, args: string[]) => Promise<unknown> = (cmd, args) =>
    execFileAsync(cmd, args, { timeout: 120_000 })
): Promise<{ ok: boolean; message: string }> {
  const p = nodusPaths(dir);
  mkdirSync(dir, { recursive: true });

  const caValid = fileIsValidCert(p.caCert, RENEW_BEFORE_DAYS) && existsSync(p.caKey);
  if (!caValid) await generateCa(p);

  // The leaf is re-issued from the CA well before expiry — no new trust prompt.
  const leafValid =
    caValid && fileIsValidCert(p.cert, RENEW_BEFORE_DAYS) && existsSync(p.key) && leafSignedByCa(p);
  if (!leafValid) await generateLeaf(p);

  if (caValid && markerMatchesCa(p)) return { ok: true, message: 'Certificado localhost listo.' };

  const trust = trustCommand(platform, p.caCert);
  if (!trust) {
    return { ok: false, message: 'Word de escritorio solo existe en macOS y Windows; no hay CA que confiar aquí.' };
  }
  try {
    await runTrust(trust.cmd, trust.args);
    writeFileSync(p.trustMarker, JSON.stringify({ fingerprint: caFingerprint(p), trustedAt: new Date().toISOString() }));
    return { ok: true, message: 'Certificado localhost generado y confiado para este usuario.' };
  } catch (error) {
    return {
      ok: false,
      message: `No se pudo confiar la CA local: ${error instanceof Error ? error.message : String(error)}. Acepta el diálogo del sistema y reintenta.`,
    };
  }
}

/**
 * Ensure a trusted localhost cert exists. Prefers an already-trusted
 * office-addin-dev-certs setup (dev machines); otherwise generates and trusts
 * the Nodus CA. Safe to call repeatedly — it also renews a near-expiry leaf.
 */
export async function ensureCopilotCert(): Promise<{ ok: boolean; message: string }> {
  if (loadOfficeCert()) return { ok: true, message: 'Certificado localhost listo.' };
  return ensureNodusCert();
}

/** Silently re-issue a near-expiry leaf at server start (no trust prompt needed).
 *  Never throws; when nothing is renewable it just returns. */
export async function renewLeafIfNeeded(dir: string = NODUS_CERT_DIR): Promise<void> {
  const p = nodusPaths(dir);
  if (!existsSync(p.caCert) || !existsSync(p.caKey) || !markerMatchesCa(p)) return;
  if (fileIsValidCert(p.cert, RENEW_BEFORE_DAYS) && leafSignedByCa(p)) return;
  try {
    await generateLeaf(p);
  } catch {
    // Renewal is best-effort; ensureCopilotCert() surfaces real failures.
  }
}
