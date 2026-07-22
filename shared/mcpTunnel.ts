import type { McpTunnelErrorCode } from './types';

export const MCP_TUNNEL_ID_PATTERN = /^tunnel_[0-9a-f]{32}$/;

export function isValidMcpTunnelId(value: string): boolean {
  return MCP_TUNNEL_ID_PATTERN.test(value.trim());
}

export function mcpTunnelPlatformSlug(platform: NodeJS.Platform, arch: string): string | null {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : platform === 'win32' ? 'windows' : null;
  const cpu = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null;
  return os && cpu ? `${os}-${cpu}` : null;
}

export function mcpTunnelAssetName(tag: string, platform: NodeJS.Platform, arch: string): string | null {
  const slug = mcpTunnelPlatformSlug(platform, arch);
  return slug ? `tunnel-client-${tag}-${slug}.zip` : null;
}

/** Turn doctor/runtime output into a stable code that the renderer can explain in the active language. */
export function classifyMcpTunnelFailure(detail: string): McpTunnelErrorCode {
  const normalized = detail.toLowerCase();
  if (/checksum|sha-?256|digest|integrity/.test(normalized)) return 'integrity_failed';
  if (/401|invalid api key|incorrect api key|authentication|unauthori[sz]ed/.test(normalized)) return 'api_key_rejected';
  if (/403|permission|forbidden|read\s*\+\s*use|tunnels? use|access required/.test(normalized)) return 'permission_denied';
  if (/tunnel[^\n]*(?:not found|does not exist|unknown)|(?:tunnel_|\/v1\/tunnels?)[^\n]*\b404\b|\b404\b[^\n]*(?:tunnel_|\/v1\/tunnels?)/.test(normalized)) return 'tunnel_not_found';
  if (/unsupported (?:platform|architecture)|(?:platform|architecture) (?:is )?not supported|plataforma no soportada|no ofrece tunnel-client/.test(normalized)) return 'unsupported_platform';
  if (/mcp[^\n]*(?:401|403|refused|unreachable|failed)|127\.0\.0\.1|localhost/.test(normalized)) return 'local_server';
  if (/enotfound|econnreset|etimedout|timeout|network|dns|certificate|tls|proxy/.test(normalized)) return 'network';
  if (/download|github|release|http status/.test(normalized)) return 'download_failed';
  if (/exited|stopped|terminated|signal/.test(normalized)) return 'client_stopped';
  return 'unknown';
}

interface McpDoctorCheck {
  id?: unknown;
  status?: unknown;
  summary?: unknown;
  evidence?: unknown;
}

interface McpDoctorReport {
  result?: unknown;
  failed_checks?: unknown;
  checks?: unknown;
}

/**
 * tunnel-client 0.0.10 makes its standalone doctor fail whenever an HTTP MCP
 * target does not publish OAuth/PRMD metadata. Nodus deliberately uses a
 * preconfigured static Bearer header instead, and the long-lived runtime can
 * treat an all-404 discovery result as "OAuth not advertised".
 *
 * Keep this exception deliberately narrow so a remote OAuth error, an
 * unreachable local MCP server, or any additional failed check still blocks
 * startup.
 */
export function isIgnorableLocalMcpOAuthDoctorFailure(output: string, expectedMcpServerUrl: string): boolean {
  let expected: URL;
  try {
    expected = new URL(expectedMcpServerUrl);
  } catch {
    return false;
  }
  if (expected.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(expected.hostname)) return false;

  let report: McpDoctorReport;
  try {
    report = JSON.parse(output.trim()) as McpDoctorReport;
  } catch {
    return false;
  }
  if (report.result !== 'fail'
    || !Array.isArray(report.failed_checks)
    || report.failed_checks.length !== 1
    || report.failed_checks[0] !== 'oauth_metadata'
    || !Array.isArray(report.checks)) return false;

  const checks = report.checks.filter((value): value is McpDoctorCheck => Boolean(value) && typeof value === 'object');
  const byId = (id: string) => checks.find((check) => check.id === id);
  const target = byId('mcp_target');
  const reachable = byId('mcp_server_reachable');
  const oauth = byId('oauth_metadata');
  if (target?.status !== 'PASS'
    || target.summary !== expectedMcpServerUrl
    || reachable?.status !== 'PASS'
    || oauth?.status !== 'FAIL'
    || !Array.isArray(oauth.evidence)) return false;

  let hasExpectedMetadataUrl = false;
  let hasNotFound = false;
  for (const item of oauth.evidence) {
    if (typeof item !== 'string') continue;
    if (/^HTTP 404$/i.test(item.trim())) hasNotFound = true;
    try {
      const evidenceUrl = new URL(item);
      if (evidenceUrl.origin === expected.origin
        && evidenceUrl.pathname.startsWith('/.well-known/oauth-protected-resource')) {
        hasExpectedMetadataUrl = true;
      }
    } catch {
      // Non-URL evidence such as "HTTP 404" is handled above.
    }
  }
  return hasExpectedMetadataUrl && hasNotFound;
}
