// Native iOS controller transport for Windows/Linux only. macOS keeps its Swift helper.
import tls, { type TLSSocket } from 'node:tls';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { readLibrary, pdfPath } from './library';
import { nativeAction, CommandWindow } from './nativeProtocol';
import { LanPresenterAssets } from './lanAssets';
import type { PresenterAction, PresenterRuntimeState } from '@shared/presenterState';

const MAX_FRAME = 1_048_576, MAX_PDF = 512 * 1024 * 1024;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v);
type Message = Record<string, any>;
interface Dependencies {
  libraryDir: () => string;
  getState: () => PresenterRuntimeState;
  onAction: (action: PresenterAction, origin: string) => void;
  getVolume: () => number | Promise<number>;
  setVolume: (value: number) => unknown;
}
interface Peer {
  socket: TLSSocket;
  buffer: Buffer;
  channel?: 'control' | 'assets';
  device?: string;
  deadline: ReturnType<typeof setTimeout>;
  transferring: boolean;
}
export interface LanPresenterInfo { url: string; name: string; transport: 'lan' }

/** Prefer physical IPv4 interfaces, but include all usable LAN addresses in the QR. */
export function presenterLanHosts(interfaces = os.networkInterfaces()): string[] {
  const candidates: { address: string; virtual: boolean }[] = [];
  for (const [name, values] of Object.entries(interfaces)) for (const value of values ?? []) {
    if (value.family !== 'IPv4' || value.internal || net.isIP(value.address) !== 4 || value.address.startsWith('169.254.')) continue;
    candidates.push({ address: value.address, virtual: /docker|veth|virbr|vmnet|vbox|utun|tun|tap|tailscale|wsl|hyper-v/i.test(name) });
  }
  candidates.sort((a, b) => Number(a.virtual) - Number(b.virtual));
  return [...new Set(candidates.map(c => c.address))].slice(0, 8);
}

/** Exported class permits real encrypted integration tests without enabling a Mac LAN listener. */
export class LanPresenter {
  private server: tls.Server | null = null;
  private sockets = new Set<net.Socket>();
  private peers = new Set<Peer>();
  private key = crypto.randomBytes(32);
  private service = `nodus-${crypto.randomUUID()}`;
  private fingerprint = '';
  private stopped = false;
  private commands = new CommandWindow();
  private overlay: PresenterAction[] = [];
  private overlaySlide: number;
  private deck: Message = {};
  private assets: LanPresenterAssets | null = null;
  private pendingImages = 0;
  constructor(private deps: Dependencies) { this.overlaySlide = deps.getState().currentSlide; }

