// The phone's listening copy must be the desktop's listening copy.
//
// `ios/Packages/NodusAI/Sources/NodusAI/DeepResearch/ReadingCopy.swift` is a port of
// `shared/readingCopy.ts`. A port is a claim about behaviour, and the only way to hold two
// implementations of two hundred lines of regular expressions together is to run both over the
// same inputs and compare the bytes. Re-writing the TypeScript unit tests in Swift would only
// prove the Swift agrees with what somebody *remembered* the rules to be.
//
// The corpus is deliberately mixed: the cases the TypeScript suite locks, the shapes that are
// hardest to port (ICU vs JavaScript regular expressions differ around \p{Lu}, backreferences
// and lazy quantifiers), and — when a lab server is reachable — the Markdown of every Deep
// Research report a real vault has published.
//
// Usage:
//   node scripts/test-reading-copy-parity.mjs
//   NODUS_LAB_URL=http://127.0.0.1:7443 node scripts/test-reading-copy-parity.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-reading-parity-'));

/** Every shape either implementation could plausibly disagree about. */
const CASES = [
  // The TypeScript suite's own cases.
  'El turismo fue propaganda [García, I. (2019)](nodus://idea/g-12) del régimen.',
  'El turismo fue propaganda ([García, I. (2019)](nodus://idea/g-12)) del régimen.',
  'Varios lo sostienen ([García, I. (2019)](nodus://idea/a); [Ortiz, M. (2020)](nodus://work/b)).',
  'Ver nodus://idea/g-12 para el detalle.',
  'Pardo, I. (2018) llegó a hablar de milagro.',
  'De la Torre, M. (s.f.) lo niega.',
  'Hay una [contradicción](nodus://contradiction/c-1) entre las cifras.',
  'Las series son fragmentarias [hueco](nodus://gap/g-1)\nY siguen otras.',
  'El régimen lo negó (García, 2019).',
  'El régimen lo negó (cf. Ortiz, M., 2019, pp. 33-40).',
  'Se firmó en Madrid (Madrid) y nadie lo discutió.',
  'El régimen lo negó (el régimen lo negó en 1966).',
  'La cifra (1966) es la que se publicó.',
  // Reference sections, in several languages, and a section that must survive after one.
  '# Informe\n\nProsa.\n\n## Referencias\n\n- García, I. (2019)\n\n## Anexo\n\nMás prosa.',
  '# Report\n\nProse.\n\n## Bibliography\n\n- One\n- Two\n',
  '# Rapport\n\nProse.\n\n## Références\n\n- Une\n',
  '# Rapor\n\nMetin.\n\n## Kaynakça\n\n- Bir\n',
  '# A\n\n### Notas\n\nnota\n\n## B\n\nsigue',
  // Markdown structure: headings, lists, tables, quotes, fences, emphasis.
  '## Un título\n\n- primero\n- segundo\n\n1. uno\n2. dos\n',
  '| Autor | Año |\n| --- | --- |\n| García | 2019 |\n| Ortiz | 2020 |\n',
  '> Una cita en bloque\n\n---\n\n***\n',
  '```js\nconst a = 1;\n```\n\nDespués.',
  'Esto es **negrita**, esto _cursiva_, esto `código` y esto ~~tachado~~.',
  'Un [enlace normal](https://example.com) y una ![imagen](foto.png).',
  'Nota al pie[^1].\n\n[^1]: La nota.\n',
  '<!-- comentario -->\n<p>Párrafo <b>en</b> HTML</p>\n',
  // Punctuation repair.
  'Uno ([A, B. (2019)](nodus://idea/a)) , dos ; tres .',
  'Frase sin nada que quitar.',
  '',
  '   ',
  // Titles.
  { markdown: 'Prosa del informe.', title: 'El turismo como dispositivo' },
  { markdown: '# Ya lleva título\n\nProsa.', title: null },
];

