/*
 * Nodus Protect — IDprotector-compatible IDPS v1 trace mark.
 *
 * Ported from IDprotector v0.4.1 (MIT).  The wire constants, bit order,
 * key derivation and PNG keyword are intentionally frozen: changing any of
 * them would break bidirectional verification with existing copies.
 */

const MAGIC = new Uint8Array([0x49, 0x44, 0x50, 0x53]); // IDPS
const FORMAT_VERSION = 0x01;
const RECORD_BYTES = 24;
const RECORD_BITS = RECORD_BYTES * 8;
const HEADER_BYTES = 14;
const MAC_BYTES = 10;
const FLAG_PASSPHRASE = 0x01;
const OPEN_KEY_STR = 'idprotector-open-mark-v1';
const PBKDF2_SALT_STR = 'idprotector-stego-salt-v1';
export const IDPS_PBKDF2_ITERATIONS = 310_000;
const MAX_CANDIDATES = 4096;

export const IDPROTECTOR_PNG_KEYWORD = 'idprotector';

export interface IdpsDecodeNotFound {
  found: false;
  verified?: false;
}

export interface IdpsDecodeFound {
  found: true;
  copyIdHex: string;
  verified: boolean;
  keyed: 'open' | 'passphrase' | null;
  flags: number;
  count: number;
  /** Alias used by the verification UI and the original application's copy. */
  candidates: number;
  agreement: number;
}

export type IdpsDecodeResult = IdpsDecodeNotFound | IdpsDecodeFound;

export interface IdpsMetadata {
  copyId: string;
  purpose: string;
  created: string;
  version: 'idps1';
}

const subtle = globalThis.crypto?.subtle;
export const idpsAvailable = Boolean(globalThis.crypto && subtle);

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

