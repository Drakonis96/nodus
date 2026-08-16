import fs from 'node:fs';
import { Readable } from 'node:stream';
import * as zlib from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  CRC_TABLE[n] = value >>> 0;
}

function updateCrc(crc: number, data: Buffer): number {
  let next = crc;
  for (const byte of data) next = CRC_TABLE[(next ^ byte) & 0xff] ^ (next >>> 8);
  return next >>> 0;
}

function u16(value: number): Buffer { const out = Buffer.allocUnsafe(2); out.writeUInt16LE(value, 0); return out; }
function u32(value: number): Buffer { const out = Buffer.allocUnsafe(4); out.writeUInt32LE(value >>> 0, 0); return out; }

interface CentralEntry {
  name: Buffer;
  method: 0 | 8;
  crc: number;
  compressed: number;
  uncompressed: number;
  offset: number;
}

/** Minimal sequential ZIP32 writer with data descriptors. It invokes
 * `zlib.createDeflateRaw` explicitly, so tests can prove compression is asynchronous. */
export class StreamingZipWriter {
  private readonly output: fs.WriteStream;
  private readonly entries: CentralEntry[] = [];
  private offset = 0;
  private closed = false;

  constructor(private readonly target: string, private readonly level = 6) {
    this.output = fs.createWriteStream(target, { flags: 'wx', mode: 0o600 });
  }

  async addBuffer(name: string, data: Buffer, store = false): Promise<void> {
    await this.add(name, Readable.from([data]), store);
  }

  async addFile(name: string, source: string, store = false): Promise<void> {
    await this.add(name, fs.createReadStream(source), store);
  }

  private async write(data: Buffer): Promise<void> {
    this.offset += data.byteLength;
    if (!this.output.write(data)) await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => { this.output.off('drain', onDrain); this.output.off('error', onError); };
      const onDrain = (): void => { cleanup(); resolve(); };
      const onError = (error: Error): void => { cleanup(); reject(error); };
      this.output.once('drain', onDrain); this.output.once('error', onError);
    });
  }

  private async add(nameText: string, input: Readable, store: boolean): Promise<void> {
    if (this.closed) throw new Error('El ZIP ya está cerrado.');
    const name = Buffer.from(nameText.replace(/\\/g, '/'), 'utf8');
    const method: 0 | 8 = store ? 0 : 8;
    const offset = this.offset;
    const flags = 0x0808; // UTF-8 + trailing data descriptor
    await this.write(Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0),
      u32(0), u32(0), u32(0), u16(name.length), u16(0), name,
    ]));
    let crc = 0xffffffff;
    let uncompressed = 0;
    let compressed = 0;
    const source = store ? input : input.pipe(zlib.createDeflateRaw({ level: this.level }));
    if (store) {
      for await (const raw of source) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        crc = updateCrc(crc, chunk); uncompressed += chunk.byteLength; compressed += chunk.byteLength;
        await this.write(chunk);
      }
    } else {
      input.on('data', (raw: Buffer) => { const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); crc = updateCrc(crc, chunk); uncompressed += chunk.byteLength; });
      for await (const raw of source) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        compressed += chunk.byteLength;
        await this.write(chunk);
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    await this.write(Buffer.concat([u32(0x08074b50), u32(crc), u32(compressed), u32(uncompressed)]));
    this.entries.push({ name, method, crc, compressed, uncompressed, offset });
  }

  async finalize(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const centralOffset = this.offset;
    for (const entry of this.entries) {
      await this.write(Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0x0808), u16(entry.method), u16(0), u16(0),
        u32(entry.crc), u32(entry.compressed), u32(entry.uncompressed), u16(entry.name.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(entry.offset), entry.name,
      ]));
    }
    const centralSize = this.offset - centralOffset;
    await this.write(Buffer.concat([
      u32(0x06054b50), u16(0), u16(0), u16(this.entries.length), u16(this.entries.length),
      u32(centralSize), u32(centralOffset), u16(0),
    ]));
    await new Promise<void>((resolve, reject) => {
      this.output.once('close', resolve); this.output.once('error', reject); this.output.end();
    });
  }

  path(): string { return this.target; }
}