  async start(bindHost = '0.0.0.0'): Promise<void> {
    const { generate } = await import('selfsigned');
    const certificate = await generate([{ name: 'commonName', value: this.service }], {
      keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
      notBeforeDate: new Date(Date.now() - 60_000), notAfterDate: new Date(Date.now() + 7 * 86400_000),
    });
    if (this.stopped) return;
    this.fingerprint = new crypto.X509Certificate(certificate.cert).fingerprint256.replace(/:/g, '').toLowerCase();
    const state = this.deps.getState();
    const deck = readLibrary(this.deps.libraryDir()).presentations.find(p => p.id === state.pdfId);
    if (deck && state.pdfId) {
      const file = pdfPath(this.deps.libraryDir(), state.pdfId), stat = fs.statSync(file);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PDF) throw new Error('Unsupported presentation size');
      const assetVersion = `${state.pdfId}:${stat.size}:${stat.mtimeMs}`;
      this.deck = { name: deck.name, notes: deck.notes, videos: deck.videos, assetVersion };
      this.assets = new LanPresenterAssets(file, stat.size);
    }
    const server = tls.createServer({ key: certificate.private, cert: certificate.cert, minVersion: 'TLSv1.3', handshakeTimeout: 10_000 }, socket => this.accept(socket));
    this.server = server;
    server.on('connection', socket => {
      if (this.stopped || this.sockets.size >= 16) { socket.destroy(); return; }
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('error', () => {});
    });
    // Authentication errors deliberately never expose credentials in logs.
    server.on('tlsClientError', () => {});
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, bindHost, () => { server.removeListener('error', reject); resolve(); });
    });
    server.on('error', () => this.stop());
    if (this.stopped) server.close();
  }

  info(hosts = presenterLanHosts()): LanPresenterInfo | null {
    const address = this.server?.address();
    if (this.stopped || !address || typeof address === 'string' || !hosts.length) return null;
    const url = new URL('nodus-presenter://pair');
    url.search = new URLSearchParams({ version: '2', transport: 'lan', service: this.service,
      key: this.key.toString('base64'), fingerprint: this.fingerprint, hosts: hosts.join(','), port: String(address.port), name: os.hostname().replace(/\.local$/, '') }).toString();
    return { url: url.toString(), name: os.hostname().replace(/\.local$/, ''), transport: 'lan' };
  }

  private accept(socket: TLSSocket): void {
    if (this.stopped) { socket.destroy(); return; }
    socket.setNoDelay(true); socket.disableRenegotiation();
    const peer: Peer = { socket, buffer: Buffer.alloc(0), deadline: setTimeout(() => socket.destroy(), 10_000), transferring: false };
    this.peers.add(peer);
    socket.on('close', () => { clearTimeout(peer.deadline); this.peers.delete(peer); });
    socket.on('error', () => {});
    socket.on('data', data => {
      try {
        peer.buffer = Buffer.concat([peer.buffer, data]);
        while (peer.buffer.length >= 4) {
          const length = peer.buffer.readUInt32BE();
          if (!length || length > MAX_FRAME) throw new Error('Invalid frame');
          if (peer.buffer.length < length + 4) break;
          const message = JSON.parse(peer.buffer.subarray(4, length + 4).toString('utf8'));
          peer.buffer = peer.buffer.subarray(length + 4);
          this.receive(peer, message);
          if (socket.destroyed) break;
        }
        if (peer.buffer.length > MAX_FRAME + 4) socket.destroy();
      } catch { socket.destroy(); }
    });
  }

  private send(peer: Peer, message: Message): Promise<void> {
    if (this.stopped || peer.socket.destroyed) return Promise.reject(new Error('Session ended'));
    const bytes = Buffer.from(JSON.stringify(message));
    if (!bytes.length || bytes.length > MAX_FRAME || peer.socket.writableLength > 2 * MAX_FRAME) { peer.socket.destroy(); return Promise.reject(new Error('Peer too slow')); }
    const prefix = Buffer.alloc(4); prefix.writeUInt32BE(bytes.length);
    return new Promise((resolve, reject) => peer.socket.write(Buffer.concat([prefix, bytes]), error => error ? reject(error) : resolve()));
  }
  private deliver(peer: Peer, message: Message): void { void this.send(peer, message).catch(() => peer.socket.destroy()); }
  private assetError(peer: Peer, page?: number): void { this.deliver(peer, { kind: 'assetError', ...(page === undefined ? {} : { page }) }); }

  private receive(peer: Peer, message: unknown): void {
    if (this.stopped) { peer.socket.destroy(); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) { peer.socket.destroy(); return; }
    const m = message as Message;
    if (!peer.channel) {
      const key = typeof m.key === 'string' ? Buffer.from(m.key, 'base64') : Buffer.alloc(0);
      if (m.kind !== 'hello' || m.version !== 1 || !['control', 'assets'].includes(m.channel) || !uuid(m.deviceId)
        || key.length !== this.key.length || !crypto.timingSafeEqual(key, this.key)) { peer.socket.destroy(); return; }
      peer.channel = m.channel; peer.device = m.deviceId; clearTimeout(peer.deadline);
      if (peer.channel === 'control') {
        this.deliver(peer, { kind: 'update', state: this.deps.getState(), deck: this.deck, overlay: this.overlay });
        void Promise.resolve(this.deps.getVolume()).then(value => this.deliver(peer, { kind: 'volume', value })).catch(() => {});
      }
      return;
    }
    if (m.kind === 'ping') { this.deliver(peer, { kind: 'pong' }); return; }
    if (peer.channel === 'control') {
      if (m.kind === 'action') {
        const action = nativeAction(m.action);
        if (action && this.commands.accept(m.commandId)) this.deps.onAction(action, peer.device!);
      } else if (m.kind === 'volume' && typeof m.value === 'number' && Number.isFinite(m.value)) {
        void Promise.resolve(this.deps.setVolume(Math.max(0, Math.min(100, m.value))))
          .then(() => this.deps.getVolume()).then(value => this.broadcastVolume(value)).catch(() => {});
      }
      return;
    }
    if (m.assetVersion !== this.deck.assetVersion || !this.assets) { this.assetError(peer, m.page); return; }
    if (m.kind === 'image') {
      if (!Number.isInteger(m.page) || m.page < 1 || m.page > 100000 || this.pendingImages >= 12) { this.assetError(peer, m.page); return; }
      this.pendingImages += 1;
      void this.assets.preview(m.page).then(bytes => this.deliver(peer, { kind: 'image', page: m.page, assetVersion: this.deck.assetVersion, data: bytes.toString('base64') }))
        .catch(() => this.assetError(peer, m.page)).finally(() => { this.pendingImages -= 1; });
    } else if (m.kind === 'pdf') {
      if (!Number.isInteger(m.offset) || m.offset < 0 || m.offset > this.assets.size) { this.assetError(peer); return; }
      if (!peer.transferring) void this.streamPDF(peer, m.offset);
    }
  }

  private async streamPDF(peer: Peer, offset: number): Promise<void> {
    const assets = this.assets!; peer.transferring = true;
    let file: fs.promises.FileHandle | null = null;
    let completion: Message | null = null;
    try {
      file = await fs.promises.open(assets.file, 'r');
      await this.send(peer, { kind: 'pdfBegin', assetVersion: this.deck.assetVersion, size: assets.size, offset });
      const buffer = Buffer.alloc(65536);
      while (offset < assets.size && !this.stopped && !peer.socket.destroyed) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, assets.size - offset), offset);
        if (!bytesRead) throw new Error('Incomplete PDF');
        await this.send(peer, { kind: 'pdfChunk', assetVersion: this.deck.assetVersion, offset, data: buffer.subarray(0, bytesRead).toString('base64') });
        offset += bytesRead;
      }
      if (offset === assets.size) completion = { kind: 'pdfEnd', assetVersion: this.deck.assetVersion, sha256: await assets.hash() };
    } catch { completion = { kind: 'assetError' }; }
    finally { await file?.close().catch(() => {}); peer.transferring = false; }
    // Completion lets the client request another transfer immediately. Release
    // the file and guard first, so that request cannot be silently discarded.
    if (completion && !this.stopped && !peer.socket.destroyed) this.deliver(peer, completion);
  }

  broadcast(action: PresenterAction, origin?: string): void {
    const slide = this.deps.getState().currentSlide;
    if (slide !== this.overlaySlide || action.type === 'clearDraw' || (action.type === 'toolData' && action.data.action === 'clear')) { this.overlay = []; this.overlaySlide = slide; }
    if (action.type === 'toolData') {
      if (action.data.tool !== 'draw') this.overlay = this.overlay.filter(a => a.type !== 'toolData' || a.data.tool !== action.data.tool);
      this.overlay.push(action);
      if (this.overlay.length > 2048) this.overlay = []; // Never replay a partial stroke.
    }
    for (const peer of this.peers) if (peer.channel === 'control') this.deliver(peer, { kind: 'update', state: this.deps.getState(), action, origin });
  }
  broadcastVolume(value: number): void {
    for (const peer of this.peers) if (peer.channel === 'control') this.deliver(peer, { kind: 'volume', value });
  }
  stop(): void {
    this.stopped = true;
    for (const peer of this.peers) clearTimeout(peer.deadline);
    for (const peer of this.peers) {
      if (peer.channel === 'control' && !peer.socket.destroyed) {
        const bytes = Buffer.from('{"kind":"ended"}'), prefix = Buffer.alloc(4); prefix.writeUInt32BE(bytes.length);
        peer.socket.end(Buffer.concat([prefix, bytes]));
        setTimeout(() => peer.socket.destroy(), 200).unref();
      } else peer.socket.destroy();
    }
    for (const socket of this.sockets) setTimeout(() => socket.destroy(), 200).unref();
    this.peers.clear(); this.sockets.clear(); this.server?.close(); this.server = null;
    this.assets?.dispose(); this.assets = null; this.key.fill(0);
  }
}

let active: LanPresenter | null = null;
export async function startLanPresenter(deps: Dependencies): Promise<void> {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  stopLanPresenter();
  const instance = new LanPresenter(deps); active = instance;
  try { await instance.start(); } catch { if (active === instance) stopLanPresenter(); }
}
export function stopLanPresenter(): void { active?.stop(); active = null; }
export function broadcastLanPresenter(action: PresenterAction, origin?: string): void { active?.broadcast(action, origin); }
export function broadcastLanVolume(value: number): void { active?.broadcastVolume(value); }
export function getLanPresenterInfo(): LanPresenterInfo | null { return active?.info() ?? null; }
