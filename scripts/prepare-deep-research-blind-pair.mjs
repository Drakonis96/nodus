/**
 * Build two neutral, order-swapped Deep Research comparison bundles for judges
 * that do not have access to Nodus' provider-specific harness.
 *
 * The output contains no variant labels, model metadata or nodus:// URLs. It
 * preserves limitations and references because they are part of research
 * quality; removing them from only one format would bias a blind comparison.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const argOf = (name, fallback = '') => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const sourceA = path.resolve(argOf('--a'));
const sourceB = path.resolve(argOf('--b'));
const outDir = path.resolve(argOf('--out'));
const kind = argOf('--kind', 'report');
assert.ok(sourceA && sourceB && outDir, 'Usage: --a A.json --b B.json --out DIR');

const load = (file) => {
  if (kind === 'markdown' || (kind === 'auto' && path.extname(file).toLowerCase() === '.md')) {
    const objective = argOf('--objective', '').trim();
    assert.ok(objective, 'Markdown pairs require --objective.');
    return {
      objective,
      text: anonymiseMarkdown(fs.readFileSync(file, 'utf8')),
    };
  }
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof value.draftMarkdown === 'string') {
    assert.ok(String(value.objective ?? '').trim(), `Invalid Deep Research objective: ${file}`);
    return {
      objective: value.objective,
      text: anonymiseMarkdown(value.draftMarkdown),
    };
  }
  if (kind === 'plan') {
    if (value.report?.draft) {
      return {
        objective: value.metrics?.objective ?? value.report.draft.brief?.objective ?? '',
        text: {
          title: value.report.draft.title ?? '',
          abstract: value.report.draft.abstract ?? '',
          sections: (value.report.draft.outline ?? []).map((section) => ({
            title: section.title,
            purpose: section.purpose,
            keyClaims: section.keyClaims ?? [],
          })),
        },
      };
    }
    const plan = value.plan ?? value;
    assert.ok(Array.isArray(plan.sections), `Invalid Deep Research plan: ${file}`);
    return {
      objective: value.objective ?? '',
      text: {
        title: plan.title ?? '',
        abstract: plan.abstract ?? '',
        sections: plan.sections.map((section) => ({
          title: section.title,
          purpose: section.purpose,
          keyClaims: section.keyClaims ?? [],
        })),
      },
    };
  }
  assert.ok(value.report?.draft, `Invalid Deep Research report: ${file}`);
  return {
    objective: value.metrics?.objective ?? value.report.draft.brief?.objective ?? '',
    text: anonymise(value.report),
  };
};

const a = load(sourceA);
const b = load(sourceB);
if (a.objective && b.objective) {
  assert.equal(normalise(a.objective), normalise(b.objective), 'The two reports must answer the same objective.');
}
const objective = a.objective || b.objective;
assert.ok(objective, 'At least one source must include the objective.');
fs.mkdirSync(outDir, { recursive: true });
write('pair-1.json', objective, a.text, b.text);
write('pair-2.json', objective, b.text, a.text);

function write(file, objective, report1, report2) {
  const labels = kind === 'plan'
    ? { objective, plan1: report1, plan2: report2 }
    : { objective, report1, report2 };
  fs.writeFileSync(path.join(outDir, file), `${JSON.stringify(labels, null, 2)}\n`);
}

function anonymise(report) {
  return anonymiseMarkdown(report.draft.draftMarkdown ?? '');
}

function anonymiseMarkdown(markdown) {
  const body = String(markdown)
    // Audit notes are useful in the archived run but reveal the engine, clone and
    // provider to a supposedly blind judge. Remove the whole trailing section,
    // not just one known sentence.
    .replace(/^##\s+Nota de auditor[ií]a[^\n]*\n(?:^(?!##\s+).*(?:\n|$))*/gimu, '')
    .replace(/\[([^\]]*)\]\(nodus:\/\/[^)]*\)/gu, '$1')
    .replace(/`?nodus:\/\/(?:idea|work|passage|gap|contradiction|study|archive)\/[^`\s),;]+`?/giu, 'cita recuperada')
    .replace(/^.*(?:realVaultOpened|snapshot-v[12]|sections-v[12]|plan-v[12]|\/tmp\/nodus-dr-|openrouter\/baai\/bge-m3|generation\s+`?none`?|embedding).*$\n?/gimu, '')
    .replace(/^\s*(?:deepResearchVersion|version)\s*[:=]\s*["']?v[12]["']?\s*$/gimu, '')
    .replace(/^\*\*Variante[^\n]*\*\*\s*$/gimu, '')
    .replace(/^\*\*Cobertura autoevaluada:[^\n]*$/gimu, '')
    .replace(/\bInforme\s+[AB]\s*\(v[12]\)/giu, 'Informe')
    .replace(/\bInforme\s+[AB]\b/giu, 'Informe')
    .replace(/\bv[12]\b/giu, '')
    .replace(/La recuperación N mejora/giu, 'La evidencia recuperada mejora')
    .replace(/El resultado defendible con esta variante/giu, 'El resultado defendible con este corpus')
    .replace(/Esto afecta de manera desigual a las trece preguntas\. La variante H/giu, 'Esto afecta de manera desigual a las trece preguntas. El corpus disponible')
    .replace(/La forma correcta de usar esta variante/giu, 'La forma correcta de usar este corpus')
    .replace(/La ventaja de H/giu, 'Su ventaja')
    .replace(/la ausencia de pasajes/giu, 'la ausencia de evidencia textual directa')
    .replace(/`[bc]-tourism-metrics\.json`/giu, 'la matriz de evaluación')
    .trim();
  return body;
}

function normalise(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}
