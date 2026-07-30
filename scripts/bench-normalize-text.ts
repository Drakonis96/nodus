// What normalizeText actually costs, and the negative result that matters:
// profiling `reading:path` blamed ~133 ms of its 212 ms on this function, but
// normalising every string the vault holds takes about 8 ms. The function was
// never slow — it was being called tens of thousands of times by a caller that
// built a full deduplicated list to show three items. Optimising the normaliser
// would have bought almost nothing; this file is here so nobody tries again.
//
// It does check one real simplification: the trailing `\s+` pass cannot match,
// because the class before it has already collapsed every whitespace run into a
// single space. Candidates are timed on the vault's own strings and must return
// exactly what the original returns for every one of them — a normaliser that
// differs on a single accent silently changes which works count as cited.
import Database from 'better-sqlite3';
import path from 'node:path';

const userData = process.env.NODUS_TEST_USERDATA;
if (!userData) throw new Error('NODUS_TEST_USERDATA is required');
const db = new Database(path.join(userData, 'nodus.sqlite'), { readonly: true });

const corpus = [
  ...(db.prepare('SELECT cited_work AS v FROM external_refs').all() as { v: string | null }[]),
  ...(db.prepare('SELECT title AS v FROM works').all() as { v: string | null }[]),
  ...(db.prepare('SELECT authors_json AS v FROM works').all() as { v: string | null }[]),
].map((r) => r.v);

console.log(`cadenas del vault: ${corpus.length}\n`);

/** The implementation as it stands. */
function original(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// `[^a-z0-9ñ]+` already collapses every run of non-alphanumerics — spaces
// included — into a single space, so the `\s+` pass that follows it can only ever
// match single spaces and rewrite them as themselves.
function withoutRedundantPass(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/gi, ' ')
    .trim();
}

const candidates: [string, (t: string | null | undefined) => string][] = [
  ['original', original],
  ['sin la pasada \\s+ redundante (aplicada)', withoutRedundantPass],
];

// ── equivalence first: a faster wrong answer is not a result ─────────────────
const expected = corpus.map(original);
for (const [name, fn] of candidates) {
  let mismatch = -1;
  for (let i = 0; i < corpus.length; i++) {
    if (fn(corpus[i]) !== expected[i]) {
      mismatch = i;
      break;
    }
  }
  if (mismatch >= 0) {
    console.error(`${name}: DIFIERE en la cadena ${mismatch}`);
    console.error(`  entrada:  ${JSON.stringify(String(corpus[mismatch]).slice(0, 90))}`);
    console.error(`  esperado: ${JSON.stringify(expected[mismatch].slice(0, 90))}`);
    console.error(`  obtenido: ${JSON.stringify(fn(corpus[mismatch]).slice(0, 90))}`);
    process.exit(1);
  }
}
console.log('todas las variantes coinciden con la original en las ' + corpus.length + ' cadenas\n');

// ── then speed ──────────────────────────────────────────────────────────────
const ROUNDS = 12;
for (const [name, fn] of candidates) {
  for (const s of corpus) fn(s); // warm
  const samples: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const started = process.hrtime.bigint();
    for (const s of corpus) fn(s);
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  console.log(`  ${name.padEnd(40)} ${median.toFixed(1).padStart(7)} ms`);
}
process.exit(0);
