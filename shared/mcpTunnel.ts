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
  if (/tunnel[^\n]*(?:not found|does not exist|unknown)|404/.test(normalized)) return 'tunnel_not_found';
  if (/unsupported (?:platform|architecture)|(?:platform|architecture) (?:is )?not supported|plataforma no soportada|no ofrece tunnel-client/.test(normalized)) return 'unsupported_platform';
  if (/mcp[^\n]*(?:401|403|refused|unreachable|failed)|127\.0\.0\.1|localhost/.test(normalized)) return 'local_server';
  if (/enotfound|econnreset|etimedout|timeout|network|dns|certificate|tls|proxy/.test(normalized)) return 'network';
  if (/download|github|release|http status/.test(normalized)) return 'download_failed';
  if (/exited|stopped|terminated|signal/.test(normalized)) return 'client_stopped';
  return 'unknown';
}
