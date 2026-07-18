import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './database';
import { createStudyShortId } from '@shared/studyOrg';
import { LOGO_MAX_EDGE, type TeachingLogo } from '@shared/teachingExams';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

function toLogo(row: Row): TeachingLogo {
  return {
    id: String(row.id),
    shortId: String(row.short_id),
    name: String(row.name ?? ''),
    dataUrl: String(row.data_url ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listTeachingLogos(): TeachingLogo[] {
  return (getDb().prepare('SELECT * FROM teaching_logos ORDER BY created_at DESC').all() as Row[]).map(toLogo);
}

export function deleteTeachingLogo(id: string): void {
  // Exams keep their own copy of the image, so removing a library entry never blanks
  // a paper that already uses it.
  getDb().prepare('DELETE FROM teaching_logos WHERE id = ?').run(id);
}

export function addTeachingLogo(name: string, dataUrl: string): TeachingLogo {
  const id = crypto.randomUUID();
  const shortId = createStudyShortId('LGO', id);
  const timestamp = now();
  getDb()
    .prepare('INSERT INTO teaching_logos (id, short_id, name, data_url, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
    .run(id, shortId, name.trim() || 'Logotipo', dataUrl, timestamp, timestamp);
  return toLogo(getDb().prepare('SELECT * FROM teaching_logos WHERE id = ?').get(id) as Row);
}

/**
 * Read an image from disk and downscale it to a printable logo.
 *
 * Importing the raw file was the wrong shape: a phone photo or a big PNG turned into a
 * multi-megabyte base64 string that had to be embedded in the vault row, in the live
 * preview and in every exported file — slow, and previously rejected outright with a
 * size error the IPC layer then replaced with a generic message. Resizing on import
 * means any picture the teacher has works, and the stored result is a few KB.
 */
export async function importLogoFromFile(filePath: string): Promise<{ name: string; dataUrl: string }> {
  return importScaledImage(filePath, LOGO_MAX_EDGE);
}

/**
 * A figure the students look at needs more detail than a crest, but still nothing like
 * a 12 MP original — 1600px on the long edge prints crisply at A4 width.
 */
export async function importImageFromFile(filePath: string): Promise<{ name: string; dataUrl: string }> {
  return importScaledImage(filePath, 1600);
}

async function importScaledImage(filePath: string, maxEdge: number): Promise<{ name: string; dataUrl: string }> {
  const stat = fs.statSync(filePath);
  // 40 MB is a RAW/TIFF-sized file, not a logo — refuse before decoding it.
  if (stat.size > 40 * 1024 * 1024) throw new Error('Ese archivo es demasiado grande para un logotipo.');

  const bytes = fs.readFileSync(filePath);
  const name = path.basename(filePath);
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');

  let image;
  try {
    image = await loadImage(bytes);
  } catch {
    throw new Error('No se pudo leer la imagen. Usa un PNG, JPG o WebP.');
  }
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  // PNG keeps transparency, which crests and letterheads normally rely on.
  const png = canvas.toBuffer('image/png');
  return { name, dataUrl: `data:image/png;base64,${png.toString('base64')}` };
}
