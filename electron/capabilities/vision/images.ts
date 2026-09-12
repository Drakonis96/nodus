import https from 'node:https';
import { promises as dns } from 'node:dns';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { nodusUserAgent } from '../../ai/clientIdentity';
import { privateAddress } from '../../../skill-capabilities/publicHost';
import type { TrustedPermissionSetV2 } from '../../../packages/capability-api/src/permissions';
import { VISION_LIMITS, type VisionCandidateInput } from '../../../packages/capability-api/src/vision';

export function publicImageTarget(source: Extract<VisionCandidateInput['source'], {kind:'public'}>, permissions: TrustedPermissionSetV2): {url: URL; limit: number; timeout: number} {
  const endpoint = permissions.network?.find(e => e.id === source.endpointId);
  if (!endpoint || !endpoint.methods.includes('GET') || permissions.secrets?.some(s => s.injection.kind === 'header' && s.injection.endpointId === endpoint.id)) throw new Error('Public image endpoint is not permitted or requires credentials.');
  const relative = source.path;
  if (!relative.startsWith('/') || relative.startsWith('//') || /[\\#\x00-\x20]/.test(relative)) throw new Error('Invalid public image path.');
  const url = new URL(relative, endpoint.origin);
  if (/%(?:25|2f|5c)/i.test(url.pathname)) throw new Error('Encoded image path traversal is not permitted.');
  const decoded = decodeURIComponent(url.pathname);
  if (url.protocol !== 'https:' || url.origin !== new URL(endpoint.origin).origin || url.username || url.password || decoded.includes('..') || decoded.includes('\\') || !endpoint.pathPrefixes.some(p => decoded === p || decoded.startsWith(p.endsWith('/') ? p : p + '/'))) throw new Error('Public image path exceeds permission.');
  return { url, limit: Math.min(endpoint.maxResponseBytes,VISION_LIMITS.inputBytes), timeout: Math.min(endpoint.timeoutMs,15000) };
}
/** Resolve once and pin the public address into the TLS request: no redirects, cookies,
 * auth, local paths or DNS rebinding between validation and connection. */
export async function fetchPublicImage(source: Extract<VisionCandidateInput['source'], {kind:'public'}>, permissions: TrustedPermissionSetV2, signal: AbortSignal): Promise<{bytes: Buffer; source: string}> {
  const {url,limit,timeout} = publicImageTarget(source,permissions);
  signal.throwIfAborted();
  const addresses = await dns.lookup(url.hostname,{all:true});
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(a=>privateAddress(a.address))) throw new Error('Image source must be public.');
  const address = addresses[0];
  const bytes = await new Promise<Buffer>((resolve,reject) => {
    const request = https.get(url, { agent:false, signal, headers:{'User-Agent':`${nodusUserAgent()} (https://github.com/Drakonis96/nodus)`,Accept:'image/png,image/jpeg,image/webp,image/gif,image/avif'}, lookup: (_host,opts,callback) => opts.all ? callback(null,[address]) : callback(null,address.address,address.family) }, response => {
      if (response.statusCode !== 200 || Number(response.headers['content-length'] ?? 0) > limit) { response.destroy(); reject(new Error('Image source failed or exceeded its size limit.')); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data',(chunk: Buffer)=>{size += chunk.length; if(size>limit) response.destroy(new Error('Image is too large.')); else chunks.push(chunk);});
      response.on('end',()=>resolve(Buffer.concat(chunks)));
      response.on('error',reject);
    });
    request.setTimeout(timeout,()=>request.destroy(new Error('Image retrieval timed out.')));
    request.on('error',reject);
  });
  return {bytes,source:url.href};
}
export async function normalizeVisionImage(bytes: Uint8Array): Promise<{base64: string; width: number; height: number; sha256: string; thumbnailSha256: string}> {
  if (!bytes.length || bytes.length > VISION_LIMITS.inputBytes) throw new Error('Image is too large or empty.');
  const input = Buffer.from(bytes);
  const image = sharp(input,{limitInputPixels:VISION_LIMITS.pixels,failOn:'warning',animated:false});
  const metadata = await image.metadata();
  if (!['png','jpeg','webp','gif','avif','heif'].includes(metadata.format ?? '')) throw new Error('Only decodable raster images can be reviewed.');
  // sharp strips metadata by default. Decode to pixels, never forward source SVG/EXIF.
  const normalized = await image.rotate().resize(VISION_LIMITS.thumbnailEdge,VISION_LIMITS.thumbnailEdge,{fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:80}).toBuffer({resolveWithObject:true});
  if (normalized.data.length > VISION_LIMITS.thumbnailBytes) throw new Error('Thumbnail exceeds the review budget.');
  return {base64:normalized.data.toString('base64'),width:normalized.info.width,height:normalized.info.height,sha256:createHash('sha256').update(input).digest('hex'),thumbnailSha256:createHash('sha256').update(normalized.data).digest('hex')};
}