/** Every Deep Research report a reachable lab server has published. */
async function labReports() {
  const origin = (process.env.NODUS_LAB_URL || 'http://127.0.0.1:7443').replace(/\/+$/, '');
  const email = process.env.NODUS_LAB_ADMIN_EMAIL || 'admin@nodus.test';
  const password = process.env.NODUS_LAB_ADMIN_PASSWORD || 'ios-lab-password-2026-long';
  const out = [];
  try {
    const login = await fetch(`${origin}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(5000),
    });
    if (!login.ok) return out;
    const { spaces = [] } = await login.json();
    for (const space of spaces) {
      const ticket = await (await fetch(`${origin}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })).json();
      const claimed = await fetch(`${origin}/api/v1/auth/device`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket: ticket.ticket, spaceId: space.id, deviceName: 'parity' }),
      });
      if (!claimed.ok) continue;
      const { deviceToken } = await claimed.json();
      const headers = { authorization: `Bearer ${deviceToken}` };
      const list = await fetch(`${origin}/api/v1/spaces/${space.id}/deep-research?limit=100`, { headers });
      if (!list.ok) continue;
      const { reports = [] } = await list.json();
      for (const row of reports) {
        const detail = await fetch(`${origin}/api/v1/spaces/${space.id}/deep-research/${row.id}`, { headers });
        if (!detail.ok) continue;
        const body = await detail.json();
        const draft = body?.report?.draft;
        const parsed = typeof draft === 'string' ? JSON.parse(draft) : draft;
        const markdown = parsed?.draftMarkdown;
        if (typeof markdown === 'string' && markdown.trim()) {
          out.push({ markdown, title: row.title ?? null });
        }
      }
    }
  } catch {
    // No lab server: the hand-written corpus above is still a real test.
  }
  return out;
}

try {
  // Xcode is not a reasonable thing to require of everybody who runs `npm test`. Without a
  // Swift toolchain this says so and stops, rather than failing as though the port were wrong.
  try {
    await run('swift', ['--version']);
  } catch {
    console.log('reading-copy parity: skipped, no Swift toolchain on this machine');
    process.exit(0);
  }

  const outfile = path.join(tmp, 'readingCopy.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/readingCopy.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const { toReadingCopy } = await import(pathToFileURL(outfile).href);

  const published = await labReports();
  const cases = [
    ...CASES.map((entry) => (typeof entry === 'string' ? { markdown: entry, title: null } : entry)),
    ...published,
  ];
  console.log(`${cases.length} inputs (${published.length} of them published reports)`);

  // The Swift side runs as one script over the whole corpus, because a process per case would
  // spend a minute in compiler start-up and prove nothing extra.
  const input = path.join(tmp, 'cases.json');
  await writeFile(input, JSON.stringify(cases), 'utf8');

  // A throwaway SwiftPM executable that depends on the real NodusAI by path. Compiling the
  // harness against the package rather than re-implementing anything is the whole point: what
  // runs here is the same source the app ships.
  const harnessDir = path.join(tmp, 'harness');
  await mkdir(path.join(harnessDir, 'Sources/parity'), { recursive: true });
  await writeFile(path.join(harnessDir, 'Package.swift'), `// swift-tools-version: 6.0
import PackageDescription
let package = Package(
  name: "parity",
  platforms: [.macOS(.v14)],
  dependencies: [.package(path: ${JSON.stringify(path.join(repoRoot, 'ios/Packages/NodusAI'))})],
  targets: [.executableTarget(name: "parity", dependencies: [.product(name: "NodusAI", package: "NodusAI")])]
)
`, 'utf8');
  await writeFile(path.join(harnessDir, 'Sources/parity/main.swift'), `import Foundation
import NodusAI

struct Case: Decodable { let markdown: String; let title: String? }
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let cases = try JSONDecoder().decode([Case].self, from: data)
let output = cases.map { ReadingCopy.text(from: $0.markdown, title: $0.title) }
FileHandle.standardOutput.write(try JSONEncoder().encode(output))
`, 'utf8');

  await run('swift', ['build', '-c', 'debug'], { cwd: harnessDir, maxBuffer: 64 * 1024 * 1024 });
  const { stdout: binPath } = await run('swift', ['build', '-c', 'debug', '--show-bin-path'], { cwd: harnessDir });
  const runner = path.join(binPath.trim(), 'parity');

  const { stdout } = await run(runner, [input], { maxBuffer: 64 * 1024 * 1024 });
  const swift = JSON.parse(stdout);
  assert.equal(swift.length, cases.length, 'the Swift side answered a different number of cases');

  let mismatches = 0;
  cases.forEach((entry, index) => {
    const expected = toReadingCopy(entry.markdown, { title: entry.title ?? undefined });
    if (swift[index] !== expected) {
      mismatches += 1;
      console.error(`\n── case ${index} ──\ninput:    ${JSON.stringify(entry.markdown.slice(0, 220))}`);
      console.error(`desktop:  ${JSON.stringify(expected.slice(0, 400))}`);
      console.error(`phone:    ${JSON.stringify(swift[index].slice(0, 400))}`);
    }
  });
  assert.equal(mismatches, 0, `${mismatches} of ${cases.length} inputs differ between the desktop and the phone`);
  console.log(`reading-copy parity: ${cases.length} inputs identical`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
