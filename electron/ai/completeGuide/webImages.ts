/**
 * Optional web images for a complete study guide. SearXNG's "images" category finds
 * candidates on Wikimedia Commons; the Commons API then confirms the file's licence
 * and author, and gives a raster rendering (SVG files are rasterized by Commons, so
 * no SVG is ever parsed here). Downloads are public-only, capped at 5 MB and
 * re-encoded with sharp. Anything unconfirmed is skipped, never guessed.
 */
import type { CompleteGuideFigure } from '@shared/completeGuide/figures';
import {
  commonsFileTitle,
  freeImageLicense,
  imageMatchesQuery,
  stripImageMetadataHtml,
  webImageCaption,
  type CompleteGuideWebImageRequest,
} from '@shared/completeGuide/webImages';
import { fetchPublicResource, readBoundedText } from '../../network/publicDownload';
import { searchSearxng, type SearxngResult } from '../../websearch/searxngService';
import { normalizePng } from './figures';

export const WEB_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const RASTER = /^image\/(png|jpe?g|gif|webp)\b/i;

export interface WebImageDeps {
  search(query: string, language: string, signal?: AbortSignal): Promise<SearxngResult[]>;
  fetchJson(url: string, signal?: AbortSignal): Promise<unknown>;
  fetchImage(url: string, signal?: AbortSignal): Promise<{ bytes: Buffer; contentType: string }>;
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) { await response.body.cancel().catch(() => {}); throw new Error('image_too_large'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export const defaultWebImageDeps: WebImageDeps = {
  search: async (query, language, signal) => (await searchSearxng(query, { categories: 'images', language }, signal)).results,
  fetchJson: async (url, signal) => {
    const { response } = await fetchPublicResource(url, { accept: 'application/json', maxBytes: 1024 * 1024, timeoutMs: 12_000, signal });
    return JSON.parse(await readBoundedText(response, 1024 * 1024));
  },
  fetchImage: async (url, signal) => {
    const { response } = await fetchPublicResource(url, { accept: 'image/png,image/jpeg,image/webp,image/gif', maxBytes: WEB_IMAGE_MAX_BYTES, timeoutMs: 20_000, signal });
    return { contentType: response.headers.get('content-type') ?? '', bytes: await readBoundedBytes(response, WEB_IMAGE_MAX_BYTES) };
  },
};

interface CommonsInfo { thumburl?: string; thumbmime?: string; url?: string; mime?: string; size?: number; descriptionurl?: string; extmetadata?: Record<string, { value?: unknown }> }

function commonsInfo(body: unknown): CommonsInfo | null {
  const pages = (body as { query?: { pages?: unknown } })?.query?.pages;
  const page = Array.isArray(pages) ? pages[0] : pages && typeof pages === 'object' ? Object.values(pages)[0] : null;
  const info = (page as { imageinfo?: CommonsInfo[] } | null)?.imageinfo?.[0];
  return info && typeof info === 'object' ? info : null;
}

const meta = (info: CommonsInfo, key: string) => {
  const value = info.extmetadata?.[key]?.value;
  return typeof value === 'string' ? stripImageMetadataHtml(value) : '';
};

/** One licensed, relevant image per request at most. Failures skip the request. */
export async function findCompleteGuideWebImages(
  requests: CompleteGuideWebImageRequest[],
  language: string,
  signal?: AbortSignal,
  deps: WebImageDeps = defaultWebImageDeps,
): Promise<CompleteGuideFigure[]> {
  const figures: CompleteGuideFigure[] = [];
  const used = new Set<string>();
  for (const request of requests) {
    signal?.throwIfAborted();
    let results: SearxngResult[] = [];
    try { results = await deps.search(request.query, language, signal); } catch (error) { if (signal?.aborted) throw error; continue; }
    const candidates = results
      .filter((result) => result.engines.some((engine) => engine.startsWith('wikicommons')) && commonsFileTitle(result.url) && !used.has(result.url))
      .slice(0, 4);
    for (const candidate of candidates) {
      signal?.throwIfAborted();
      try {
        const file = commonsFileTitle(candidate.url)!;
        const query = new URLSearchParams({
          action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', titles: file, iiprop: 'url|mime|size|extmetadata', iiurlwidth: '1200',
          iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|ObjectName|ImageDescription', iiextmetadatalanguage: language, uselang: language,
        });
        const info = commonsInfo(await deps.fetchJson(`${COMMONS_API}?${query.toString()}`, signal));
        if (!info) continue;
        const license = meta(info, 'LicenseShortName');
        if (!freeImageLicense(license)) continue;
        const author = meta(info, 'Artist') || meta(info, 'Credit');
        const title = meta(info, 'ObjectName') || file.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
        if (!imageMatchesQuery(request.query, [candidate.title, candidate.content, title, meta(info, 'ImageDescription')])) continue;
        // The raster rendering Commons serves (always PNG/JPEG, also for SVG originals).
        const imageUrl = info.thumburl && RASTER.test(info.thumbmime ?? 'image/png') ? info.thumburl : info.url && RASTER.test(info.mime ?? '') ? info.url : null;
        if (!imageUrl || (!info.thumburl && (info.size ?? 0) > WEB_IMAGE_MAX_BYTES)) continue;
        const image = await deps.fetchImage(imageUrl, signal);
        if (!RASTER.test(image.contentType) || image.bytes.length > WEB_IMAGE_MAX_BYTES) continue;
        const png = await normalizePng(image.bytes);
        if (!png) continue;
        const licenseUrl = meta(info, 'LicenseUrl');
        const attribution = { title: title.slice(0, 200), author: author.slice(0, 200), license: license.slice(0, 80), ...(/^https?:\/\//.test(licenseUrl) ? { licenseUrl } : {}), url: info.descriptionurl && /^https:\/\/commons\.wikimedia\.org\//.test(info.descriptionurl) ? info.descriptionurl : candidate.url, site: 'Wikimedia Commons' };
        used.add(candidate.url);
        figures.push({ itemId: request.itemId, caption: webImageCaption(request.caption, attribution), png: png.png.toString('base64'), width: png.width, height: png.height, source: attribution.url, wholePage: false, attribution });
        break;
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
  }
  return figures;
}
