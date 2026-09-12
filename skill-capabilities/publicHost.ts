import { promises as dns } from 'node:dns';
import net from 'node:net';

/** A capability may only reach the public internet. Both capability APIs share this
 *  check so a declared origin can never be pointed at the machine Nodus runs on, or at
 *  anything else on its network, by DNS. */

const PRIVATE_HOST = /^(?:localhost|.*\.localhost|.*\.local)$/i;

export function privateAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/i, '');
  if (net.isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
      || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168
      || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19);
  }
  return net.isIP(address) !== 6 || !/^[23][0-9a-f]{3}:/i.test(address);
}

export async function assertPublicHost(hostname: string): Promise<void> {
  if (PRIVATE_HOST.test(hostname)) throw new Error('Capability network target is not public.');
  const results = await dns.lookup(hostname, { all: true });
  if (!results.length || results.some(result => privateAddress(result.address))) throw new Error('Capability network target is not public.');
}
