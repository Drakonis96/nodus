// Explicit CI fixture setup, never imported by the application or its OCR path.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const revision = '87416418657359cb625c412a48b6e1d6d41c29bd';
const sha256 = '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2';
const response = await fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${revision}/eng.traineddata`);
if (!response.ok) throw new Error(`OCR fixture download: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('OCR fixture hash mismatch');
const folder = path.resolve(import.meta.dirname, '.cache/tessdata');
await fs.mkdir(folder, { recursive: true });
await fs.writeFile(path.join(folder, 'eng.traineddata'), bytes);
console.log(JSON.stringify({ fixture: 'tesseract-ocr/tessdata_fast', revision, sha256 }));
