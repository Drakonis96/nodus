// Headless checks for v0.8.9 author enhancements: full-name parsing exposed by
// listAuthors, and the synthesis-export markdown assembly (name-first sections).
import { seedDemoData } from '../electron/db/demoData';
import { listAuthors } from '../electron/ai/authorDossier';
import { renderSynthesesMarkdown, type SynthRow } from '../electron/export/authorSynthesisExport';

seedDemoData();

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

// ── Full name parsing on the demo corpus ─────────────────────────────────────
const authors = listAuthors();
assert(authors.length > 0, 'no authors');
console.log('sample authors (name → fullName / first / last):');
for (const a of authors.slice(0, 4)) {
  console.log(`  ${a.name}  →  "${a.fullName}"  [first="${a.firstName}" last="${a.lastName}"]`);
  assert(a.fullName.trim().length > 0, `empty fullName for ${a.name}`);
  assert(a.lastName.trim().length > 0, `empty lastName for ${a.name}`);
}
// "Cepeda, N. J." must flip to natural order.
const cep = authors.find((a) => a.name.startsWith('Cepeda'));
if (cep) {
  assert(cep.fullName === 'N. J. Cepeda', `expected "N. J. Cepeda", got "${cep.fullName}"`);
  assert(cep.lastName === 'Cepeda' && cep.firstName === 'N. J.', 'bad first/last split');
}

// Sorting keys usable: by surname vs first name differ.
const bySurname = [...authors].sort((a, b) => a.lastName.localeCompare(b.lastName)).map((a) => a.lastName);
console.log(`\nsurname sort head: ${bySurname.slice(0, 3).join(', ')}`);

// ── Export markdown assembly ─────────────────────────────────────────────────
const rows: SynthRow[] = [
  {
    author_id: 'x1',
    name: 'Sweller, J.',
    affiliation: 'UNSW',
    thesis: 'La carga cognitiva limita el aprendizaje.',
    remember_json: JSON.stringify(['Memoria de trabajo limitada', 'Diseñar para reducir carga']),
    positioning: 'Se relaciona con la práctica de recuperación.',
    generated_at: '2026-01-01',
  },
  {
    author_id: 'x2',
    name: 'Fuentes Vega, Alicia',
    affiliation: null,
    thesis: 'El turismo transforma el patrimonio.',
    remember_json: JSON.stringify(['Patrimonialización', 'Tensión conservación/uso']),
    positioning: 'Dialoga con la historia económica.',
    generated_at: '2026-01-02',
  },
];
const md = renderSynthesesMarkdown(rows);
console.log('\n----- exported markdown (head) -----\n' + md.split('\n').slice(0, 16).join('\n'));

// Each author section starts with their FULL name as an H1.
assert(md.includes('# Alicia Fuentes Vega'), 'missing name-first heading for Fuentes Vega');
assert(md.includes('# J. Sweller'), 'missing name-first heading for Sweller');
// Ordered by surname → Fuentes Vega before Sweller.
assert(md.indexOf('Alicia Fuentes Vega') < md.indexOf('J. Sweller'), 'authors not surname-ordered');
// Sections present.
for (const s of ['## Tesis central', '## Qué recordar', '## Cómo se relaciona']) {
  assert(md.includes(s), `missing section ${s}`);
}
assert(md.includes('- Memoria de trabajo limitada'), 'remember bullets missing');

console.log('\nFULL NAMES ✓ · SORT KEYS ✓ · EXPORT MARKDOWN (name-first, sorted, sectioned) ✓');
