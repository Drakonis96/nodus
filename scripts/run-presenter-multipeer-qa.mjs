// Manual physical-device comparison. Starts a separate, disposable Nodus
// profile with a synthetic deck and the explicitly selected Multipeer QR.
// The installed application and the production profile are never selected.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, chmod, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nodus-keynote-qa-')));
await chmod(root, 0o700);
await writeFile(path.join(root, 'isolation.json'), JSON.stringify({
  format: 'nodus.isolated-research-profile/1', root,
}), { mode: 0o600 });
const library = path.join(root, 'profile', 'toolkit', 'presenter');
await mkdir(library, { recursive: true, mode: 0o700 });
// Small, self-contained three-page PDF with visible page numbers, no network
// resources, and different speaker notes to test private reading.
const titles = ['Multipeer connection test', 'Images and speaker notes', 'Controls without a router'];
const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>'];
for (let i = 0; i < titles.length; i++) {
  const stream = `0.98 0.97 1 rg 0 0 960 540 re f\n0.43 0.23 0.8 rg 50 420 90 8 re f\nBT /F1 18 Tf 50 460 Td (NODUS PRESENTER / MULTIPEER TEST) Tj ET\n0.08 0.05 0.16 rg BT /F1 42 Tf 50 335 Td (${titles[i]}) Tj ET\n0.35 0.32 0.42 rg BT /F1 24 Tf 50 260 Td (Check the slide, notes and remote controls.) Tj ET\n0.43 0.23 0.8 rg BT /F1 22 Tf 850 40 Td (${i + 1} / 3) Tj ET\n`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 9 0 R >> >> /Contents ${4 + i * 2} 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
}
objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
let pdf = '%PDF-1.4\n', offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const start = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
await writeFile(path.join(library, 'multipeer-test.pdf'), pdf, { mode: 0o600 });
await writeFile(path.join(library, 'library.json'), JSON.stringify({ folders: [], presentations: [{
  id: 'multipeer-test', name: 'Multipeer · prueba de conexión', fileName: 'multipeer-test.pdf',
  createdAt: new Date().toISOString(), totalPages: 3, folderId: null, videos: {},
  notes: { '1': 'Primero comprobamos la conexión, las imágenes y estas notas. Esta presentación utiliza Multipeer Connectivity.',
    '2': 'En modo libro, avanza hasta esta página: la pantalla del Mac debe permanecer en la diapositiva anterior.',
    '3': 'Comprueba las flechas, el puntero, Spotlight y la pantalla en negro. Después repite la conexión sin cable USB.' },
}] }), { mode: 0o600 });
const env = { ...process.env, NODUS_ISOLATED_ROOT: root, NODUS_PRESENTER_TRANSPORT: 'multipeer' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: require('electron'), args: [repo], env, timeout: 60000 });
const page = await app.firstWindow();
await page.waitForFunction(() => Boolean(window.nodus?.startPresenterMode), { timeout: 45000 });
await page.evaluate(async () => {
  await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999,
    recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, uiLanguage: 'es',
    mascotStyleChosen: true, mascotEnabled: false });
  await window.nodus.startPresenterMode('multipeer-test', 1);
});
let presenter;
for (let i = 0; i < 40; i++) {
  presenter = app.windows().find(w => w.url().includes('presenterView.html') && w.url().includes('role=presenter'));
  if (presenter) break;
  await new Promise(r => setTimeout(r, 250));
}
if (!presenter) throw new Error('Presenter window was not created');
await presenter.waitForFunction(() => Boolean(document.querySelector('canvas')));
await presenter.waitForFunction(async () => Boolean((await window.nodus.getPresenterServerInfo())?.native), { timeout: 20000 });
// Leave the QR visible and select the native-app tab. The URL/secret stays in a
// private file for the local diagnostic installation, never console output.
await presenter.getByTitle('Mando móvil (QR)', { exact: true }).click();
await presenter.getByRole('button', { name: 'App iPhone–iPad', exact: true }).click();
const info = await presenter.evaluate(() => window.nodus.getPresenterServerInfo());
const pairURL = info?.native?.url;
if (!pairURL || new URL(pairURL).searchParams.get('version') !== '3'
    || new URL(pairURL).searchParams.get('transport') !== 'multipeer') {
  await app.close();
  throw new Error('Rebuild Electron before running the Multipeer comparison');
}
// Session metadata excludes the QR; only the separate private pairing file
// contains it. Never print that file or pass its contents in launch arguments.
await writeFile(path.join(root, 'session.json'), JSON.stringify({ root, pid: app.process().pid }), { mode: 0o600 });
await writeFile(path.join(root, 'pairing.txt'), pairURL, { mode: 0o600 });
console.log(`Multipeer QA presenter ready. Private profile: ${root}`);
await new Promise(resolve => app.process().once('exit', resolve));
