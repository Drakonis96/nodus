// Localhost TLS material for the copilot HTTPS server. We reuse the cert that
// `office-addin-dev-certs` generates+trusts (the same CA Word trusts for add-ins),
// so Word's webview loads https://localhost:<port> without warnings.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CERT_DIR = path.join(homedir(), '.office-addin-dev-certs');
const CERT_PATH = path.join(CERT_DIR, 'localhost.crt');
const KEY_PATH = path.join(CERT_DIR, 'localhost.key');

export interface CopilotCert {
  cert: string;
  key: string;
}

export function certReady(): boolean {
  return existsSync(CERT_PATH) && existsSync(KEY_PATH);
}

/** Load the localhost cert+key, or null when not generated yet. */
export function loadCopilotCert(): CopilotCert | null {
  if (!certReady()) return null;
  try {
    return { cert: readFileSync(CERT_PATH, 'utf8'), key: readFileSync(KEY_PATH, 'utf8') };
  } catch {
    return null;
  }
}

/**
 * Ensure a trusted localhost cert exists. Idempotent: returns immediately when
 * already present. Otherwise shells out to office-addin-dev-certs (dev only; in a
 * packaged app `npx` may be unavailable, in which case we report a clear message).
 */
export async function ensureCopilotCert(appRoot: string): Promise<{ ok: boolean; message: string }> {
  if (certReady()) return { ok: true, message: 'Certificado localhost listo.' };
  try {
    const bin = path.join(appRoot, 'node_modules', '.bin', 'office-addin-dev-certs');
    const cmd = existsSync(bin) ? bin : 'npx';
    const args = existsSync(bin) ? ['install', '--days', '365'] : ['office-addin-dev-certs', 'install', '--days', '365'];
    await execFileAsync(cmd, args, { cwd: appRoot, timeout: 120_000 });
    return certReady()
      ? { ok: true, message: 'Certificado localhost generado y confiado.' }
      : { ok: false, message: 'No se pudo generar el certificado localhost.' };
  } catch (error) {
    return {
      ok: false,
      message: `No se pudo generar el certificado: ${error instanceof Error ? error.message : String(error)}. Ejecuta "npx office-addin-dev-certs install" manualmente.`,
    };
  }
}
