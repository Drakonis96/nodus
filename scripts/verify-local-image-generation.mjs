import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'nodus-flux2-verification-'));
const worker = path.join(temporary, 'worker.cjs');
const outputDirectory = path.resolve(process.env.NODUS_FLUX_OUTPUT || path.join(root, 'artifacts', 'flux2-klein-samples'));
const profileDirectory = path.resolve(process.env.NODUS_FLUX_PROFILE || path.join(temporary, 'profile'));

const entry = `
import { app } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NODUS_LOCAL_IMAGE_MODEL } from '@shared/localImageModels';
import { downloadNodusLocalImageModel, generateNodusLocalImage, getNodusLocalImageStatus } from './electron/ai/nodusLocalImages';

app.setName('Nodus');
app.setPath('userData', process.env.NODUS_FLUX_PROFILE);

async function main() {
await app.whenReady();
await mkdir(process.env.NODUS_FLUX_OUTPUT, { recursive: true });

const before = await getNodusLocalImageStatus();
if (!before.model.downloaded || !before.runtime.ready) {
  let last = -1;
  await downloadNodusLocalImageModel(NODUS_LOCAL_IMAGE_MODEL.id, (fraction) => {
    const percent = Math.floor(fraction * 100);
    if (percent !== last) { last = percent; process.stdout.write(\`\\r[FLUX.2] descarga \${percent}%\`); }
  });
  process.stdout.write('\\n');
}

const samples = [
  {
    file: '01-biblioteca-borrador.png',
    quality: 'draft',
    prompt: 'Wide cinematic editorial illustration of a quiet historic library at blue hour, a wooden research desk covered with old maps and handwritten notes, one warm brass lamp, tall shelves fading into soft shadows, subtle teal and amber color palette, realistic materials, atmospheric depth, no people, no visible text, no letters, no logos, no watermark.',
  },
  {
    file: '02-jardin-equilibrada.png',
    quality: 'balanced',
    prompt: 'Wide painterly scene of a Mediterranean botanical garden after rain, orange trees and aromatic herbs surrounding a narrow stone path, tiny water droplets catching golden sunrise light, a robin perched on an old ceramic fountain, highly detailed natural textures, elegant color harmony, no visible text, no letters, no logos, no watermark.',
  },
  {
    file: '03-observatorio-alta.png',
    quality: 'high',
    prompt: 'Wide retrofuturist scientific observatory above a calm sea at night, a large open copper telescope aimed at a luminous spiral galaxy, moonlit clouds, intricate instruments and cables, cinematic composition, deep indigo with restrained copper highlights, crisp detail, no people, no visible text, no letters, no logos, no watermark.',
  },
];

for (const [index, sample] of samples.entries()) {
  process.stdout.write(\`[FLUX.2] generando \${index + 1}/\${samples.length} (\${sample.quality})…\\n\`);
  const generated = await generateNodusLocalImage(NODUS_LOCAL_IMAGE_MODEL.id, sample.prompt, sample.quality);
  await writeFile(path.join(process.env.NODUS_FLUX_OUTPUT, sample.file), generated.bytes);
}
console.log(\`[FLUX.2] muestras guardadas en \${process.env.NODUS_FLUX_OUTPUT}\`);
app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
`;

try {
  await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: 'verify-local-image-worker.ts', loader: 'ts' },
    outfile: worker,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    plugins: [{
      name: 'shared-alias',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@shared\// }, (args) => ({ path: path.join(root, 'shared', `${args.path.slice('@shared/'.length)}.ts`) }));
      },
    }],
    logLevel: 'silent',
  });
  execFileSync(path.join(root, 'node_modules', '.bin', 'electron'), [worker], {
    cwd: root,
    env: { ...process.env, NODUS_FLUX_OUTPUT: outputDirectory, NODUS_FLUX_PROFILE: profileDirectory },
    stdio: 'inherit',
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
