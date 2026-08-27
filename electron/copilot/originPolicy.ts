/**
 * Browser origins allowed to read the token-bearing Word add-in and call its
 * local API. Native bridges send no Origin header and authenticate separately.
 */
export function isAllowedCopilotOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    const localHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    const originPort = parsed.port || (parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : '');
    return localHost && (parsed.protocol === 'https:' || parsed.protocol === 'http:') && originPort === String(port);
  } catch {
    return false;
  }
}
