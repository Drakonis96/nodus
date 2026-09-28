/**
 * Figures from the student's own materials for a complete study guide: crops of the
 * images placed on the referenced PDF page, the pictures of the referenced slide, or
 * the image material itself. After the guide is saved they are seeded as ready
 * figures of its document-visual manifest, so the reader, PDF, Word and Markdown
 * exports all show them through the existing figure path.
 */
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { documentBlocks, type DocumentFigure, type DocumentVisualManifest } from '@shared/documentSkills';
import { researchVisualFields } from '@shared/documentVisualContent';
import { figureBlockId, type CompleteGuideFigure, type CompleteGuideFigureRequest } from '@shared/completeGuide/figures';
import { getDb } from '../../db/database';
import { getWritingWorkshopDraft } from '../../db/writingDraftsRepo';
import { readDocumentVisuals, visualContentHash, writeDocumentVisuals } from '../../capabilities/documentStore';
import { extractPdfPageFigures } from '../../library/libraryExtractionEngine';
import { getActiveVault } from '../../vaults/vaultRegistry';

type Row = Record<string, unknown>;
const MAX_WIDTH = 1400;

async function normalizePng(input: Buffer): Promise<{ png: Buffer; width: number; height: number } | null> {
  try {
    const image = sharp(input, { failOn: 'none' }).rotate();
    const meta = await image.metadata();
    if (!meta.width || !meta.height || meta.width < 80 || meta.height < 60) return null;
    const stats = await sharp(input, { failOn: 'none' }).stats();
    // Near-uniform pixels are backgrounds and separators, not figures.
    if (stats.channels.slice(0, 3).every((channel) => channel.stdev < 6)) return null;
    const png = await image.resize({ width: Math.min(MAX_WIDTH, meta.width), withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    const size = await sharp(png).metadata();
    return { png, width: size.width ?? meta.width, height: size.height ?? meta.height };
  } catch {
    return null;
  }
}

/** Pictures on the given slides, skipping template art repeated across the deck. */
export function pptxSlidePictures(bytes: Buffer, slides: number[]): Array<{ slide: number; data: Buffer }> {
  const zip = new AdmZip(bytes);
  const slideEntries = zip.getEntries().filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName));
  const mediaOf = (slide: number): string[] => {
    const xml = zip.readAsText(`ppt/slides/slide${slide}.xml`);
    const rels = zip.readAsText(`ppt/slides/_rels/slide${slide}.xml.rels`);
    if (!xml || !rels) return [];
    const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((match) => [match[1], match[2]]));
    const pictures = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map((match) => match[0]);
    return pictures.flatMap((picture) => {
      const id = picture.match(/r:embed="([^"]+)"/)?.[1];
      const target = id ? targets.get(id) : undefined;
      return target ? [`ppt/${target.replace(/^\.\.\//, '')}`] : [];
    });
  };
  const usage = new Map<string, number>();
  for (const entry of slideEntries) {
    const number = Number(entry.entryName.match(/slide(\d+)\.xml$/)![1]);
    for (const media of new Set(mediaOf(number))) usage.set(media, (usage.get(media) ?? 0) + 1);
  }
  const template = (media: string) => (usage.get(media) ?? 0) >= Math.max(3, slideEntries.length * 0.3);
  const result: Array<{ slide: number; data: Buffer }> = [];
  for (const slide of [...new Set(slides)]) {
    const candidates = mediaOf(slide).filter((media) => !template(media) && /\.(png|jpe?g|gif|bmp|tiff?|webp)$/i.test(media));
    const biggest = candidates.map((media) => ({ media, data: zip.readFile(media) })).filter((entry): entry is { media: string; data: Buffer } => Boolean(entry.data))
      .sort((a, b) => b.data.length - a.data.length)[0];
    if (biggest) result.push({ slide, data: biggest.data });
  }
  return result;
}

