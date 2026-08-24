// Structural analysis of a generated Deep Research report.
//
// Answers the questions a page count cannot: does each section develop NEW material
// or re-tread the previous one, do the ideas inside a section share a theme, and how
// much source-backed novelty each section adds. Reads saved runs only —
// no model calls, no writes.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [dir, dbPath] = process.argv.slice(2);
if (!dir || !dbPath) throw new Error('Usage: analyze-deep-research-structure.mjs <ab-dir> <vault.sqlite>');

const db = new (require('better-sqlite3'))(dbPath, { readonly: true });
const themesOf = db.prepare(
  `SELECT COALESCE(GROUP_CONCAT(DISTINCT t.label), '') AS themes
     FROM idea_theme_links itl JOIN themes t ON t.theme_id = itl.theme_id
    WHERE itl.global_id = ?`
);

const CITATION = /\[[^\]]*\]\(nodus:\/\/(idea|passage|gap|contradiction|work)\/([^)]+)\)/g;

function analyze(label) {
  const { report } = JSON.parse(readFileSync(path.join(dir, `${label}.json`), 'utf8'));
  const md = report.draft.draftMarkdown;
  // Body sections only: drop the abstract, limitations and references blocks.
  const blocks = md
    .split(/^##\s+/mu)
    .slice(1)
    .map((block) => {
      const nl = block.indexOf('\n');
      return { title: block.slice(0, nl).trim(), text: block.slice(nl + 1) };
    })
    .filter((b) => !/^(Resumen|Abstract|Limitaciones|Limitations|Referencias|References)$/i.test(b.title));

  const seen = new Set();
  const rows = blocks.map((block) => {
    const ideas = new Set();
    const kinds = { passage: 0, gap: 0, contradiction: 0 };
    for (const m of block.text.matchAll(CITATION)) {
      const id = decodeURIComponent(m[2]);
      if (m[1] === 'idea') ideas.add(id);
      else if (m[1] in kinds) kinds[m[1]] += 1;
    }
    const fresh = [...ideas].filter((id) => !seen.has(id));
    ideas.forEach((id) => seen.add(id));

    // Theme concentration: share of the section's ideas that sit under its single
    // most common theme. High = the section is about one thing.
    const counts = new Map();
    for (const id of ideas) {
      for (const theme of (themesOf.get(id)?.themes ?? '').split(',').filter(Boolean)) {
        counts.set(theme, (counts.get(theme) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const words = block.text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*_`>|-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean).length;

    return {
      title: block.title.slice(0, 46),
      words,
      ideas: ideas.size,
      freshShare: ideas.size ? Number((fresh.length / ideas.size).toFixed(2)) : 0,
      topTheme: top ? `${top[0].slice(0, 22)} ${Math.round((top[1] / ideas.size) * 100)}%` : '—',
      passages: kinds.passage,
      gapsAndTensions: kinds.gap + kinds.contradiction,
    };
  });

  return { label, rows, meta: report.meta };
}

for (const label of ['before', 'after']) {
  const { rows } = analyze(label);
  console.log(`\n═══ ${label.toUpperCase()} — estructura guiada por evidencia`);
  console.log('sección'.padEnd(48) + 'palab'.padEnd(8) + 'ideas'.padEnd(7) + 'nuevas'.padEnd(8) + 'tema dominante'.padEnd(28) + 'pasajes  tensiones');
  for (const r of rows) {
    console.log(
      r.title.padEnd(48) +
        String(r.words).padEnd(8) +
        String(r.ideas).padEnd(7) +
        `${Math.round(r.freshShare * 100)}%`.padEnd(8) +
        r.topTheme.padEnd(28) +
        String(r.passages).padEnd(9) +
        r.gapsAndTensions
    );
  }
  const totalWords = rows.reduce((n, r) => n + r.words, 0);
  console.log(`→ ${rows.length} secciones · ${totalWords} palabras observadas · sin cuota editorial`);
}
db.close();
