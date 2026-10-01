// Local-only connected iOS verification. QR credentials stay in a private, ignored file.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const root = path.resolve(import.meta.dirname, '../..'), require = createRequire(import.meta.url);
const dir = path.resolve(process.argv[2] ?? path.join(root, 'node_modules/.cache/presenter-lan-live'));
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const compiled = path.join(root, 'node_modules/.cache/presenter-lan-live.cjs');
await build({ entryPoints: [path.join(root, 'electron/toolkit/presenter/lan.ts')], outfile: compiled,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', alias: { '@shared': path.join(root, 'shared') } });
const stateModule = path.join(root, 'node_modules/.cache/presenter-lan-state.cjs');
await build({ entryPoints: [path.join(root, 'shared/presenterState.ts')], outfile: stateModule, bundle: true, platform: 'node', format: 'cjs' });
const { LanPresenter } = require(compiled), { beginPresentation, presenterReducer } = require(stateModule);
const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.HelveticaBold);
const titles = ['Native controller', 'Connected video', 'Presenter notes'];
for (const [index, title] of titles.entries()) {
  const page = document.addPage([960, 540]);
  page.drawText('NODUS RESEARCH / PRESENTER', { x: 60, y: 465, font, size: 14, color: rgb(.54, .36, .96) });
  page.drawText(title, { x: 60, y: 290, font, size: 56, color: rgb(.11, .08, .22) });
  page.drawText(`Windows & Linux    ${index + 1} / 3`, { x: 60, y: 70, font, size: 18, color: rgb(.54, .36, .96) });
}
fs.writeFileSync(path.join(dir, 'fixture.pdf'), await document.save());
fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ version: 1, folders: [], presentations: [{
  id: 'fixture', name: 'Windows & Linux', fileName: 'fixture.pdf', createdAt: new Date().toISOString(), totalPages: 3,
  notes: { '1': 'The same native controls, connected over the local network. Scan the QR to pair securely.', '2': 'Video controls appear only on this slide. Playback happens on the computer.', '3': 'Private reading stays on the phone. The audience sees the slide you last projected.' },
  videos: { '2': { url: 'https://youtu.be/aqz-KE-bpKQ', x: 0, y: 0, w: 100, h: 100 } }
}] }));
let state = beginPresentation('fixture', 1, 3), volume = 50;
const save = () => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...state, volume }));
const server = new LanPresenter({ libraryDir: () => dir, getState: () => state,
  onAction: (action, origin) => { state = presenterReducer(state, action); save(); server.broadcast(action, origin); },
  getVolume: () => volume, setVolume: value => { volume = value; save(); } });
await server.start('127.0.0.1');
const info = server.info(['192.0.2.1', '127.0.0.1']); // Unreachable first address verifies the app's race.
fs.writeFileSync(path.join(dir, 'pairing.txt'), info.url, { mode: 0o600 }); save();
console.log('READY: local native-controller test fixture (TLS 1.3; QR written privately).');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.stop(); fs.rmSync(path.join(dir, 'pairing.txt'), { force: true }); process.exit(0); });