/** Render the requested figures. Sources that fail are skipped, never fatal. */
export async function extractCompleteGuideFigures(requests: CompleteGuideFigureRequest[], signal?: AbortSignal): Promise<CompleteGuideFigure[]> {
  const citation = (request: CompleteGuideFigureRequest) => request.source;
  const byMaterial = new Map<string, CompleteGuideFigureRequest[]>();
  for (const request of requests) byMaterial.set(request.materialId, [...(byMaterial.get(request.materialId) ?? []), request]);
  const figures: CompleteGuideFigure[] = [];
  const statement = getDb().prepare('SELECT content_blob, mime_type, file_name FROM study_materials WHERE id = ? AND deleted_at IS NULL');
  for (const [materialId, list] of byMaterial) {
    signal?.throwIfAborted();
    const row = statement.get(materialId) as Row | undefined;
    const bytes = row?.content_blob as Buffer | undefined;
    if (!bytes) continue;
    const mime = String(row?.mime_type ?? '');
    const name = String(row?.file_name ?? '').toLowerCase();
    try {
      if (mime === 'application/pdf' || name.endsWith('.pdf')) {
        const pages = list.flatMap((request) => (request.page ? [request.page] : []));
        const crops = await extractPdfPageFigures(new Uint8Array(bytes), pages, { wholePageFallback: true, signal });
        for (const request of list) {
          const crop = crops.filter((entry) => entry.page === request.page).sort((a, b) => b.width * b.height - a.width * a.height)[0];
          const png = crop ? await normalizePng(crop.png) : null;
          if (crop && png) figures.push({ itemId: request.itemId, caption: request.caption, png: png.png.toString('base64'), width: png.width, height: png.height, source: citation(request), wholePage: crop.wholePage });
        }
      } else if (/presentationml/.test(mime) || name.endsWith('.pptx')) {
        const pictures = pptxSlidePictures(bytes, list.flatMap((request) => (request.slide ? [request.slide] : [])));
        for (const request of list) {
          const picture = pictures.find((entry) => entry.slide === request.slide);
          const png = picture ? await normalizePng(picture.data) : null;
          if (png) figures.push({ itemId: request.itemId, caption: request.caption, png: png.png.toString('base64'), width: png.width, height: png.height, source: citation(request), wholePage: false });
        }
      } else if (mime.startsWith('image/')) {
        const png = await normalizePng(bytes);
        if (png) figures.push({ itemId: list[0].itemId, caption: list[0].caption, png: png.png.toString('base64'), width: png.width, height: png.height, source: citation(list[0]), wholePage: false });
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('[complete guide] figures skipped for a material', error);
    }
  }
  return figures;
}

/**
 * Seed the saved guide's figure manifest with ready figures. Existing figures (a
 * re-run, skills added later) are kept; blocks that already have one are skipped.
 */
export function seedCompleteGuideFigures(draftId: string, figures: CompleteGuideFigure[], siblings: (itemId: string) => string[] = () => []): number {
  const saved = getWritingWorkshopDraft(draftId);
  if (!saved || !figures.length) return 0;
  const target = { kind: 'deep-research' as const, id: draftId };
  const vaultId = getActiveVault().id;
  const fields = researchVisualFields(saved.draft);
  const blocks = documentBlocks(fields);
  const previous = readDocumentVisuals(vaultId, target);
  const contentHash = visualContentHash(fields);
  const existing = previous?.contentHash === contentHash ? previous.figures.filter((figure) => figure.state === 'ready') : [];
  const taken = new Set(existing.map((figure) => figure.blockId));
  const seeded: DocumentFigure[] = [];
  for (const figure of figures) {
    const blockId = figureBlockId(blocks, figure.itemId, siblings(figure.itemId));
    if (!blockId || taken.has(blockId)) continue;
    taken.add(blockId);
    seeded.push({
      id: `material-${randomUUID()}`, blockId, skillId: 'nodus.material-figure', brief: '', caption: figure.caption,
      sources: [figure.source], layout: figure.wholePage ? 'compact' : 'wide', state: 'ready', poster: `data:image/png;base64,${figure.png}`,
    });
  }
  if (!seeded.length) return 0;
  const now = new Date().toISOString();
  const manifest: DocumentVisualManifest = {
    schemaVersion: 1, target, vaultId, contentHash, revision: randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now,
    state: 'ready', policy: previous?.policy ?? { enabled: true, skills: [] }, usage: previous?.usage ?? {}, blocks,
    figures: [...existing, ...seeded], discarded: previous?.discarded ?? [],
  };
  writeDocumentVisuals(manifest);
  return seeded.length;
}
