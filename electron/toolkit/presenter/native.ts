import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readLibrary, pdfPath } from './library';
import type { PresenterAction, PresenterRuntimeState } from '@shared/presenterState';
import { nativeAction, CommandWindow } from './nativeProtocol';

interface Dependencies {
  libraryDir: () => string;
  getState: () => PresenterRuntimeState;
  onAction: (action: PresenterAction, origin: string) => void;
  getVolume: () => number | Promise<number>;
  setVolume: (value: number) => unknown;
}
let helper: ChildProcessWithoutNullStreams | null = null;
let pairing: { url: string; name: string } | null = null;
let deps: Dependencies | null = null;
let ready = false;
let commands = new CommandWindow();
let overlay: PresenterAction[] = [];
let overlaySlide = 0;
let snapshotDeck: Record<string, unknown> = {};
let multipeerMode = false;
function write(value: unknown): void {
  if (helper && !helper.stdin.destroyed) helper.stdin.write(JSON.stringify(value) + '\n');
}
function send(message: unknown, id?: string): void { write({ kind: 'send', id, message }); }
function snapshot(id?: string): void {
  if (!deps) return;
  send({ kind: 'update', state: deps.getState(), deck: snapshotDeck, overlay }, id);
}
export function startNativePresenter(d: Dependencies): void {
  stopNativePresenter();
  if (process.platform !== 'darwin') return;
  const binary = app.isPackaged
    ? path.join(process.resourcesPath, 'presenter-native', 'nodus-presenter-native')
    : path.join(app.getAppPath(), 'build', 'presenter-native', process.arch, 'nodus-presenter-native');
  if (!fs.existsSync(binary)) return;
  deps = d; commands = new CommandWindow(); overlay = []; overlaySlide = d.getState().currentSlide;
  const service = `nodus-${crypto.randomUUID().toLowerCase()}`, key = crypto.randomBytes(32).toString('base64');
  const name = os.hostname().replace(/\.local$/, '');
  // Explicit local experiment; existing Mac QR and Network transport stay the default.
  const multipeer = process.env.NODUS_PRESENTER_TRANSPORT === 'multipeer';
  multipeerMode = multipeer;
  const url = new URL('nodus-presenter://pair');
  url.search = new URLSearchParams({ version: multipeer ? '3' : '1', service, key, name,
    ...(multipeer ? { transport: 'multipeer' } : {}) }).toString();
  pairing = { url: url.toString(), name };
  const child = spawn(binary, multipeer ? ['--multipeer'] : [], { stdio: 'pipe', windowsHide: true }); helper = child;
  child.stdin.on('error', () => { if (helper === child) stopNativePresenter(); });
  child.stderr.resume(); // No credential-bearing helper output enters application logs.
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (helper !== child) return;
    buffer += chunk;
    if (buffer.length > 2 * 1024 * 1024) { stopNativePresenter(); return; }
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try { void receive(JSON.parse(line), child); } catch { /* Invalid child message. */ }
    }
  });
  child.on('error', () => { if (helper === child) stopNativePresenter(); });
  child.on('exit', () => { if (helper === child) { helper = null; ready = false; pairing = null; deps = null; } });
  write({ kind: 'configure', service, key, ...(multipeer ? { transport: 'multipeer' } : {}) });
  const state = d.getState(), deck = readLibrary(d.libraryDir()).presentations.find(p => p.id === state.pdfId);
  if (deck && state.pdfId) {
    const file = pdfPath(d.libraryDir(), state.pdfId);
    try {
      const stat = fs.statSync(file), assetVersion = `${state.pdfId}:${stat.size}:${stat.mtimeMs}`;
      snapshotDeck = { name: deck.name, notes: deck.notes, videos: deck.videos, assetVersion };
      write({ kind: 'deck', path: file, assetVersion });
    } catch { snapshotDeck = {}; }
  }
}
async function receive(message: any, child: ChildProcessWithoutNullStreams): Promise<void> {
  if (!deps || child !== helper) return;
  if (message.kind === 'ready') ready = true;
  if (message.kind === 'unavailable') { stopNativePresenter(); return; }
  if (message.kind === 'client' && message.channel === 'control') {
    snapshot(message.id);
    const value = await deps.getVolume();
    if (helper === child) send({ kind: 'volume', value }, message.id);
  }
  if (message.kind === 'action') {
    const action = nativeAction(message.action);
    if (action && commands.accept(message.commandId)) deps.onAction(action, String(message.origin ?? ''));
  }
  if (message.kind === 'volume' && typeof message.value === 'number' && Number.isFinite(message.value)) {
    const value = Math.min(100, Math.max(0, message.value));
    await deps.setVolume(value);
    if (helper === child) send({ kind: 'volume', value });
  }
}
export function broadcastNativePresenter(action: PresenterAction, origin?: string): void {
  if (!deps) return;
  const slide = deps.getState().currentSlide;
  if (overlaySlide !== slide || action.type === 'clearDraw' || (action.type === 'toolData' && action.data.action === 'clear')) { overlay = []; overlaySlide = slide; }
  if (action.type === 'toolData') {
    if (action.data.tool !== 'draw') overlay = overlay.filter(a => a.type !== 'toolData' || a.data.tool !== action.data.tool);
    // Bound replay memory without replaying partial strokes after truncation.
    if (overlay.length >= 8192) overlay = [];
    overlay.push(action);
  }
  if (multipeerMode && action.type === 'toolData') {
    // Positions and stroke points do not change canonical state. Avoid sending
    // a whole snapshot back to the phone for every movement; this also avoids
    // a full SwiftUI state publication for every locally painted point.
    send({ kind: 'tool', action, origin });
  } else {
    send({ kind: 'update', state: deps.getState(), action, origin });
  }
}
export function getNativePresenterInfo(): { url: string; name: string } | null { return ready ? pairing : null; }
export function stopNativePresenter(): void {
  const child = helper;
  if (child) { send({ kind: 'ended' }); write({ kind: 'stop' }); helper = null; child.stdin.end(); const timer = setTimeout(() => child.kill(), 1000); timer.unref(); }
  ready = false; pairing = null; deps = null; overlay = []; snapshotDeck = {};
  multipeerMode = false;
}
