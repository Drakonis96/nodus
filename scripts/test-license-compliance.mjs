import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('packaging generates and exposes the legal bundle', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['licenses:generate'], 'node scripts/generate-third-party-licenses.mjs');
  assert.match(read('build/beforePack.cjs'), /generate-third-party-licenses\.mjs/);
  assert.match(read('build/afterPack.cjs'), /LICENSES\.chromium\.html/);
  assert.deepEqual(
    pkg.build.extraResources.map((entry) => [entry.from, entry.to]),
    [
      ['LICENSE', 'legal/NODUS_LICENSE.txt'],
      ['SOURCE_CODE.md', 'legal/SOURCE_CODE.md'],
      ['THIRD_PARTY_NOTICES.md', 'legal/THIRD_PARTY_NOTICES.md'],
      ['PRIVACY.md', 'legal/PRIVACY.md'],
      ['legal', 'legal'],
      ['dist-zotero/nodus-zotero.xpi', 'zotero/nodus-zotero.xpi'],
      ['dist-zotero/updates.json', 'zotero/updates.json'],
      ['dist-browser/nodus-research-connector-chrome.zip', 'browser/nodus-research-connector-chrome.zip'],
      // Nodus Server itself, so the basic mode can run it as a child process. Outside the asar
      // because it is executed as ESM from disk rather than read as an asset.
      ['server', 'nodus-server'],
      // Reproducible Worker bundle, migrations, pricing catalogue and deployment metadata.
      ['cloudflare/dist', 'nodus-cloudflare'],
    ],
  );
  // Whatever else that folder gains, the shipped copy must never carry a live deployment's state:
  // .env holds an administrator password and data/ is somebody's published corpus.
  const server = pkg.build.extraResources.find((entry) => entry.from === 'server');
  for (const excluded of ['!data', '!data/**/*', '!.env']) {
    assert.ok(server.filter.includes(excluded), `the packaged server must exclude ${excluded}`);
  }
  for (const unpacked of ['node_modules/libheif-js/**/*', 'node_modules/@img/sharp-libvips-*/**/*']) {
    assert.ok(pkg.build.asarUnpack.includes(unpacked));
  }
});

test('special notices cover data, native runtimes and LGPL replacement', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  for (const marker of ['GeoNames', 'CC BY 4.0', 'Multilingual E5 small', 'Transformers.js 3.8.1', 'ONNX Runtime', 'libheif-js', 'sharp-libvips', 'IDprotector']) {
    assert.match(notices, new RegExp(marker));
  }
  const lgpl = read('legal/LGPL_COMPLIANCE.md');
  assert.match(lgpl, /app\.asar\.unpacked/);
  assert.match(lgpl, /v8\.17\.3/);
  assert.match(lgpl, /v1\.19\.8/);
});

test('large upstream notices are immutable and fail-closed', () => {
  const manifest = JSON.parse(read('legal/remote-notices.json'));
  assert.equal(manifest.version, 1);
  assert.ok(manifest.files.length >= 14);
  assert.equal(new Set(manifest.files.map((entry) => entry.destination)).size, manifest.files.length);
  for (const entry of manifest.files) {
    assert.match(entry.url, /^https:\/\//);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  }
  assert.match(read('scripts/generate-third-party-licenses.mjs'), /Digest mismatch/);
});

test('licenses are visible in About and before local model downloads', () => {
  assert.match(read('src/views/Settings.tsx'), /setOpenLegalDoc\('licenses'\)/);
  assert.match(read('src/views/Settings.tsx'), /data-testid="source-code"/);
  assert.match(read('src/legalDocs.ts'), /blob\/main\/THIRD_PARTY_NOTICES\.md/);
  assert.match(read('src/components/LocalAiModelsSettings.tsx'), /model\.licenseLabel/);
  assert.match(read('src/views/AudioGenerationSettings.tsx'), /v\.licenseLabel/);
  assert.match(read('shared/localAiModels.ts'), /LFM Open License 1\.0/);
  assert.match(read('src/lib/audio/piper.ts'), /CC BY-NC-SA 4\.0 · no comercial/);
  assert.match(read('src/components/LocalAiModelsSettings.tsx'), /llama\.cpp · MIT/);
  assert.match(read('src/components/LocalImageModelSettings.tsx'), /stable-diffusion\.cpp · MIT/);
  assert.match(read('src/components/LocalImageModelSettings.tsx'), /Apache 2\.0/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /FLUX\.2 \[klein\] 4B Q4/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /eSpeak NG/);
});