export function toHex(bytes: Uint8Array): string {
  let value = '';
  for (let i = 0; i < bytes.length; i += 1) value += `${bytes[i] < 16 ? '0' : ''}${bytes[i].toString(16)}`;
  return value;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function randomCopyId(): Uint8Array {
  if (!idpsAvailable) throw new Error('Web Crypto no está disponible.');
  const id = new Uint8Array(8);
  globalThis.crypto.getRandomValues(id);
  return id;
}

async function importHmacKey(rawBytes: Uint8Array): Promise<CryptoKey> {
  if (!subtle) throw new Error('Web Crypto no está disponible.');
  return subtle.importKey('raw', bufferSource(rawBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function deriveKey(passphrase?: string | null): Promise<CryptoKey> {
  if (!subtle) throw new Error('Web Crypto no está disponible.');
  if (!passphrase) return importHmacKey(utf8(OPEN_KEY_STR));
  const base = await subtle.importKey('raw', bufferSource(utf8(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: bufferSource(utf8(PBKDF2_SALT_STR)),
      iterations: IDPS_PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
}

async function hmacTruncated(key: CryptoKey, header: Uint8Array): Promise<Uint8Array> {
  if (!subtle) throw new Error('Web Crypto no está disponible.');
  const signature = await subtle.sign('HMAC', key, bufferSource(header));
  return new Uint8Array(signature).slice(0, MAC_BYTES);
}

/** Fixed record: magic(4), version(1), flags(1), copyId(8), mac(10). */
export async function buildIdpsPayload(copyId: Uint8Array, passphrase?: string | null): Promise<Uint8Array> {
  if (copyId.length !== 8) throw new Error('El identificador IDPS debe tener 8 bytes.');
  const record = new Uint8Array(RECORD_BYTES);
  record.set(MAGIC, 0);
  record[4] = FORMAT_VERSION;
  record[5] = passphrase ? FLAG_PASSPHRASE : 0;
  record.set(copyId, 6);
  const key = await deriveKey(passphrase);
  record.set(await hmacTruncated(key, record.slice(0, HEADER_BYTES)), HEADER_BYTES);
  return record;
}

function payloadBits(payload: Uint8Array): Uint8Array {
  const bits = new Uint8Array(payload.length * 8);
  for (let i = 0; i < bits.length; i += 1) bits[i] = (payload[i >> 3] >> (7 - (i & 7))) & 1;
  return bits;
}

export function embedIdpsIntoImageData(imageData: ImageData, payload: Uint8Array): void {
  if (payload.length !== RECORD_BYTES) throw new Error('Registro IDPS no válido.');
  const { data } = imageData;
  const bits = payloadBits(payload);
  const pixels = imageData.width * imageData.height;
  let bit = 0;
  for (let p = 0; p < pixels; p += 1) {
    const offset = p * 4;
    data[offset] = (data[offset] & 0xfe) | bits[bit++ % RECORD_BITS];
    data[offset + 1] = (data[offset + 1] & 0xfe) | bits[bit++ % RECORD_BITS];
    data[offset + 2] = (data[offset + 2] & 0xfe) | bits[bit++ % RECORD_BITS];
    data[offset + 3] = 255;
  }
}

export function embedIdpsIntoCanvas(canvas: HTMLCanvasElement, payload: Uint8Array): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No se pudo leer el lienzo.');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  embedIdpsIntoImageData(image, payload);
  ctx.putImageData(image, 0, 0);
}

function extractCandidates(imageData: ImageData): Uint8Array[] {
  const { data } = imageData;
  const totalBits = imageData.width * imageData.height * 3;
  const getBit = (index: number) => data[Math.floor(index / 3) * 4 + (index % 3)] & 1;
  const magicBits = payloadBits(MAGIC);
  const candidates: Uint8Array[] = [];
  let offset = 0;
  const last = totalBits - RECORD_BITS;
  while (offset <= last && candidates.length < MAX_CANDIDATES) {
    let hit = true;
    for (let m = 0; m < 32; m += 1) {
      if (getBit(offset + m) !== magicBits[m]) {
        hit = false;
        break;
      }
    }
    if (hit) {
      let version = 0;
      for (let v = 0; v < 8; v += 1) version = (version << 1) | getBit(offset + 32 + v);
      if (version === FORMAT_VERSION) {
        const record = new Uint8Array(RECORD_BYTES);
        for (let b = 0; b < RECORD_BITS; b += 1) {
          if (getBit(offset + b)) record[b >> 3] |= 0x80 >> (b & 7);
        }
        candidates.push(record);
        offset += RECORD_BITS;
        continue;
      }
    }
    offset += 1;
  }
  return candidates;
}

function majorityVote(candidates: Uint8Array[]): { record: Uint8Array; agreement: number } {
  const voted = new Uint8Array(RECORD_BYTES);
  for (let byte = 0; byte < RECORD_BYTES; byte += 1) {
    for (let bit = 0; bit < 8; bit += 1) {
      let ones = 0;
      const mask = 0x80 >> bit;
      for (const candidate of candidates) if (candidate[byte] & mask) ones += 1;
      if (ones * 2 > candidates.length) voted[byte] |= mask;
    }
  }
  const matching = candidates.reduce((count, candidate) => count + (bytesEqual(candidate, voted) ? 1 : 0), 0);
  return { record: voted, agreement: candidates.length ? matching / candidates.length : 0 };
}

async function verifyRecord(record: Uint8Array, passphrase?: string | null): Promise<{
  verified: boolean;
  keyed: 'open' | 'passphrase' | null;
}> {
  const header = record.slice(0, HEADER_BYTES);
  const mac = record.slice(HEADER_BYTES);
  const openMac = await hmacTruncated(await deriveKey(''), header);
  if (bytesEqual(openMac, mac)) return { verified: true, keyed: 'open' };
  if (!passphrase) return { verified: false, keyed: null };
  const passMac = await hmacTruncated(await deriveKey(passphrase), header);
  return bytesEqual(passMac, mac)
    ? { verified: true, keyed: 'passphrase' }
    : { verified: false, keyed: null };
}

export async function decodeIdps(imageData: ImageData, passphrase?: string | null): Promise<IdpsDecodeResult> {
  const candidates = extractCandidates(imageData);
  if (!candidates.length) return { found: false };
  const vote = majorityVote(candidates);
  const record = vote.record;
  if (!bytesEqual(record.slice(0, 4), MAGIC) || record[4] !== FORMAT_VERSION) return { found: false };
  const verification = await verifyRecord(record, passphrase);
  return {
    found: true,
    copyIdHex: toHex(record.slice(6, 14)),
    verified: verification.verified,
    keyed: verification.keyed,
    flags: record[5],
    count: candidates.length,
    candidates: candidates.length,
    agreement: vote.agreement,
  };
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 33 && bytesEqual(bytes.slice(0, 8), PNG_SIGNATURE);
}

function u32be(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

export function pngInsertTextChunk(pngBytes: Uint8Array, keyword: string, text: string): Uint8Array {
  if (!isPng(pngBytes)) return pngBytes;
  const keywordBytes = utf8(keyword);
  const body = utf8(text);
  const data = new Uint8Array(keywordBytes.length + 5 + body.length);
  data.set(keywordBytes, 0);
  data.set(body, keywordBytes.length + 5);
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(utf8('iTXt'), 0);
  typeAndData.set(data, 4);
  const chunk = new Uint8Array(4 + typeAndData.length + 4);
  chunk.set(u32be(data.length), 0);
  chunk.set(typeAndData, 4);
  chunk.set(u32be(crc32(typeAndData)), 4 + typeAndData.length);
  const cut = 33;
  const output = new Uint8Array(pngBytes.length + chunk.length);
  output.set(pngBytes.slice(0, cut), 0);
  output.set(chunk, cut);
  output.set(pngBytes.slice(cut), cut + chunk.length);
  return output;
}

export function pngReadTextChunks(pngBytes: Uint8Array): Array<{ keyword: string; text: string }> {
  const found: Array<{ keyword: string; text: string }> = [];
  if (!isPng(pngBytes)) return found;
  const decoder = new TextDecoder();
  let position = 8;
  while (position + 12 <= pngBytes.length) {
    const length = (
      (pngBytes[position] << 24)
      | (pngBytes[position + 1] << 16)
      | (pngBytes[position + 2] << 8)
      | pngBytes[position + 3]
    ) >>> 0;
    if (position + 12 + length > pngBytes.length) break;
    const type = String.fromCharCode(
      pngBytes[position + 4], pngBytes[position + 5], pngBytes[position + 6], pngBytes[position + 7],
    );
    const data = pngBytes.slice(position + 8, position + 8 + length);
    if (type === 'iTXt') {
      const zero0 = data.indexOf(0);
      if (zero0 > 0 && data[zero0 + 1] === 0) {
        const zero1 = data.indexOf(0, zero0 + 3);
        const zero2 = zero1 >= 0 ? data.indexOf(0, zero1 + 1) : -1;
        if (zero2 >= 0) {
          found.push({ keyword: decoder.decode(data.slice(0, zero0)), text: decoder.decode(data.slice(zero2 + 1)) });
        }
      }
    } else if (type === 'tEXt') {
      const zero = data.indexOf(0);
      if (zero > 0) found.push({ keyword: decoder.decode(data.slice(0, zero)), text: decoder.decode(data.slice(zero + 1)) });
    } else if (type === 'IEND') {
      break;
    }
    position += 12 + length;
  }
  return found;
}

export function readIdpsPngMetadata(bytes: Uint8Array): IdpsMetadata | null {
  for (const chunk of pngReadTextChunks(bytes)) {
    if (chunk.keyword !== IDPROTECTOR_PNG_KEYWORD) continue;
    try {
      const parsed = JSON.parse(chunk.text) as Partial<IdpsMetadata>;
      if (typeof parsed.copyId !== 'string') return null;
      return {
        copyId: parsed.copyId,
        purpose: typeof parsed.purpose === 'string' ? parsed.purpose : '',
        created: typeof parsed.created === 'string' ? parsed.created : '',
        version: 'idps1',
      };
    } catch {
      return null;
    }
  }
  return null;
}
